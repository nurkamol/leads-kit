import { DEFAULT_PREFIX, type LeadRecord, type LeadsContext } from '../types.js';
import { leadKey } from '../handlers/keys.js';
import { DEFAULT_SCHEMA, validate, type LeadSchema } from './validate.js';
import { verifyTurnstile } from './turnstile.js';
import { checkRateLimit, type RateLimitOptions } from './ratelimit.js';
import type { Notifier } from './notify.js';

/** How the bot challenge went. Recorded on every lead. */
export type Verification = 'passed' | 'unavailable' | 'unverified' | 'not-configured';

export interface SubmitOptions {
  schema?: LeadSchema;
  /**
   * The field a real person never fills. Any value means a bot.
   * Name it something a form-filler WANTS to complete — `company`, `website`,
   * `fax` — and hide it with CSS, never `type="hidden"`: hidden inputs are
   * skipped by the autofillers this is meant to catch.
   */
  honeypotField?: string;
  turnstile?: {
    secret: string;
    /**
     * Accept a submission with NO token at all.
     *
     * This is the one line that trades off two things you may both want. A
     * challenge cannot mint a token without JavaScript, so `false` means a
     * no-JS visitor cannot submit — and if the widget ever fails to load for
     * real visitors, `false` refuses EVERY enquiry silently.
     *
     * `true` does not disable Turnstile: a token that IS supplied is still
     * verified and a bad one is still refused. It only means the ABSENCE of a
     * token is recorded as `unverified` rather than blocking.
     *
     * Default `true`, because losing a client is worse than admitting spam:
     * spam is visible and deletable, and a form that silently rejects real
     * people is neither.
     */
    acceptWithoutToken?: boolean;
    field?: string;
  };
  rateLimit?: RateLimitOptions | false;
  notify?: Notifier;
  /** Seconds to keep the record. Retention is a promise; make the store keep it. */
  retentionSeconds?: number;
  /** Marks the environment on the record, so staging leads are identifiable. */
  env?: string;
  /** Extra fields copied from the payload, truncated. e.g. ['page']. */
  passthrough?: readonly string[];
  /** Where a no-JavaScript browser lands. See the honeypot note below. */
  redirects?: {
    success: string;
    /**
     * Where a failed submission goes.
     *
     * A string has the failing field names appended to it, so
     * `'/?invalid='` becomes `/?invalid=name,email`.
     *
     * A FUNCTION receives them and returns the whole URL — which is what you
     * need whenever anything must follow the field list. An anchor is the
     * common case: `/?invalid=name,email` lands at the top of the page with
     * the form and its error state below the fold, so the visitor sees a page
     * that appears merely to have scrolled rather than one reporting an error.
     */
    invalid: string | ((fields: string[]) => string);
    /** Where CAUGHT SPAM goes. Must NOT be `success` — see below. */
    honeypot: string;
  };
  /** The runtime's own client address. Never a header. */
  clientAddress?: string;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });

/** Build the invalid-redirect URL from either form of the option. */
const invalidUrl = (
  invalid: string | ((fields: string[]) => string),
  fields: string[],
): string =>
  typeof invalid === 'function'
    ? invalid(fields)
    : `${invalid}${encodeURIComponent(fields.join(','))}`;

/**
 * A native form POST must not land on a page of raw JSON. The enhanced path
 * sends `accept: application/json`; anything else is a browser submitting the
 * form directly, and gets a redirect it can follow.
 */
const wantsHtml = (request: Request) => {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
};

/**
 * Refuse a POST that came from someone else's page.
 *
 * A browser always sends `Origin` on a cross-origin POST, so comparing it to
 * our own host blocks the case this is for: another site putting a form in
 * front of visitors that writes into this store.
 *
 * ⚠ WHAT IT DOES NOT STOP, so nobody reads more into it: a script posting
 * directly can simply omit the header, and `Origin` is absent on a same-origin
 * form post from some privacy tooling — so absent must be ALLOWED, or the
 * no-JavaScript path breaks for real people. Spam is the honeypot's job.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Accept a submission: validate it, store it, then notify.
 *
 * ── THE ORDER IS THE POINT OF THIS FUNCTION ───────────────────────────────
 * Every step below is placed where it is for a reason that is invisible in a
 * status-code test. Reordering any of them leaves a version that passes the
 * same tests and is wrong.
 *
 *   1. Cross-origin refusal — BEFORE parsing or validating. Ordered after, it
 *      only ever fires on submissions that were being rejected anyway, so the
 *      check looks present and protects nothing.
 *   2. Honeypot — free and local. No reason to spend a network round trip on
 *      a submission already known to be a bot.
 *   3. Rate limit — one store read, cheaper than siteverify.
 *   4. Turnstile — a network call, so last of the refusals. Before validation
 *      for the same reason as (1): a refusal should not depend on whether the
 *      payload happened to be well-formed.
 *   5. Validate.
 *   6. STORE. Durable first.
 *   7. Notify. Third party last, and its failure is logged, never fatal — a
 *      provider outage must cost a notification, not a lead. If the store
 *      itself failed we still try to notify, because an email in an inbox
 *      beats losing the enquiry entirely.
 */
