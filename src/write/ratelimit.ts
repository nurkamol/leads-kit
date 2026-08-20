import type { LeadStore } from '../types.js';

/**
 * A fixed-window rate limit, backed by the same store as the leads.
 *
 * ── WHAT THIS IS AND IS NOT FOR ───────────────────────────────────────────
 * It stops one address hammering the form: a script looping the endpoint, or a
 * person double-clicking submit five times. It does NOT stop a distributed
 * spam run — that is Turnstile's job, and no per-IP counter has ever been the
 * answer to a botnet.
 *
 * ── WHY FIXED WINDOW AND NOT A SLIDING ONE ────────────────────────────────
 * A sliding window needs either a list of timestamps per key or a second
 * counter, and both cost an extra round trip on the hot path of a form POST.
 * The known weakness of a fixed window is a burst across a boundary — up to 2×
 * the limit in a moment. For a contact form that is completely acceptable:
 * the cost of over-admitting is a duplicate enquiry, and the cost of
 * over-blocking is a lost client.
 *
 * ── AND WHY IT FAILS OPEN ─────────────────────────────────────────────────
 * If the store is unreachable, this ALLOWS. It is the same judgement as the
 * Turnstile outage rule: a storage blip must not be indistinguishable from
 * abuse, because the visible symptom of getting that wrong is a contact form
 * that silently refuses real people during an incident.
 */
export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit?: number;
  /** Window length in seconds. */
  windowSeconds?: number;
  prefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfter: number;
}

export const DEFAULT_RATE_LIMIT = { limit: 5, windowSeconds: 600, prefix: 'rl:' };

export async function checkRateLimit(
  store: LeadStore,
  identifier: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = options.limit ?? DEFAULT_RATE_LIMIT.limit;
  const windowSeconds = options.windowSeconds ?? DEFAULT_RATE_LIMIT.windowSeconds;
  const prefix = options.prefix ?? DEFAULT_RATE_LIMIT.prefix;

  /* No identifier means no runtime-vouched client address. Do NOT fall back to
     a header — an attacker sets those, so keying on one gives every request a
     fresh bucket and the limit becomes decorative while still looking present
     in the code. Better to allow and be honest about it. */
  if (!identifier) return { allowed: true, remaining: limit, retryAfter: 0 };

  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
  /* The window start is in the key, so a new window is a new key and the old
     one expires itself. No reset logic, and nothing to get wrong at a
     boundary. */
  const key = `${prefix}${windowStart}:${identifier}`;

  let count = 0;
  try {
    const existing = (await store.get(key)) as unknown as { n?: number } | null;
    count = Number(existing?.n ?? 0);
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }

  const retryAfter = Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - now) / 1000));

  if (count >= limit) return { allowed: false, remaining: 0, retryAfter };

  try {
    await store.put(key, JSON.stringify({ n: count + 1 }), {
      /* Twice the window, so a counter written at the very end of one cannot
         expire before the window it belongs to has closed. */
      expirationTtl: windowSeconds * 2,
    });
  } catch {
    /* Counted nothing. Allow — see the header note. */
  }

  return { allowed: true, remaining: Math.max(0, limit - count - 1), retryAfter };
}
