/**
 * The shapes everything else agrees on.
 *
 * Nothing in this package imports a framework or a Node built-in. That is not
 * tidiness — it is the whole portability story: Request, Response, crypto and
 * TextEncoder exist on Workers, Deno, Bun, Node 18+, Vercel Edge and Netlify
 * Edge alike, so a handler written against them runs on all of them and every
 * framework above them mounts it in about eight lines.
 *
 * The moment one `node:` import lands here, that stops being true everywhere
 * at once and nothing fails until deploy.
 */

/** One enquiry. Extra fields survive: the formatters read what they are given. */
export interface LeadRecord {
  id: string;
  receivedAt: string;
  name: string;
  email: string;
  phone?: string;
  service?: string;
  budget?: string;
  timeline?: string;
  message?: string;
  page?: string;
  country?: string;
  /** How the bot challenge went, if there is one. See the note in README. */
  verification?: string;
  env?: string;
  [key: string]: unknown;
}

/**
 * Storage, reduced to the four things this package actually does.
 *
 * Workers KV is what `kvStore()` implements, but nothing here knows that.
 * Upstash, Vercel KV, Deno KV or a Postgres table behind twenty lines of glue
 * all satisfy this, which is the point — the alternative is a package that
 * only works on one host and says so nowhere.
 */
export interface LeadStore {
  /**
   * Keys under a prefix, in lexicographic order.
   *
   * The bounds exist so that a date filter is a KEY RANGE rather than a read
   * of every record. The key format puts the timestamp first precisely to make
   * that possible — see `leadKey`.
   *
   * Both are inclusive of `startAfter` and exclusive of `endBefore`, matching
   * the `since`/`until` semantics of LeadQuery so the two cannot drift.
   *
   * A store that cannot honour them may ignore them: the handlers filter again
   * afterwards, so ignoring them costs performance and never correctness.
   */
  list(prefix: string, opts?: { startAfter?: string; endBefore?: string }): Promise<string[]>;
  get(key: string): Promise<LeadRecord | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Narrowing applied to a read. Every field is optional; all of them AND. */
export interface LeadQuery {
  /** ISO timestamp. Records at or after it. */
  since?: string;
  /** ISO timestamp. Records strictly before it. */
  until?: string;
  /** Case-insensitive substring, matched across name, email, service, message. */
  q?: string;
  /** Exact email match, case-insensitive. The one a DSAR needs. */
  email?: string;
  /** Stop after this many. Applied last, after every other filter. */
  limit?: number;
}

/** What a handler needs to do its job. Assembled by the adapter. */
export interface LeadsContext {
  store: LeadStore;
  /** Bearer token for CLI/API access. Omit to disable token auth entirely. */
  token?: string;
  /** Cloudflare Access. Omit both to disable Access auth entirely. */
  access?: { teamDomain: string; aud: string };
  /** KV key prefix. Must not collide with the audit prefix below. */
  prefix?: string;
  auditPrefix?: string;
  /** Seconds to keep an audit record. Default 400 days. */
  auditTtl?: number;
}

export const DEFAULT_PREFIX = 'lead:';
export const DEFAULT_AUDIT_PREFIX = 'audit:';
export const DEFAULT_AUDIT_TTL = 60 * 60 * 24 * 400;
