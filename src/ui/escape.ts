/**
 * HTML escaping. Read this before touching anything in src/ui.
 *
 * -- WHY THIS IS THE MOST DANGEROUS FILE IN THE PACKAGE --------------------
 * Every value on the leads page came from a stranger: a name, a message, a
 * service, typed into a public form by whoever felt like it. Until now the
 * page was an Astro component, and Astro escapes interpolated values for you.
 * A string template does not. Moving the page into this package moved it out
 * from under that protection.
 *
 * So the rule is absolute: no value originating outside this package is ever
 * interpolated without passing through `esc`, `attr` or `safeUrl`. Not
 * "usually". One bare `${lead.name}` is stored XSS aimed squarely at the one
 * person who can read every enquiry and delete any of them.
 *
 * A test feeds a deliberately hostile record through the whole renderer and
 * asserts nothing executable survives. Extend it rather than trusting review.
 */

/**
 * Escape for HTML text content AND for a quoted attribute value.
 *
 * One function for both, because two invites picking the wrong one.
 *
 *   &      first, or the later replacements double-escape their own ampersands
 *   < >    element boundaries
 *   " '    attribute boundaries, both kinds, so a reviewer need not check
 *          which quoting a given template used
 *   `      an attribute delimiter in some older parsers; free to cover
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * A URL safe to place in href.
 *
 * Escaping alone does not make a URL safe: `javascript:alert(1)` contains not
 * one character `esc` touches and lands in an href intact. Only a scheme
 * allow-list helps, and anything unmatched becomes "#" rather than the
 * original.
 */
export function safeUrl(value: unknown): string {
  /* Strip control characters FIRST. "java\tscript:" is parsed as a scheme by
     some browsers and would walk straight past a naive prefix test. */
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '');
  if (/^(https?:|mailto:|\/|#|\?)/i.test(cleaned)) return esc(cleaned);
  return '#';
}

/** A quoted, escaped attribute value. Use for every dynamic attribute. */
export const attr = (value: unknown): string => `"${esc(value)}"`;

/**
 * Embed a value inside an inline <script>.
 *
 * `esc` is WRONG here. Inside a script element the HTML parser looks for the
 * literal `</script` and nothing else, so entity escaping does not apply --
 * but a closing tag inside a string still ends the block. JSON-encode, then
 * neutralise the sequences that can break out, including the two Unicode line
 * terminators that a JavaScript parser reads as literal newlines.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
