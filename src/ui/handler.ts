import type { LeadsContext } from '../types.js';
import { verifyAccess } from '../auth/access.js';
import { prefixOf, readAllLeads } from '../handlers/keys.js';
import { renderLeadsPage, type LeadsPageOptions } from './page.js';

/**
 * Serve the leads page.
 *
 * -- 404, NOT 403 ----------------------------------------------------------
 * A route serving personal data should not confirm that it exists. 403 tells
 * an anonymous caller there is something here worth getting at; 404 tells them
 * nothing. Exclude it from the sitemap for the same reason.
 *
 * -- IT VERIFIES, IT DOES NOT TRUST ----------------------------------------
 * The identity comes from `verifyAccess`, which checks the JWT's signature
 * against the team's published keys, its audience and its expiry. The presence
 * of `Cf-Access-Jwt-Assertion` is NOT a check: a header is a header, and with
 * Access removed or misconfigured anyone can send one.
 *
 * It also fails closed when Access is not configured at all. A page that
 * renders every enquiry the moment two env vars are missing is worse than a
 * page that never renders.
 *
 * -- AND IT IS NEVER CACHED ------------------------------------------------
 * `no-store`, plus `noindex`. A shared cache holding this page is a data
 * breach with a long tail.
 */
export interface LeadsPageHandlerOptions extends Omit<LeadsPageOptions, 'filter' | 'notice' | 'identity'> {
  /**
   * Show the signed-in address under the heading. Default true.
   *
   * It is worth having: on a shared machine it is the only thing telling you
   * whose enquiries you are looking at.
   */
  showIdentity?: boolean;
}

export async function handleLeadsPage(
  request: Request,
  ctx: LeadsContext,
  options: LeadsPageHandlerOptions = {},
): Promise<Response> {
  const notFound = () =>
    new Response('Not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
    });

  const identity = await verifyAccess(request, ctx.access?.teamDomain, ctx.access?.aud);
  if (!identity) return notFound();

  const url = new URL(request.url);
  const leads = await readAllLeads(ctx.store, prefixOf(ctx));

  const html = renderLeadsPage(leads, {
    ...options,
    identity: options.showIdentity === false ? undefined : identity.email,
    filter: url.searchParams.get('status') ?? '',
    notice: url.searchParams.get('deleted') === '1'
      ? 'deleted'
      : url.searchParams.get('updated') === '1'
        ? 'updated'
        : null,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      /* The page inlines its own style and script and loads nothing else, so
         this costs nothing and closes the injection surface if an escaping bug
         ever gets past the tests. Pass `nonce` to tighten it further. */
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
