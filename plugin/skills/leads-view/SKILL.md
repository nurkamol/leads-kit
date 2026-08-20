---
name: leads-view
description: Use when adding, changing, or debugging a protected leads/enquiries admin page backed by Workers KV — including Cloudflare Access JWT verification, lead exports (CSV, JSON, Mailchimp, Klaviyo), or an audited delete.
---

# Leads view

The traps in this feature, collected. Every one of them shipped green.

## Auth

- **A header is not a check.** `Cf-Access-Jwt-Assertion` is set by Cloudflare
  on requests it authenticated — and by anyone else who feels like sending it.
  Verify the signature against the team's published keys, match the audience,
  check expiry. Refuse any `alg` other than RS256, `none` above all.
- **Fail closed everywhere**, including on the cert fetch. "Cloudflare is
  unreachable" and "this token is forged" are indistinguishable from inside the
  function, so both must deny.
- **404, not 403.** A route serving personal data should not confirm it exists.
- **A browser cannot send an Authorization header by following a link.** A
  token-only guard 401s every download button on the page it protects. Accept a
  bearer token *or* a verified session, checking the token only when one is
  actually presented — otherwise a browser with no header gets a 401 it has no
  way to act on.

## Delete

- **POST, never GET.** Prefetchers, link scanners and speculation rules fire
  GETs nobody clicked.
- **Take an id, rebuild the key server-side.** A client-supplied key is a
  client-supplied delete target, and the lead prefix is not the only one in the
  namespace.
- **Audit before deleting**, so a failed audit write destroys nothing. Store
  the email's *domain*, not the address — an audit trail holding a second copy
  of the personal data has undone the deletion it records.
- **CSRF is a separate defence from authentication.** The session is a cookie
  and a cookie rides along on a cross-site POST. Astro's `security.checkOrigin`
  covers this (default on — pin it). Next does not, so check `Origin` yourself.

## Exports

- **KV `list()` caps at 1000 keys.** Ignore the cursor and the export silently
  truncates, which looks exactly like a small dataset.
- **BOM on every CSV**, or Excel renders accented names as mojibake and the
  person opening it blames the data.
- **A contact form is not marketing consent.** If the privacy notice says "you
  will not be added to a mailing list", the export must be importable without
  being mailable: no subscribe column, consent state in its own columns, a
  `no-marketing-consent` tag on every row. Raise it; do not quietly decide it.
- **Klaviyo rejects a whole profile on a malformed `phone_number`.** Emit it
  only when already E.164. A form without a country code cannot infer one, and
  guessing invents data.
- **Mailchimp text merge fields cap near 255 characters** and truncate quietly,
  so a long enquiry message does not belong in an audience import.

## Storage

- **Set an `expirationTtl`.** KV keeps a value forever otherwise, and
  "indefinitely" is not a retention period any regulator accepts. Keep the
  number and the privacy notice in step.
- **No personal data in KV metadata** — `list()` returns metadata without
  reading values, so anything there is exposed by a listing.

## Verifying

Against the deployed site. A green build proves the bundler ran. The
forged-header and forged-cookie cases are the ones worth re-running every time
the auth path is touched.
