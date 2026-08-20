/**
 * Bearer token comparison that does not leak its answer in the timing.
 *
 * `a === b` on strings short-circuits at the first differing byte, so the time
 * it takes to fail is a measurement of how many leading characters were right.
 * Over enough requests that recovers the token one character at a time. This
 * compares every byte regardless.
 *
 * Length is checked FIRST, and not only as an optimisation: the reduce below
 * indexes `expected` by the PRESENTED string's length, so without the guard a
 * longer presented token reads past the end and compares against NaN — not a
 * match, but not the comparison anyone intended either.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  return header.replace(/^Bearer\s+/i, '');
}
