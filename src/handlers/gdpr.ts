import {
  DEFAULT_AUDIT_PREFIX,
  DEFAULT_AUDIT_TTL,
  type LeadRecord,
  type LeadsContext,
} from '../types.js';
import { guard } from '../auth/guard.js';
import { leadKey, prefixOf, readLeads } from './keys.js';

/**
 * Data-subject requests, and the retention sweep.
 *
 * ── WHY THESE ARE NOT "NICE TO HAVE" ──────────────────────────────────────
 * Under GDPR a person can ask what you hold about them (Art. 15) and ask you
 * to delete it (Art. 17), and you have one month to answer. Under CCPA the
 * clock is 45 days. Neither regime cares that the data is "just a contact
 * form" — a name, an email address and free text about their situation is
 * personal data, and an enquiry form is one of the most common places a small
 * business holds it without noticing.
 *
 * Doing this by hand means someone grepping a KV namespace under time
 * pressure, which is how the wrong record gets deleted and the right one gets
 * missed. Both of those are worse than the request itself.
 *
 * Erasure is audited exactly like a single delete, and for the same reason:
 * it is the one action with no undo. The audit records the DOMAIN, never the
 * address — a trail that keeps a second copy of what it just erased has
 * undone the erasure it is recording.
 */

const auditPrefixOf = (ctx: LeadsContext) => ctx.auditPrefix ?? DEFAULT_AUDIT_PREFIX;

async function writeAudit(ctx: LeadsContext, record: Record<string, unknown>): Promise<void> {
  const at = new Date().toISOString();
  await ctx.store.put(
    `${auditPrefixOf(ctx)}${at}:${crypto.randomUUID()}`,
    JSON.stringify({ ...record, at }),
    { expirationTtl: ctx.auditTtl ?? DEFAULT_AUDIT_TTL },
  );
}

const emailOf = (l: LeadRecord) => String(l.email ?? '').trim().toLowerCase();

/**
 * Everything held about one person (Art. 15 / CCPA "right to know").
 *
 * GET, because it changes nothing. Returns the records verbatim rather than a
 * summary: the request is for the data, and paraphrasing it is answering a
 * different question.
 */
export async function handleSubjectAccess(
  request: Request,
  ctx: LeadsContext,
): Promise<Response> {
  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  const email = new URL(request.url).searchParams.get('email');
  if (!email?.includes('@')) {
    return new Response('Pass ?email= the address to look up.\n', { status: 400 });
  }

  const leads = await readLeads(ctx.store, prefixOf(ctx), { email });

  /* Logged even though nothing changed. "Who looked this person up, and when"
     is a question a regulator asks, and an access log that only records
     destruction answers half of it. */
  await writeAudit(ctx, {
    action: 'subject-access',
    subjectEmailDomain: email.split('@')[1]?.toLowerCase() ?? '',
    matched: leads.length,
    by: check.identity?.email ?? `token:${check.via}`,
  });

  return new Response(
    JSON.stringify({ email, count: leads.length, leads, generatedAt: new Date().toISOString() }, null, 2),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="subject-access.json"`,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
  );
}

/**
 * Erase everything held about one person (Art. 17 / CCPA "right to delete").
 *
 * POST, and it requires the address to be sent in the body rather than the
 * query string — a URL ends up in logs, in history and in referrers, and the
 * address of someone exercising an erasure right is the last thing that should
 * be sitting in an access log after the records are gone.
 */
export async function handleErasure(request: Request, ctx: LeadsContext): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { status: 405, headers: { allow: 'POST' } });
  }

  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  let email: unknown;
  let confirm: unknown;
  try {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      ({ email, confirm } = (await request.json()) as { email?: unknown; confirm?: unknown });
    } else {
      const form = await request.formData();
      email = form.get('email');
      confirm = form.get('confirm');
    }
  } catch {
    return new Response('Could not read the request.\n', { status: 400 });
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    return new Response('Send an email address to erase.\n', { status: 400 });
  }

  /* An explicit confirmation, because unlike a single delete this one takes an
     unbounded number of records with it and the caller may not know how many.
     A typo'd address erases nothing; a correct one erases everything. */
  if (confirm !== email) {
    return new Response(
      'Send `confirm` equal to `email` to proceed. This erases every enquiry from that address.\n',
      { status: 400 },
    );
  }

  const prefix = prefixOf(ctx);
  const leads = await readLeads(ctx.store, prefix, { email });

  await writeAudit(ctx, {
    action: 'erase-subject',
    subjectEmailDomain: email.split('@')[1]?.toLowerCase() ?? '',
    erased: leads.length,
    leadIds: leads.map((l) => l.id),
    by: check.identity?.email ?? `token:${check.via}`,
  });

  for (const lead of leads) {
    await ctx.store.delete(leadKey(lead as { receivedAt: string; id: string }, prefix));
  }

  return new Response(
    JSON.stringify({ ok: true, erased: leads.length, ids: leads.map((l) => l.id) }),
    { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
}

export interface SweepResult {
  cutoff: string;
  matched: number;
  deleted: number;
  ids: string[];
}

/**
 * Delete every lead older than the retention period.
 *
 * ── WHY THIS EXISTS WHEN expirationTtl ALREADY DOES ───────────────────────
 * A TTL is set when a record is WRITTEN. Any record stored before the TTL was
 * introduced — which is every record on a site that added retention later —
 * has none, and KV keeps a value without one forever. Those records will
 * outlive the privacy notice that promised they would not, and nothing will
 * ever flag it, because from the outside a namespace with old records looks
 * exactly like a namespace with old records.
 *
 * `dryRun` first. Always. It reports what WOULD go without touching anything,
 * and a retention sweep whose cutoff was computed from the wrong unit is not a
 * thing you want to discover afterwards.
 */
export async function sweepExpired(
  ctx: LeadsContext,
  retentionDays: number,
  options: { dryRun?: boolean; by?: string } = {},
): Promise<SweepResult> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`retentionDays must be a positive number, got ${retentionDays}`);
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const prefix = prefixOf(ctx);
  const stale = await readLeads(ctx.store, prefix, { until: cutoff });
  const ids = stale.map((l) => l.id);

  if (options.dryRun) return { cutoff, matched: stale.length, deleted: 0, ids };

  if (stale.length) {
    await writeAudit(ctx, {
      action: 'retention-sweep',
      cutoff,
      retentionDays,
      deleted: stale.length,
      leadIds: ids,
      by: options.by ?? 'scheduled',
    });
  }

  for (const lead of stale) {
    await ctx.store.delete(leadKey(lead as { receivedAt: string; id: string }, prefix));
  }

  return { cutoff, matched: stale.length, deleted: stale.length, ids };
}