export async function handleSubmit(
  request: Request,
  ctx: LeadsContext,
  options: SubmitOptions = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed\n', { status: 405, headers: { allow: 'POST' } });
  }

  // ── 1. Cross-origin ───────────────────────────────────────────────────
  if (!sameOrigin(request)) {
    return json({ ok: false, error: 'Cross-origin submissions are not accepted.' }, 403);
  }

  let input: Record<string, string>;
  try {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      input = (await request.json()) as Record<string, string>;
    } else {
      const form = await request.formData();
      input = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
    }
  } catch {
    return json({ ok: false, error: 'Could not read the submission.' }, 400);
  }

  const html = wantsHtml(request);

  // ── 2. Honeypot ───────────────────────────────────────────────────────
  /*
   * Accept SILENTLY. Telling a bot it was caught teaches it to try again
   * without the field.
   *
   * ⚠ AND IT MUST NOT LAND ON THE SUCCESS URL. That URL is usually the
   * conversion — analytics fires `generate_lead` on it for the no-JS path.
   * Sending caught spam there lets any bot that runs JavaScript inflate the
   * only conversion the site owns, silently, in a shape that looks like the
   * site performing unusually well. Nobody investigates that.
   */
  const honeypot = options.honeypotField ?? 'company';
  if (input[honeypot]) {
    return html && options.redirects
      ? seeOther(options.redirects.honeypot)
      : json({ ok: true, id: 'accepted' }, 200);
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────
  if (options.rateLimit !== false) {
    const check = await checkRateLimit(
      ctx.store,
      options.clientAddress ?? '',
      options.rateLimit ?? {},
    );
    if (!check.allowed) {
      return json({ ok: false, error: 'Too many submissions. Please try again shortly.' }, 429);
    }
  }

  // ── 4. Turnstile ──────────────────────────────────────────────────────
  let verification: Verification = 'not-configured';

  if (options.turnstile?.secret) {
    const field = options.turnstile.field ?? 'cf-turnstile-response';
    const token = typeof input[field] === 'string' ? input[field] : '';
    const acceptWithout = options.turnstile.acceptWithoutToken ?? true;

    if (!token) {
      if (!acceptWithout) {
        return html && options.redirects
          ? seeOther(invalidUrl(options.redirects.invalid, ['challenge']))
          : json({ ok: false, errors: { challenge: 'Complete the verification and try again.' } }, 422);
      }
      verification = 'unverified';
    } else {
      const verdict = await verifyTurnstile(
        token,
        options.turnstile.secret,
        options.clientAddress,
      );
      if (verdict.state === 'failed') {
        /* Cloudflare answered and the answer was no — the case the widget
           exists for. An expired token is the common HUMAN one, so the message
           has to be recoverable rather than an accusation. */
        return html && options.redirects
          ? seeOther(invalidUrl(options.redirects.invalid, ['challenge']))
          : json({ ok: false, errors: { challenge: 'Verification failed. Please try again.' } }, 422);
      }
      /* Learnt nothing. Let it through and mark it. */
      verification = verdict.state === 'unavailable' ? 'unavailable' : 'passed';
    }
  }

  // ── 5. Validate ───────────────────────────────────────────────────────
  const { ok, errors, values } = validate(input, options.schema ?? DEFAULT_SCHEMA);
  if (!ok) {
    return html && options.redirects
      ? seeOther(invalidUrl(options.redirects.invalid, Object.keys(errors)))
      : json({ ok: false, errors }, 422);
  }

  const receivedAt = new Date().toISOString();
  const lead: LeadRecord = {
    id: crypto.randomUUID(),
    receivedAt,
    env: options.env ?? 'live',
    ...values,
    name: values.name ?? '',
    email: values.email ?? '',
    verification,
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    country: request.headers.get('cf-ipcountry') ?? '',
    ip: options.clientAddress ?? '',
  };
  for (const field of options.passthrough ?? ['page']) {
    lead[field] = String(input[field] ?? '').slice(0, 300);
  }

  // ── 6. Store, BEFORE the third party ──────────────────────────────────
  let stored = false;
  try {
    await ctx.store.put(
      leadKey(lead as { receivedAt: string; id: string }, ctx.prefix ?? DEFAULT_PREFIX),
      JSON.stringify(lead),
      /*
       * Retention, enforced by the store rather than by anyone remembering.
       * Without a TTL the record is kept forever, and "indefinitely" is not an
       * answer to "how long do you hold this data".
       *
       * NOTE there is no metadata argument here, and that is deliberate: KV
       * `list()` returns metadata WITHOUT reading values, so anything put
       * there is exposed by a mere listing. Personal data belongs in the value.
       */
      options.retentionSeconds ? { expirationTtl: options.retentionSeconds } : undefined,
    );
    stored = true;
  } catch (error) {
    console.error('leads: store write failed', error);
  }

  // ── 7. Notify. Never fatal. ───────────────────────────────────────────
  let notified = false;
  if (options.notify) {
    try {
      await options.notify(lead);
      notified = true;
    } catch (error) {
      /* A provider outage costs a notification, not a lead. The enquiry is
         already durable at this point, which is the whole reason step 6 comes
         first. */
      console.error('leads: notification failed', error);
    }
  }

  if (!stored && !notified) {
    /* Both paths failed: the enquiry exists nowhere. This is the only case
       where the visitor must be told, because a cheerful "thanks!" over a lost
       message is the worst outcome this function can produce. */
    return json(
      { ok: false, error: 'We could not record your message. Please email us directly.' },
      503,
    );
  }

  return html && options.redirects
    ? seeOther(options.redirects.success)
    : json({ ok: true, id: lead.id, stored, notified }, 200);
}
