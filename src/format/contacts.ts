import type { LeadRecord } from '../types.js';
import { csvFile, csvRow } from './csv.js';

/**
 * Contact-list exports: Mailchimp, Klaviyo, and a neutral CRM shape.
 *
 * ── READ THIS BEFORE SENDING ANYTHING BUILT FROM THESE ────────────────────
 * A contact form is not consent. Under GDPR/PECR the consent is the thing
 * that makes a marketing send lawful, and most privacy notices attached to a
 * contact form say in as many words that the person will not be added to a
 * mailing list. Exporting them into a mailer is one careless import away from
 * breaking that promise.
 *
 * So these files are built to be IMPORTABLE without being MAILABLE:
 *
 *   · no subscribe or consent column is emitted, so neither platform can read
 *     one and mark the profile subscribed on import
 *   · every row carries the consent status and its source in plain words, so
 *     the state travels WITH the data instead of being lost the moment the
 *     file leaves the repo it was generated in
 *   · a `no-marketing-consent` tag lands on every contact, so a segment can
 *     exclude them and a person eyeballing the list can see it
 *
 * Import as "Non-subscribed" in Mailchimp, and as profiles rather than a list
 * subscription in Klaviyo.
 *
 * If real marketing consent is ever collected it belongs in the FORM, as a
 * separate unticked box stored on the record — at which point pass
 * `consent: { status, source }` below and change the privacy notice to match.
 * Both, not one.
 */
export interface ConsentStatement {
  status: string;
  source: string;
  tags: string;
}

export const NO_CONSENT: ConsentStatement = {
  status: 'none',
  source: 'website contact form — enquiry only, no marketing consent given',
  tags: 'website-enquiry,no-marketing-consent',
};

/**
 * Split a display name into first and last.
 *
 * The last whitespace run wins, so "Nurkamol Vakhidov" splits as expected and
 * "Nurkamol" stays a first name with an empty last rather than being copied
 * into both — Mailchimp merge tags render "Hi Nurkamol Nurkamol" otherwise.
 *
 * Plenty of names do not work this way. That is why the full string is also
 * emitted verbatim in its own column rather than being thrown away here.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * A phone number only if it is already E.164, otherwise nothing.
 *
 * Klaviyo REJECTS THE WHOLE PROFILE on a malformed phone_number rather than
 * ignoring the field, so one person who typed "call me on the mobile" costs
 * you their entire row. A form that does not require a country code cannot
 * infer one either — a bare "90 123 45 67" is a different subscriber in every
 * country that could have produced it. Blank is recoverable; wrong is not.
 */
