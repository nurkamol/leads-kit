/**
 * Field validation, configurable per project.
 *
 * ── WHY THE RULES ARE NOT BAKED IN ────────────────────────────────────────
 * The fields a form collects and the options in its selects belong to the
 * site, not to this package. A hard-coded service list would be wrong on the
 * second install; hard-coded copy would be wrong in the first non-English one.
 *
 * What IS baked in are the rules that are wrong everywhere when they are wrong
 * — see the phone note below, which is the one that quietly excludes half the
 * planet on most forms that ship.
 */

export interface FieldRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Must be one of these exactly. For selects. */
  oneOf?: readonly string[];
  /** Built-in shapes. `text` is the default and checks length only. */
  type?: 'email' | 'phone' | 'text';
  pattern?: RegExp;
  /** Shown to the visitor. Write it so they can act on it. */
  message?: string;
}

export type LeadSchema = Record<string, FieldRule>;

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
  values: Record<string, string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Country-agnostic, deliberately.
 *
 * E.164 caps a number at 15 digits including the country code, and 7 is about
 * the shortest real national number — so anything in that band is plausible
 * somewhere. A 10-digit rule is a US rule, and shipping one silently rejects
 * every UK, Irish and Australian visitor with an error they cannot act on
 * because their number IS correct.
 *
 * Tighten it per project if you serve exactly one country. Never tighten it in
 * a package that does not know which country that is.
 */
const PHONE_MIN = 7;
const PHONE_MAX = 15;
const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * A sensible starting point. Note what is OPTIONAL and why.
 *
 * Phone is optional because a required phone field is among the most common
 * reasons a good enquiry never gets sent — plenty of people will not give a
 * number to a form, and a business reachable by email does not need one. It is
 * still validated WHEN GIVEN, because a mistyped number in the record is worse
 * than an absent one: it looks callable.
 */
export const DEFAULT_SCHEMA: LeadSchema = {
  name: { required: true, minLength: 2, maxLength: 100, message: 'Please tell us your name.' },
  email: { required: true, type: 'email', maxLength: 200, message: 'That email address does not look right.' },
  phone: { type: 'phone', message: 'That phone number does not look right.' },
  message: { maxLength: 4000, message: 'Please keep your message under 4000 characters.' },
};

export function validate(
  input: Record<string, unknown>,
  schema: LeadSchema = DEFAULT_SCHEMA,
): ValidationResult {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const [field, rule] of Object.entries(schema)) {
    const value = String(input[field] ?? '').trim();
    values[field] = value;

    if (!value) {
      if (rule.required) errors[field] = rule.message ?? `${field} is required.`;
      /* Empty and optional. Every remaining rule describes a value, and
         applying them to "" produces an error about a field nobody filled. */
      continue;
    }

    if (rule.minLength && value.length < rule.minLength) {
      errors[field] = rule.message ?? `${field} is too short.`;
      continue;
    }
    if (rule.maxLength && value.length > rule.maxLength) {
      errors[field] = rule.message ?? `${field} is too long.`;
      continue;
    }

    /*
     * A select whose value is not in the list was not chosen through the UI.
     * Rejected rather than coerced to a default: a value that did not come
     * from the form means the request was crafted, and recording a guess is
     * worse than saying no — the guess ends up in the enquiry as though the
     * person had picked it.
     */
    if (rule.oneOf && !rule.oneOf.includes(value)) {
      errors[field] = rule.message ?? 'Please choose one of the listed options.';
      continue;
    }

    if (rule.type === 'email' && !EMAIL.test(value)) {
      errors[field] = rule.message ?? 'That email address does not look right.';
      continue;
    }

    if (rule.type === 'phone') {
      const digits = digitsOf(value);
      if (digits.length < PHONE_MIN || digits.length > PHONE_MAX) {
        errors[field] = rule.message ?? 'That phone number does not look right.';
        continue;
      }
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      errors[field] = rule.message ?? `${field} is not in the expected format.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}
