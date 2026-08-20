import type { LeadRecord } from '../src/types.js';

/**
 * Accept either a bare array of leads or an object wrapping one.
 *
 * `handleExport` emits a bare array, but plenty of hand-written endpoints wrap
 * it — `{ exportedAt, count, leads: [...] }` is a natural thing to write, and
 * the site this package was extracted from does exactly that. Refusing it
 * meant the CLI failed against its own reference implementation, with an error
 * ("expected an array of leads") that described the symptom and named neither
 * the source nor the shape that actually arrived.
 *
 * Only well-known wrapper keys are unwrapped, and only when the value is an
 * array. Guessing at an arbitrary object would turn a malformed response into
 * a confusing EMPTY export rather than an error — and an empty export looks
 * like "no enquiries yet", which is the wrong thing to believe.
 *
 * Lives in its own module, and throws rather than exiting, so it can be tested
 * without the CLI's side effects running on import.
 */
export const WRAPPER_KEYS = ['leads', 'data', 'results', 'items', 'records'] as const;

export function unwrapLeads(body: unknown, source: string): LeadRecord[] {
  if (Array.isArray(body)) return body as LeadRecord[];

  if (body && typeof body === 'object') {
    for (const key of WRAPPER_KEYS) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as LeadRecord[];
    }
    const keys = Object.keys(body as object).join(', ') || '(none)';
    throw new Error(
      `${source} returned an object with no lead array in it.\n` +
        `  Keys present: ${keys}\n` +
        `  Expected a bare array, or one of: ${WRAPPER_KEYS.join(', ')}`,
    );
  }

  throw new Error(`${source} returned ${body === null ? 'null' : typeof body}, expected an array of leads`);
}
