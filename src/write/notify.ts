import type { LeadRecord } from '../types.js';

/**
 * Notification, as an interface rather than a provider.
 *
 * This package does not depend on Brevo, Resend, Postmark or anything else,
 * and should not: an email provider is a business decision with a price
 * attached, and baking one in means every install inherits it. Twenty lines of
 * `fetch` against whichever API you already pay for satisfies this.
 *
 * The contract that matters is not the shape — it is WHERE it is called from.
 * See `handleSubmit`: the store write happens first, always. A notifier that
 * throws costs a notification. A notifier called first, that hangs, costs the
 * enquiry.
 */
export type Notifier = (lead: LeadRecord) => Promise<void>;

/**
 * A plain-text summary, for a notifier that wants one.
 *
 * Deliberately not HTML. This lands in the site owner's inbox, gets read on a
 * phone, and often gets forwarded — and a plain-text body survives all three
 * without a rendering step. The reply-to matters more than the formatting.
 */
export function summariseLead(lead: LeadRecord, fields?: readonly string[]): string {
  const keys =
    fields ??
    (Object.keys(lead).filter(
      (k) => !['id', 'env', 'ip', 'userAgent'].includes(k),
    ) as readonly string[]);

  return keys
    .map((key) => {
      const value = String(lead[key] ?? '').trim();
      return value ? `${key}: ${value}` : null;
    })
    .filter(Boolean)
    .join('\n');
}
