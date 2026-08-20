import type { APIRoute } from 'astro';
import { kvStore, type LeadSchema } from '@nurkamol/leads-kit';
import { astroSubmit } from '@nurkamol/leads-kit/astro';
import {
  BUDGET_OPTIONS,
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
  type LeadRecord,
} from '../../lib/lead';
import { notifyTeam } from '../../lib/brevo';
import { site } from '../../data/site';
import { kv, secret } from '../../lib/runtime';

/**
 * The contact form's endpoint.
 *
 * ── WHAT MOVED, AND WHY THIS FILE IS NOW SHORT ────────────────────────────
 * The ordering — cross-origin refusal, honeypot, rate limit, Turnstile,
 * validate, STORE, notify — is @nurkamol/leads-kit's `handleSubmit`, extracted
 * from the version that used to live here. It is not a simplification: every
 * step is still in the same order for the same reasons, and the package's
 * tests now assert that order directly, which this file never did.
 *
 * What remains here is the part that is genuinely this site's: which fields
 * the form has, what the selects may contain, who gets emailed, and where a
 * no-JavaScript browser lands.
 *
 * This is the one route that needs a runtime. Everything else is static.
 */
export const prerender = false;

/**
 * Where the no-JavaScript path lands.
 *
 * The form lives on the home page's #contact section. `/contact/` still
 * resolves — it 301s to /#contact — but redirecting THROUGH that rule loses
 * the query string this route depends on: the browser followed
 * 303 → /contact/?invalid=email → 301 → /#contact and arrived with no way to
 * know what had failed, so a failed submission looked like a page that had
 * merely scrolled. These constants are the only place the destination is
 * written.
 */
const FORM_PAGE = '/';
const FORM_ANCHOR = '#contact';

/**
 * The form's own rules.
 *
 * The three option lists are the source of truth for the selects in
 * ContactModal.astro, and every string is copied from that markup exactly —
 * en dashes included. A value differing by one character is a valid-looking
 * enquiry that 422s with an error the visitor cannot act on.
 *
 * Budget and timeline are OPTIONAL: a required budget field is among the most
 * common reasons a good enquiry never gets sent, because the person does not
 * know yet and guessing feels like committing.
 *
 * Phone is optional too — this business publishes no phone number of its own
 * and is reached by email, Telegram and WhatsApp, so demanding one before a
 * visitor may write asks for a channel neither side intends to use. Validated
 * when given, because a mistyped number in the record is worse than an absent
 * one: it looks callable.
 */
const SCHEMA: LeadSchema = {
  name: { required: true, minLength: 2, maxLength: 100, message: 'Please tell us your name.' },
  email: {
    required: true,
    type: 'email',
    maxLength: 200,
    message: 'That email address does not look right.',
  },
  phone: { type: 'phone', message: 'That phone number does not look right.' },
  service: { oneOf: SERVICE_OPTIONS, message: 'Please choose one of the listed options.' },
  budget: { oneOf: BUDGET_OPTIONS, message: 'Please choose one of the listed options.' },
  timeline: { oneOf: TIMELINE_OPTIONS, message: 'Please choose one of the listed options.' },
  message: { maxLength: 4000, message: 'Please keep your message under 4000 characters.' },
};

const handler = astroSubmit(
  () => {
    const store = kv(site.leadsBinding);
    if (!store) throw new Error(`KV namespace ${site.leadsBinding} is not bound`);
    return { store: kvStore(store) };
  },
  {
    schema: SCHEMA,
    /* Named `company` because a form-filler WANTS to complete it, and hidden
       with CSS rather than type="hidden" — hidden inputs are skipped by the
       autofillers this is here to catch. See ContactModal.astro. */
    honeypotField: 'company',

    /*
     * `acceptWithoutToken` is left at the package default, `true`.
     *
     * It shipped here as `false` and broke the live form: the widget rendered
     * its wrapper and hidden input but never loaded the challenge iframe, so
     * no token was produced and EVERY submission was refused — silently. A
     * form that rejects real enquiries is far worse than one that admits spam:
     * spam is visible and deletable, a lost client is neither.
     *
     * It does not disable Turnstile. A token that IS supplied is still sent to
     * siteverify and a bad one is still refused. Set it to false only once the
     * widget is confirmed minting tokens for real visitors.
     */
    turnstile: site.turnstileSiteKey
      ? { secret: secret('TURNSTILE_SECRET_KEY') ?? '' }
      : undefined,

    rateLimit: { limit: 5, windowSeconds: 600 },

    /* The retention promise on /privacy, enforced by the store rather than by
       anyone remembering. Keep this and that page in step. */
    retentionSeconds: site.leadRetentionDays * 24 * 60 * 60,
    env: site.leadTag,
    passthrough: ['page'],

    /*
     * Content signals, for what Turnstile cannot catch: a human paid to fill
     * in forms, or a script driving a real browser. Both pass a challenge
     * exactly as a customer does.
     *
     * NO autoSpamAt. The package cannot refuse a submission and this project
     * will not file one away unread either — a false positive here is a lost
     * client, and the score sorting the list is worth having on its own.
     * Revisit once there is enough real spam to see where the scores actually
     * fall, rather than guessing a threshold now.
     */
    spam: {},

    /*
     * Deliberately NOT leads-kit's `brevoNotifier`.
     *
     * The builder sends plain text. src/lib/brevo.ts sends a formatted HTML
     * email with a labelled table, a [TEST] banner for staging leads, the
     * timestamp in the business's own timezone, and a reply-to already
     * pointing at the enquirer — so switching would be a downgrade dressed up
     * as consolidation. The builders exist for projects that have no such
     * thing, not to replace one that is better.
     *
     * This is the same line the migration drew everywhere else: the package
     * owns the mechanism, the site owns what is specific to this business.
     */
    notify: async (lead) => {
      const apiKey = secret('BREVO_API_KEY');
      if (!apiKey) return;
      const result = await notifyTeam(apiKey, lead as unknown as LeadRecord);
      /* Throw so the package logs it and reports notified:false. The enquiry
         is already stored by this point — that is the whole reason the store
         write comes first. */
      if (!result.ok) throw new Error(result.error);
    },

    redirects: {
      success: `${FORM_PAGE}?sent=1${FORM_ANCHOR}`,
      /*
       * A function, not a string, because the ANCHOR has to follow the field
       * list. `/?invalid=name,email` alone lands the visitor at the top of the
       * page with the form and its error state below the fold — a rejected
       * submission that looks like a page which merely scrolled. That is the
       * exact failure the FORM_ANCHOR note above is about.
       */
      invalid: (fields) =>
        `${FORM_PAGE}?invalid=${encodeURIComponent(fields.join(','))}${FORM_ANCHOR}`,
      /*
       * Caught spam goes to the PLAIN form page, never to `success`.
       *
       * `?sent=1` is the conversion: the page fires `generate_lead` on it for
       * the no-JavaScript path. Sending caught spam there lets any bot that
       * runs JavaScript inflate the only conversion this site owns — silently,
       * in a shape that looks like the site performing unusually well, which
       * nobody investigates.
       */
      honeypot: `${FORM_PAGE}${FORM_ANCHOR}`,
    },
  },
);

export const POST: APIRoute = (context) => handler(context);
