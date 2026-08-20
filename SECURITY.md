# Security policy

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on
https://github.com/nurkamol/leads-kit. Please do not open a public issue for
anything exploitable.

This package guards personal data and verifies authentication tokens, so a bug
here is somebody else's data breach. Expect a first response within 72 hours.

## What this package is responsible for

**In scope** — a bug in any of these is a vulnerability:

| | |
| --- | --- |
| `verifyAccess` | accepting a token that should not verify: bad signature, wrong audience, expired, `alg` other than RS256 |
| `guard` | granting access without a valid token or session |
| `tokenMatches` | leaking the token through timing |
| `handleDelete` | deleting on a GET, deleting without auth, or deleting a key derived from client input |
| `handleErasure` | erasing records belonging to a different address |
| Audit records | containing personal data beyond the email domain |
| Any handler | returning enquiry data without `cache-control: no-store` |
| `renderLeadsPage` / `handleLeadsPage` | **any injection.** The page is built from enquiry data — a name, a message, a service, all typed by strangers — and a value reaching the HTML unescaped is stored XSS aimed at the one person who can read every enquiry and delete any of them |
| `esc` / `attr` / `safeUrl` / `scriptJson` | failing to neutralise a payload in the context each covers |
| `handleLeadsPage` | rendering the page for a request whose Access JWT does not verify, or when Access is not configured at all |

**Out of scope**, because this package cannot enforce them and says so in the
docs rather than pretending otherwise:

- **CSRF.** The session is a cookie, and a cookie rides along on a cross-site
  POST. Origin checking belongs where the site's own origin is known: Astro's
  `security.checkOrigin` (default on — pin it), or `checkOrigin()` from
  `@nurkamol/leads-kit/next`, which Next needs because it has no equivalent
  default. Verify it before shipping:
  `curl -X POST https://<host>/api/leads/delete/` must be refused.
- **Access configuration.** If the Cloudflare Access application does not cover
  the route, the route is exposed regardless of what this code does.
- **Prerendering.** An Astro endpoint without `export const prerender = false`
  becomes a file on a CDN containing every enquiry. That is a config mistake
  the package cannot detect at runtime.
- **Whether you may email the people in an export.** See below.

## A note on the rendered page

Since 0.8.0 this package renders `/leads` itself, which took on a risk it did
not previously carry. Astro escapes interpolated values; a string template does
not, so moving the page in moved it out from under that protection.

Four escaping functions rather than one, because the contexts fail differently
and a single "escape" invites using the wrong one:

- `esc` — HTML text and quoted attribute values
- `safeUrl` — a scheme allow-list. `javascript:alert(1)` contains not one
  character an HTML escaper touches, so escaping alone does nothing here
- `attr` — always quotes, so an unquoted attribute cannot be constructed
- `scriptJson` — inside `<script>` the parser looks for `</script` and nothing
  else, so entity escaping does not apply there at all

`test/ui.test.js` feeds a deliberately hostile record through the whole
renderer. If you are reporting an injection, adding a case there is the most
useful form the report can take.

The response also carries a restrictive `Content-Security-Policy`, and accepts
a `nonce`. Treat that as defence in depth, not as the fix: a page relying on
CSP to stay safe has already lost.

## The consent question is not a technical one

The contact-list exports are built so that neither Mailchimp nor Klaviyo can
mark a profile subscribed on import: no consent column, and the consent state
spelled out in its own columns. That is a guardrail, not permission.

A contact form is not marketing consent. If the site's privacy notice says
people will not be added to a mailing list, sending to a list built from these
files breaks that promise no matter what the CSV says.

## Supported versions

The latest minor. This is pre-1.0; patches land on `latest` only.

## Verification

Every release is published from CI with a SLSA provenance attestation. Check
what you installed came from this repository:

```bash
npm audit signatures
```
