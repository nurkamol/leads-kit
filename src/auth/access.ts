/**
 * Cloudflare Access JWT verification.
 *
 * ── THE HEADER IS NOT THE CHECK ───────────────────────────────────────────
 * Cloudflare puts `Cf-Access-Jwt-Assertion` on requests it has authenticated.
 * Reading that header and concluding "authenticated" is the single most common
 * way this gets built, and it is wrong: a header is a header. Anyone can send
 * one. If the Access application is ever deleted, misconfigured, or scoped to
 * a path that does not cover the route, requests arrive with whatever header
 * the caller chose to write.
 *
 * The check is the SIGNATURE, against the team's published keys, with the
 * audience and expiry verified. That is what this does.
 *
 * Every failure returns null. There is no path through this function that
 * fails open — including the cert fetch, where "the network is down" and "this
 * token is forged" are indistinguishable and must therefore both mean deny.
 */
export interface AccessIdentity {
  email: string;
  sub: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

/** base64url → ArrayBuffer. crypto.subtle wants a buffer, not a Uint8Array. */
function b64url(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const decode = (input: string): unknown =>
  JSON.parse(new TextDecoder().decode(b64url(input)));

/* One fetch an hour, not one per request. Keys rotate slowly; a request that
   pays for a round-trip to Cloudflare on every page view is a request that
   will time out under any real load. */
const cache = new Map<string, { keys: Jwk[]; until: number }>();
const CACHE_MS = 60 * 60 * 1000;

async function publicKeys(teamDomain: string, now: number): Promise<Jwk[] | null> {
  const hit = cache.get(teamDomain);
  if (hit && hit.until > now) return hit.keys;
  try {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!body.keys?.length) return null;
    cache.set(teamDomain, { keys: body.keys, until: now + CACHE_MS });
    return body.keys;
  } catch {
    /* Deny. A cert endpoint that cannot be reached tells us nothing about the
       token, and "nothing" is not "valid". */
    return null;
  }
}

export async function verifyAccess(
  request: Request,
  teamDomain: string | undefined,
  aud: string | undefined,
): Promise<AccessIdentity | null> {
  if (!teamDomain || !aud) return null;

  const token =
    request.headers.get('cf-access-jwt-assertion') ??
    /* The cookie is what a browser actually sends; the header is added by
       Cloudflare's edge. Accept either — both are verified identically. */
    (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ??
    null;
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; email?: string; sub?: string };
  try {
    header = decode(parts[0]) as typeof header;
    payload = decode(parts[1]) as typeof payload;
  } catch {
    return null;
  }

  /* Refuse anything that is not RS256 — explicitly including `none`, the
     classic JWT forgery: strip the signature, set alg to none, and a verifier
     that trusts the header's choice of algorithm accepts it. */
  if (header.alg !== 'RS256' || !header.kid) return null;

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(aud)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

  const keys = await publicKeys(teamDomain, Date.now());
  const jwk = keys?.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
  } catch {
    return null;
  }

  if (!payload.email) return null;
  return { email: payload.email, sub: payload.sub ?? '' };
}
