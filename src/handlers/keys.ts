import { DEFAULT_PREFIX, type LeadRecord, type LeadsContext, type LeadStore } from '../types.js';

/**
 * The storage key for a lead. DERIVED, never taken from the client.
 *
 * The delete handler accepts an id and rebuilds the key here rather than
 * accepting a key outright: a client-supplied key is a client-supplied DELETE
 * TARGET, and the lead prefix is not the only one in the namespace — the audit
 * records share it.
 *
 * Timestamp before id, so KV's lexicographic key order IS chronological order
 * and reading them back sorted costs nothing.
 */
export const leadKey = (lead: { receivedAt: string; id: string }, prefix = DEFAULT_PREFIX): string =>
  `${prefix}${lead.receivedAt}:${lead.id}`;

/** A UUID and nothing else. Anything shaped otherwise is not a lead id. */
export const isLeadId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Every lead, oldest first — the order falls out of the key design. */
export async function readAllLeads(store: LeadStore, prefix = DEFAULT_PREFIX): Promise<LeadRecord[]> {
  const keys = await store.list(prefix);
  const values = await Promise.all(keys.map((k) => store.get(k)));
  return values.filter((v): v is LeadRecord => v !== null);
}

export const prefixOf = (ctx: LeadsContext) => ctx.prefix ?? DEFAULT_PREFIX;
