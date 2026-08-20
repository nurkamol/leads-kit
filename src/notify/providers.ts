import type { LeadRecord } from '../types.js';
import type { Notifier } from '../write/notify.js';
import { summariseLead } from '../write/notify.js';

/**
 * Ready-made notifiers, with no dependencies.
 *
 * ── WHY BUILDERS AND NOT A DEPENDENCY ─────────────────────────────────────
 * Every one of these is a single `fetch` against a documented JSON API. An SDK
 * would add a package, a version to track and a supply-chain surface, in
 * exchange for wrapping one POST. This package's whole proposition is that you
 * can install it into forty client sites without auditing anything.
 *
 * ── WHY THEY EXIST AT ALL, GIVEN Notifier IS THREE LINES ──────────────────
 * Because the three lines are never the problem. What is repeated in every
 * install is the same handful of decisions: a timeout, so a hanging provider
 * does not hold a form POST open; `reply_to` set to the ENQUIRER rather than
 * the site, which is the difference between hitting reply and copy-pasting an
 * address; and throwing on a non-2xx, because a provider that answers 401 and
 * is treated as success means notifications stop silently and nobody learns
 * until a client asks why they were ignored.
 *
 * All of them THROW on failure. `handleSubmit` catches, logs, and reports
 * `notified: false` — the lead is already stored by then, which is the whole
 * reason the store write comes first.
 */

