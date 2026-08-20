/**
 * Cloudflare Turnstile — server-side verification.
 *
 * A token from the widget proves nothing until siteverify says so. Rendering
 * the widget without this call is the failure Cloudflare's own dashboard warns
 * about, because a bot can post any string in that field.
 *
 * ── THE OUTAGE RULE ───────────────────────────────────────────────────────
 * There are two failures here and treating them alike is the bug:
 *
 *   the token is BAD           Cloudflare answered, and the answer was no.
 *                              Refuse. This is what the widget is for.
 *
 *   Cloudflare did not answer  Timeout, network error, 5xx, or its own
 *                              `internal-error` wearing a 200. We have learnt
 *                              NOTHING about this submission, and refusing
 *                              means a Turnstile outage silently costs real
 *                              enquiries.
 *
 * So an outage returns `unavailable`, the caller stores the lead, and the
 * record carries the flag. A little spam during an outage is recoverable and
 * visible; a lost client enquiry is neither, and nobody finds out it happened.
 */
export type TurnstileVerdict =
  | { state: 'passed' }
  | { state: 'failed'; codes: string[] }
  | { state: 'unavailable'; reason: string };

const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/*
 * A form POST is already waiting on this, so the budget is small. Cloudflare
 * answers in tens of milliseconds; past a few seconds it is an outage, and
 * waiting longer only makes the visitor watch a spinner before we decide to
 * let them through anyway.
 */
const TIMEOUT_MS = 4000;

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteip?: string,
): Promise<TurnstileVerdict> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  /* Genuinely optional: Cloudflare uses it as a signal, and sending a WRONG
     value is worse than sending none — so only pass an address the runtime
     actually vouches for, never one read out of a forwarded-for header. */
  if (remoteip) body.append('remoteip', remoteip);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { state: 'unavailable', reason: err instanceof Error ? err.name : 'fetch failed' };
  }

  /* A 5xx is Cloudflare failing, not the token failing. Same bucket as a
     timeout: we still know nothing about this submission. */
  if (!res.ok) return { state: 'unavailable', reason: `HTTP ${res.status}` };

  let data: { success?: boolean; 'error-codes'?: string[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { state: 'unavailable', reason: 'unreadable response' };
  }

  if (data.success) return { state: 'passed' };

  /* `internal-error` is Cloudflare telling us its own side broke — an outage
     wearing a 200. Everything else (missing, invalid, expired, already-used)
     is a real verdict about a real token. */
  const codes = data['error-codes'] ?? [];
  if (codes.includes('internal-error')) return { state: 'unavailable', reason: 'internal-error' };

  return { state: 'failed', codes };
}
