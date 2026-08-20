import type { LeadsContext } from '../types.js';
import { verifyAccess, type AccessIdentity } from './access.js';
import { bearerFrom, tokenMatches } from './token.js';

export type GuardResult =
  | { ok: true; via: 'token'; identity: null }
  | { ok: true; via: 'access'; identity: AccessIdentity }
  | { ok: false; response: Response };

/**
 * Two ways in, one bar.
 *
 * ── WHY BOTH, AND WHY IN THIS ORDER ───────────────────────────────────────
 * A token-only guard cannot serve a browser. Download buttons are ordinary
 * `<a href download>` links; a browser following a link sends cookies and
 * cannot be made to send an Authorization header. So a token-only route 401s
 * every download from the very page built to offer them. (This is not
 * hypothetical — it shipped, and that is why this function exists.)
 *
 * An Access-only guard cannot serve a CLI: there is no browser to redirect to
 * a login screen.
 *
 * The token is tried FIRST but only when one is PRESENTED, so a browser
 * request with no header falls through to Access rather than being turned away
 * with a 401 it has no way to act on.
 */
export async function guard(request: Request, ctx: LeadsContext): Promise<GuardResult> {
  const unauthorized = () => ({
    ok: false as const,
    response: new Response('Unauthorized\n', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="leads"' },
    }),
  });

  const presented = bearerFrom(request);
  if (presented !== null) {
    if (!ctx.token) {
      return {
        ok: false,
        response: new Response('Token auth is not configured.\n', { status: 503 }),
      };
    }
    if (tokenMatches(presented, ctx.token)) return { ok: true, via: 'token', identity: null };
    return unauthorized();
  }

  const identity = await verifyAccess(request, ctx.access?.teamDomain, ctx.access?.aud);
  if (identity) return { ok: true, via: 'access', identity };

  return unauthorized();
}