/** A form POST is waiting on this. A slow provider must not become a slow site. */
const TIMEOUT_MS = 8000;

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : 'request failed'}`);
  }
  if (!res.ok) {
    /* Include the body. Every one of these APIs explains WHY in it — an
       unverified sender, a suspended account, a malformed address — and an
       error saying only "502" sends you to a status page instead of to the
       one line that fixes it. */
    const detail = await res.text().catch(() => '');
    throw new Error(`${label}: ${res.status} ${detail.slice(0, 300)}`);
  }
}

export interface EmailOptions {
  /** Who it comes from. Must be a verified sender at the provider. */
  from: string;
  /** Where it lands. A string or several. */
  to: string | string[];
  fromName?: string;
  /** Which lead field holds the enquirer's address, for reply-to. */
  replyToField?: string;
  subject?: (lead: LeadRecord) => string;
  body?: (lead: LeadRecord) => string;
}

const list = (to: string | string[]) => (Array.isArray(to) ? to : [to]);

const defaultSubject = (lead: LeadRecord) =>
  `New enquiry — ${String(lead.name ?? lead.email ?? 'website')}`;

/**
 * Reply-to is the enquirer, not the site.
 *
 * It is the single most useful line in any of these: it turns "reply" into a
 * reply to the person, instead of an email to yourself that you then have to
 * copy an address out of.
 */
const replyTo = (lead: LeadRecord, field = 'email') => {
  const value = String(lead[field] ?? '').trim();
  return value.includes('@') ? value : undefined;
};

/** Resend — https://resend.com/docs/api-reference/emails/send-email */
export function resendNotifier(apiKey: string, options: EmailOptions): Notifier {
  return async (lead) => {
    const reply = replyTo(lead, options.replyToField);
    await post(
      'https://api.resend.com/emails',
      { authorization: `Bearer ${apiKey}` },
      {
        from: options.fromName ? `${options.fromName} <${options.from}>` : options.from,
        to: list(options.to),
        subject: (options.subject ?? defaultSubject)(lead),
        text: (options.body ?? summariseLead)(lead),
        ...(reply ? { reply_to: reply } : {}),
      },
      'resend',
    );
  };
}

/** Brevo — https://developers.brevo.com/reference/sendtransacemail */
export function brevoNotifier(apiKey: string, options: EmailOptions): Notifier {
  return async (lead) => {
    const reply = replyTo(lead, options.replyToField);
    await post(
      'https://api.brevo.com/v3/smtp/email',
      { 'api-key': apiKey, accept: 'application/json' },
      {
        sender: { email: options.from, ...(options.fromName ? { name: options.fromName } : {}) },
        to: list(options.to).map((email) => ({ email })),
        subject: (options.subject ?? defaultSubject)(lead),
        textContent: (options.body ?? summariseLead)(lead),
        ...(reply ? { replyTo: { email: reply } } : {}),
      },
      'brevo',
    );
  };
}

/** Postmark — https://postmarkapp.com/developer/api/email-api */
export function postmarkNotifier(serverToken: string, options: EmailOptions): Notifier {
  return async (lead) => {
    const reply = replyTo(lead, options.replyToField);
    await post(
      'https://api.postmarkapp.com/email',
      { 'X-Postmark-Server-Token': serverToken, accept: 'application/json' },
      {
        From: options.fromName ? `${options.fromName} <${options.from}>` : options.from,
        To: list(options.to).join(','),
        Subject: (options.subject ?? defaultSubject)(lead),
        TextBody: (options.body ?? summariseLead)(lead),
        ...(reply ? { ReplyTo: reply } : {}),
        MessageStream: 'outbound',
      },
      'postmark',
    );
  };
}

/**
 * MailChannels, via a Cloudflare Worker.
 *
 * Worth knowing: it requires a DKIM-signed domain and an SPF record naming
 * MailChannels, and it silently drops mail that lacks them rather than
 * erroring — so a 202 here is not proof of delivery. Check the inbox once.
 */
export function mailChannelsNotifier(options: EmailOptions & { dkim?: { domain: string; selector: string; privateKey: string } }): Notifier {
  return async (lead) => {
    const reply = replyTo(lead, options.replyToField);
    await post(
      'https://api.mailchannels.net/tx/v1/send',
      {},
      {
        personalizations: [
          {
            to: list(options.to).map((email) => ({ email })),
            ...(options.dkim
              ? {
                  dkim_domain: options.dkim.domain,
                  dkim_selector: options.dkim.selector,
                  dkim_private_key: options.dkim.privateKey,
                }
              : {}),
          },
        ],
        from: { email: options.from, ...(options.fromName ? { name: options.fromName } : {}) },
        subject: (options.subject ?? defaultSubject)(lead),
        content: [{ type: 'text/plain', value: (options.body ?? summariseLead)(lead) }],
        ...(reply ? { reply_to: { email: reply } } : {}),
      },
      'mailchannels',
    );
  };
}

/**
 * Slack, via an incoming webhook.
 *
 * ⚠ The message is built from visitor input. `mrkdwn` is disabled so a
 * submission cannot inject formatting, links or an @channel into your
 * workspace — the message is data, not markup, and Slack will happily render
 * whatever it is given.
 */
export function slackNotifier(webhookUrl: string, options: { fields?: readonly string[] } = {}): Notifier {
  return async (lead) => {
    await post(
      webhookUrl,
      {},
      {
        text: `New enquiry from ${String(lead.name ?? lead.email ?? 'the website')}`,
        blocks: [
          {
            type: 'section',
            text: { type: 'plain_text', text: summariseLead(lead, options.fields), emoji: false },
          },
        ],
      },
      'slack',
    );
  };
}

/**
 * Anything that accepts a JSON POST: n8n, Zapier, Make, your own endpoint.
 *
 * Sends the whole record. If the destination is outside your control, pass
 * `fields` and send only what it needs — a webhook is an export, and every
 * field you include leaves your infrastructure permanently.
 */
export function webhookNotifier(
  url: string,
  options: { headers?: Record<string, string>; fields?: readonly string[] } = {},
): Notifier {
  return async (lead) => {
    const payload = options.fields
      ? Object.fromEntries(options.fields.map((f) => [f, lead[f]]))
      : lead;
    await post(url, options.headers ?? {}, { lead: payload }, 'webhook');
  };
}

/**
 * Send to several places, and do not let one failure hide another.
 *
 * `Promise.all` would reject on the first failure and skip the rest — so a
 * broken Slack webhook would stop the email that actually matters. This runs
 * all of them and reports every failure together.
 */
export function allNotifiers(...notifiers: Notifier[]): Notifier {
  return async (lead) => {
    const results = await Promise.allSettled(notifiers.map((n) => n(lead)));
    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    if (failed.length === results.length) throw new Error(`all notifiers failed: ${failed.join('; ')}`);
    if (failed.length) throw new Error(`${failed.length}/${results.length} notifiers failed: ${failed.join('; ')}`);
  };
}
