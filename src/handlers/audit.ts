import { DEFAULT_AUDIT_PREFIX, type LeadsContext } from '../types.js';
import { guard } from '../auth/guard.js';

/**
 * Read the audit trail.
 *
 * We have been writing `audit:` records since the delete handler existed, and
 * until now nothing could read them. A log nobody can read is not a log — it
 * is storage costs and a false sense of accountability, because "it's audited"
 * sounds like an answer right up until someone asks to see it.
 *
 * Newest first, unlike the leads. An audit trail is read to answer "what just
 * happened", so the most recent entry is the one being looked for; a lead list
 * is read to work through an inbox, where oldest-first is the queue.
 */
export interface AuditRecord {
  action: string;
  at: string;
  by: string;
  [key: string]: unknown;
}

export async function readAudit(
  ctx: LeadsContext,
  options: { limit?: number; since?: string } = {},
): Promise<AuditRecord[]> {
  const prefix = ctx.auditPrefix ?? DEFAULT_AUDIT_PREFIX;
  const keys = await ctx.store.list(prefix, {
    startAfter: options.since ? `${prefix}${options.since}` : undefined,
  });

  /* Reverse before fetching, so a limit reads the NEWEST n rather than the
     oldest n and then discarding them. */
  const wanted = keys.reverse().slice(0, options.limit ?? 200);

  const records: AuditRecord[] = [];
  for (const key of wanted) {
    /* Audit records share the store but not the shape. `get` is typed for
       leads, so this is the one place a cast is honest rather than lazy. */
    const value = (await ctx.store.get(key)) as unknown as AuditRecord | null;
    if (value) records.push(value);
  }
  return records;
}

export async function handleAudit(request: Request, ctx: LeadsContext): Promise<Response> {
  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit'));
  const records = await readAudit(ctx, {
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    since: url.searchParams.get('since') ?? undefined,
  });

  return new Response(JSON.stringify({ count: records.length, records }, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
