import {
  DEFAULT_PREFIX,
  isLeadStatus,
  type LeadQuery,
  type LeadRecord,
  type LeadsContext,
  type LeadStore,
} from '../types.js';

/**
 * The storage key for a lead. DERIVED, never taken from the client.
 *
 * The delete handler accepts an id and rebuilds the key here rather than
 * accepting a key outright: a client-supplied key is a client-supplied DELETE
 * TARGET, and the lead prefix is not the only one in the namespace — the audit
 * records share it.
 *
 * Timestamp before id, so a lexicographic key order IS chronological order.
 * That is what makes a date filter a range scan instead of a full table read,
 * and it is why the format is not negotiable.
 */
export const leadKey = (lead: { receivedAt: string; id: string }, prefix = DEFAULT_PREFIX): string =>
  `${prefix}${lead.receivedAt}:${lead.id}`;

/** A UUID and nothing else. Anything shaped otherwise is not a lead id. */
export const isLeadId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const SEARCHABLE = ['name', 'email', 'service', 'message', 'budget', 'timeline'] as const;

/** Does one record satisfy a query? Every supplied field must match. */
export function matches(lead: LeadRecord, query: LeadQuery): boolean {
  if (query.since && String(lead.receivedAt) < query.since) return false;
  if (query.until && String(lead.receivedAt) >= query.until) return false;

  if (query.email) {
    if (String(lead.email ?? '').trim().toLowerCase() !== query.email.trim().toLowerCase()) {
      return false;
    }
  }

  if (query.status) {
    const wanted = Array.isArray(query.status) ? query.status : [query.status];
    /* Absent counts as `new`: records written before statuses existed must not
       vanish from a filtered view, which would read as data loss. */
    const actual = isLeadStatus(lead.status) ? lead.status : 'new';
    if (!wanted.includes(actual)) return false;
  }

  if (query.q) {
    const needle = query.q.toLowerCase();
    const found = SEARCHABLE.some((field) =>
      String(lead[field] ?? '').toLowerCase().includes(needle),
    );
    if (!found) return false;
  }

  return true;
}

/**
 * Leads matching a query, oldest first.
 *
 * ── WHY THIS IS NOT JUST list() THEN filter() ─────────────────────────────
 * It used to be. `readAllLeads` fetched every record into an array and the
 * caller filtered afterwards, which is fine at four enquiries and a problem at
 * forty thousand: a Worker has 128MB, and the failure mode is an isolate
 * killed mid-request with no message that mentions memory.
 *
 * So the date bound is pushed into the key range (cheap, because the key
 * starts with the timestamp), and `limit` stops the fetch loop rather than
 * trimming the result — the point of a limit is the reads it avoids.
 *
 * The text filter cannot be pushed down: KV has no index, and the value has to
 * be read to be searched. That one is honestly a scan, and is documented as
 * such rather than being made to look cheap.
 */
export async function readLeads(
  store: LeadStore,
  prefix = DEFAULT_PREFIX,
  query: LeadQuery = {},
): Promise<LeadRecord[]> {
  let keys = await store.list(prefix, {
    startAfter: query.since ? `${prefix}${query.since}` : undefined,
    endBefore: query.until ? `${prefix}${query.until}` : undefined,
  });

  /*
   * When both date bounds are key-range operations and there is no filter that
   * needs the VALUE, every remaining key is a match — so the limit applies to
   * the key list and the reads it saves are real. With a text or email filter
   * we cannot know which records match without reading them, so the limit has
   * to be checked as we go and the batch may over-fetch by up to one batch.
   *
   * This distinction is the whole point of the key format. Getting it wrong
   * looks identical from outside: same results, quietly reading the entire
   * namespace to return ten rows.
   */
  const needsValues = Boolean(query.q || query.email);
  if (query.limit && !needsValues) keys = keys.slice(0, query.limit);

  const leads: LeadRecord[] = [];
  /* Batched rather than one Promise.all over everything: 40k concurrent reads
     is something a runtime will either queue badly or refuse outright. */
  const BATCH = 100;
  for (let i = 0; i < keys.length; i += BATCH) {
    const size = query.limit && !needsValues ? Math.min(BATCH, query.limit - leads.length) : BATCH;
    const page = await Promise.all(keys.slice(i, i + size).map((k) => store.get(k)));
    for (const lead of page) {
      if (!lead) continue;
      if (!matches(lead, query)) continue;
      leads.push(lead);
      if (query.limit && leads.length >= query.limit) return leads;
    }
  }
  return leads;
}

/** Every lead, unfiltered. Kept for callers that genuinely want all of them. */
export const readAllLeads = (store: LeadStore, prefix = DEFAULT_PREFIX): Promise<LeadRecord[]> =>
  readLeads(store, prefix, {});

/** Read a query off a URL. Unknown parameters are ignored, not rejected. */
export function queryFromUrl(url: URL): LeadQuery {
  const p = url.searchParams;
  const limit = Number(p.get('limit'));
  const statuses = (p.get('status') ?? '').split(',').map((v) => v.trim()).filter(isLeadStatus);
  return {
    status: statuses.length ? statuses : undefined,
    since: p.get('since') ?? undefined,
    until: p.get('until') ?? undefined,
    q: p.get('q') ?? undefined,
    email: p.get('email') ?? undefined,
    /* A limit that is not a positive integer is no limit, rather than zero.
       `?limit=abc` returning nothing looks like an empty dataset. */
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
  };
}

export const prefixOf = (ctx: LeadsContext) => ctx.prefix ?? DEFAULT_PREFIX;
