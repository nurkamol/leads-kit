import { DEFAULT_AUDIT_PREFIX, DEFAULT_AUDIT_TTL, type LeadsContext } from '../types.js';
import { guard } from '../auth/guard.js';
import { isLeadId, leadKey, prefixOf, readAllLeads } from './keys.js';

export interface DeleteOptions {
  /**
   * Where to send a browser after a successful delete. A form POST that
   * answers 200 with a body leaves the browser sitting on the endpoint URL,
   * where a refresh re-submits it; a 303 to the list is the POST/redirect/GET
   * that stops that.
   */
  redirectTo?: string;
}

/**
 * Delete one enquiry. POST only, authenticated, audited.
 *
 * ── WHY THIS IS NOT A LINK ────────────────────────────────────────────────
 * A GET that deletes is a GET that a prefetcher, a link scanner, an email
 * client or the browser's own speculation rules will eventually fire on its
 * own — nobody having clicked anything. Destructive actions are POST, and this
 * refuses anything else.
 *
 * ── CSRF IS NOT HANDLED HERE ──────────────────────────────────────────────
 * Deliberately. Whichever session this route trusts is carried by a cookie,
 * and a cookie rides along on a cross-site POST whether or not the person
 * meant to make one — so origin checking is REQUIRED, but it belongs at the
 * framework layer where the site's own origin is known. Astro has
 * `security.checkOrigin` (default on; pin it). Next has no equivalent default,
 * so check `Origin` in middleware. Verify it is actually on before shipping:
 *
 *     curl -X POST https://<host>/api/leads/delete/    # must NOT reach this
 *
 * ── AND WHY IT IS AUDITED ─────────────────────────────────────────────────
 * Deletion is the one action here with no undo. The audit record is written
 * BEFORE the delete: if that write fails, nothing is destroyed, which is the
 * safer way round. It stores the email's DOMAIN rather than the address — an
 * audit trail that keeps a second copy of the personal data has undone the
 * deletion it is recording, and it outlives the leads themselves.
 */
export async function handleDelete(
  request: Request,
  ctx: LeadsContext,
  options: DeleteOptions = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { status: 405, headers: { allow: 'POST' } });
  }

  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  let id: unknown;
  const type = request.headers.get('content-type') ?? '';
  try {
    id = type.includes('application/json')
      ? ((await request.json()) as { id?: unknown }).id
      : (await request.formData()).get('id');
  } catch {
    return new Response('Could not read the request.\n', { status: 400 });
  }

  if (!isLeadId(id)) return new Response('Not a lead id.\n', { status: 400 });

  const prefix = prefixOf(ctx);
  const leads = await readAllLeads(ctx.store, prefix);
  const lead = leads.find((l) => l.id === id);
  /* Deleting something already gone reports honestly rather than pretending to
     have worked — otherwise a bug that targets the wrong id looks like a
     success every single time. */
  if (!lead) return new Response('No such enquiry.\n', { status: 404 });

  const at = new Date().toISOString();
  await ctx.store.put(
    `${ctx.auditPrefix ?? DEFAULT_AUDIT_PREFIX}${at}:${crypto.randomUUID()}`,
    JSON.stringify({
      action: 'delete-lead',
      leadId: lead.id,
      leadReceivedAt: lead.receivedAt,
      leadEmailDomain: String(lead.email ?? '').split('@')[1]?.toLowerCase() ?? '',
      by: check.identity?.email ?? `token:${check.via}`,
      at,
    }),
    { expirationTtl: ctx.auditTtl ?? DEFAULT_AUDIT_TTL },
  );

  await ctx.store.delete(leadKey(lead as { receivedAt: string; id: string }, prefix));

  if ((request.headers.get('accept') ?? '').includes('text/html') && options.redirectTo) {
    return new Response(null, { status: 303, headers: { location: options.redirectTo } });
  }
  return new Response(JSON.stringify({ ok: true, id: lead.id }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
