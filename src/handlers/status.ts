import {
  DEFAULT_AUDIT_PREFIX,
  DEFAULT_AUDIT_TTL,
  isLeadStatus,
  type LeadRecord,
  type LeadsContext,
  type LeadStatus,
} from '../types.js';
import { guard } from '../auth/guard.js';
import { isLeadId, leadKey, prefixOf, readLeads } from './keys.js';

/**
 * Move an enquiry along: new → replied → archived, or → spam.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Before it, the only two things you could do with a lead were read it and
 * destroy it. That makes the list a viewer rather than an inbox: there is no
 * way to say "dealt with", so the only way to clear one is to delete it — and
 * deleting a real enquiry to tidy a list is how you lose the record of a
 * client you actually won.
 *
 * ── THE TTL TRAP, WHICH IS THE WHOLE DIFFICULTY ───────────────────────────
 * KV cannot update a value while keeping its remaining expiry. A `put` with no
 * TTL removes the expiry entirely; a `put` with `retentionSeconds` restarts
 * the clock. So marking a lead "replied" on day 364 would silently grant it
 * another full year — the record outlives the promise on the privacy page, and
 * nothing anywhere reports it, because from outside it is simply a record that
 * has not expired yet.
 *
 * `remainingTtl` computes what is LEFT from the original `receivedAt`, so a
 * status change never extends retention. If the remainder has already elapsed,
 * the write is refused rather than resurrecting a record that was due to go.
 */
export function remainingTtl(
  lead: { receivedAt: string },
  retentionSeconds: number | undefined,
  now = Date.now(),
): number | undefined {
  if (!retentionSeconds) return undefined;
  const received = new Date(String(lead.receivedAt)).getTime();
  if (!Number.isFinite(received)) return retentionSeconds;
  const elapsed = Math.floor((now - received) / 1000);
  return Math.max(0, retentionSeconds - elapsed);
}

export interface StatusChange {
  ok: boolean;
  id?: string;
  from?: LeadStatus;
  to?: LeadStatus;
  reason?: string;
}

/** Absent means `new`. Records written before statuses existed have none. */
export const statusOf = (lead: LeadRecord): LeadStatus =>
  isLeadStatus(lead.status) ? lead.status : 'new';

export async function setLeadStatus(
  ctx: LeadsContext,
  id: string,
  status: LeadStatus,
  by: string,
  now = Date.now(),
): Promise<StatusChange> {
  const prefix = prefixOf(ctx);
  const leads = await readLeads(ctx.store, prefix, {});
  const lead = leads.find((l) => l.id === id);
  if (!lead) return { ok: false, reason: 'No such enquiry.' };

  const from = statusOf(lead);
  if (from === status) return { ok: true, id, from, to: status, reason: 'unchanged' };

  const ttl = remainingTtl(lead as { receivedAt: string }, ctx.retentionSeconds, now);
  if (ttl === 0) {
    /* Past its retention and only still present because KV has not swept it
       yet. Writing it back would resurrect it for a full period. */
    return { ok: false, reason: 'This enquiry is past its retention period.' };
  }

  const at = new Date(now).toISOString();
  const updated: LeadRecord = { ...lead, status, statusAt: at, statusBy: by };

  await ctx.store.put(
    leadKey(lead as { receivedAt: string; id: string }, prefix),
    JSON.stringify(updated),
    ttl === undefined ? undefined : { expirationTtl: ttl },
  );

  await ctx.store.put(
    `${ctx.auditPrefix ?? DEFAULT_AUDIT_PREFIX}${at}:${crypto.randomUUID()}`,
    JSON.stringify({
      action: 'set-status',
      leadId: id,
      leadReceivedAt: lead.receivedAt,
      from,
      to: status,
      by,
      at,
    }),
    { expirationTtl: ctx.auditTtl ?? DEFAULT_AUDIT_TTL },
  );

  return { ok: true, id, from, to: status };
}

/**
 * POST { id, status }.
 *
 * POST rather than PATCH: this is reachable from a plain `<form>` so it works
 * without JavaScript, and a form can only issue GET or POST. PATCH would be
 * tidier REST and unusable by half the point of this package.
 */
export async function handleStatus(
  request: Request,
  ctx: LeadsContext,
  options: { redirectTo?: string } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { status: 405, headers: { allow: 'POST' } });
  }

  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  let id: unknown;
  let status: unknown;
  try {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      ({ id, status } = (await request.json()) as { id?: unknown; status?: unknown });
    } else {
      const form = await request.formData();
      id = form.get('id');
      status = form.get('status');
    }
  } catch {
    return new Response('Could not read the request.\n', { status: 400 });
  }

  if (!isLeadId(id)) return new Response('Not a lead id.\n', { status: 400 });
  if (!isLeadStatus(status)) {
    return new Response('Status must be one of: new, replied, archived, spam.\n', { status: 400 });
  }

  const result = await setLeadStatus(ctx, id, status, check.identity?.email ?? `token:${check.via}`);
  if (!result.ok) return new Response(`${result.reason}\n`, { status: 409 });

  if ((request.headers.get('accept') ?? '').includes('text/html') && options.redirectTo) {
    return new Response(null, { status: 303, headers: { location: options.redirectTo } });
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
