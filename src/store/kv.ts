import type { LeadRecord, LeadStore } from '../types.js';

/**
 * The subset of Workers KV this package touches.
 *
 * Declared structurally rather than imported from @cloudflare/workers-types so
 * that installing this package does not drag Cloudflare's ambient global types
 * into a project that is not on Cloudflare — they conflict with lib.dom in
 * ways that surface as unrelated type errors in unrelated files.
 */
export interface KVNamespaceLike {
  list(opts: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * A LeadStore backed by Workers KV.
 *
 * `list` pages to exhaustion. KV caps a page at 1000 keys and a caller who
 * ignores the cursor gets a silently truncated export — the worst possible
 * failure for this feature, because 1000 rows looks exactly like all of them.
 */
export function kvStore(kv: KVNamespaceLike): LeadStore {
  return {
    async list(prefix, opts) {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix, cursor, limit: 1000 });
        for (const key of page.keys) {
          /* Keys sort lexicographically and carry the timestamp first, so a
             "since" filter is a range skip rather than a full read of every
             value. On a namespace with years of enquiries this is the
             difference between listing keys and fetching every record. */
          if (opts?.startAfter && key.name < opts.startAfter) continue;
          if (opts?.endBefore && key.name >= opts.endBefore) continue;
          names.push(key.name);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return names;
    },
    async get(key) {
      return ((await kv.get(key, 'json')) as LeadRecord | null) ?? null;
    },
    put: (key, value, opts) => kv.put(key, value, opts),
    delete: (key) => kv.delete(key),
  };
}