export function e164(phone: unknown): string {
  const trimmed = String(phone ?? '').trim();
  if (!trimmed.startsWith('+')) return '';
  const digits = trimmed.slice(1).replace(/[\s()\-.]/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : '';
}

/** Latest enquiry per email address, so an import does not fight itself. */
export function dedupeByEmail(leads: LeadRecord[]): LeadRecord[] {
  const byEmail = new Map<string, LeadRecord>();
  for (const lead of leads) {
    const key = String(lead.email ?? '').trim().toLowerCase();
    if (!key) continue;
    const seen = byEmail.get(key);
    /* Compare timestamps rather than trusting input order: a caller who hands
       us newest-first would otherwise keep the OLDEST enquiry, silently, and
       the file would still look perfectly reasonable. */
    if (!seen || String(lead.receivedAt) > String(seen.receivedAt)) byEmail.set(key, lead);
  }
  return [...byEmail.values()];
}

const email = (l: LeadRecord) => String(l.email ?? '').trim().toLowerCase();

/**
 * Mailchimp audience import.
 *
 * The first four headers are Mailchimp's own defaults so its column mapper
 * matches them without anyone clicking through a dozen dropdowns. The
 * uppercase ones become merge tags. `Tags` is comma-joined inside one cell,
 * which is the format its importer expects.
 *
 * The enquiry MESSAGE is deliberately not here. Mailchimp text merge fields
 * cap out around 255 characters and truncate quietly past it, so a real
 * enquiry would arrive half-missing and look complete. Klaviyo has no such
 * limit and keeps it; a CRM wants it in full, which is what toContactsCsv is
 * for. An audience is a list of people, not a copy of the inbox.
 */
export function toMailchimpCsv(leads: LeadRecord[], consent = NO_CONSENT): string {
  const header = csvRow([
    'Email Address', 'First Name', 'Last Name', 'Phone', 'Tags',
    'FULLNAME', 'SERVICE', 'BUDGET', 'TIMELINE', 'ENQUIRED', 'SOURCEPAGE',
    'COUNTRY', 'CONSENT', 'CONSENTSRC',
  ]);
  const rows = dedupeByEmail(leads).map((l) => {
    const { first, last } = splitName(String(l.name ?? ''));
    return csvRow([
      email(l), first, last, e164(l.phone), consent.tags,
      l.name, l.service, l.budget, l.timeline, l.receivedAt, l.page,
      l.country, consent.status, consent.source,
    ]);
  });
  return csvFile([header, ...rows]);
}

/**
 * Klaviyo profile import.
 *
 * Klaviyo maps its reserved fields from these exact lowercase names; any other
 * column becomes a custom profile property, which is why the enquiry detail is
 * spelt out in words rather than abbreviated the way merge tags must be.
 *
 * Deliberately absent: `Email Marketing Consent` and `$consent`. Klaviyo reads
 * those on import and subscribes the profile. See the module header.
 */
export function toKlaviyoCsv(leads: LeadRecord[], consent = NO_CONSENT): string {
  const header = csvRow([
    'email', 'first_name', 'last_name', 'phone_number', 'country',
    'Full Name', 'Service Interest', 'Budget', 'Timeline', 'Enquiry Message',
    'Enquiry Date', 'Source Page', 'Source', 'Consent Status', 'Consent Source', 'Tags',
  ]);
  const rows = dedupeByEmail(leads).map((l) => {
    const { first, last } = splitName(String(l.name ?? ''));
    return csvRow([
      email(l), first, last, e164(l.phone), l.country,
      l.name, l.service, l.budget, l.timeline, l.message,
      l.receivedAt, l.page, 'website-contact-form',
      consent.status, consent.source, consent.tags,
    ]);
  });
  return csvFile([header, ...rows]);
}

/**
 * A neutral one, for everything that is not those two.
 *
 * HubSpot, Pipedrive, Zoho, Notion and Google Sheets all take a CSV whose
 * headers are readable English and map the columns themselves. Reach for this
 * when the destination is a CRM rather than a mailer, because a CRM wants the
 * whole enquiry, not a subscriber row — note that the phone is passed through
 * verbatim here rather than dropped for not being E.164.
 */
export function toContactsCsv(leads: LeadRecord[], consent = NO_CONSENT): string {
  const header = csvRow([
    'Email', 'First Name', 'Last Name', 'Full Name', 'Phone',
    'Service', 'Budget', 'Timeline', 'Message', 'Enquiry Date',
    'Source Page', 'Country', 'Verification', 'Consent Status', 'Consent Source',
  ]);
  const rows = dedupeByEmail(leads).map((l) => {
    const { first, last } = splitName(String(l.name ?? ''));
    return csvRow([
      email(l), first, last, l.name, l.phone,
      l.service, l.budget, l.timeline, l.message, l.receivedAt,
      l.page, l.country, l.verification, consent.status, consent.source,
    ]);
  });
  return csvFile([header, ...rows]);
}

export const CONTACT_FORMATS = {
  mailchimp: { build: toMailchimpCsv, label: 'Mailchimp' },
  klaviyo: { build: toKlaviyoCsv, label: 'Klaviyo' },
  contacts: { build: toContactsCsv, label: 'Contacts' },
} as const;

export type ContactFormat = keyof typeof CONTACT_FORMATS;
export const isContactFormat = (v: string): v is ContactFormat => v in CONTACT_FORMATS;
