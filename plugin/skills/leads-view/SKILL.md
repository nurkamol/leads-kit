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

## The page

- **Prefer the bundled page** (`handleLeadsPage` / `astroLeadsPage`) over
  copying a template. The template shipped in this plugin went stale within six
  releases — importing a module the reference project had deleted — because a
  copy is a fork. As a handler, a fix reaches every install via `npm update`.
- **Its palette defers to the host**: `var(--ink, fallback)`. It looks native
  where a design system exists and finished where none does. That is what makes
  bundling it defensible, and it only holds because `/leads` is INTERNAL — on a
  public page the trade runs the other way.
- **If you hand-roll a page, escape everything.** Every field came from a
  stranger. Astro escapes interpolated values; a string template does not, and
  the mistake is stored XSS aimed at the person who can read every enquiry.
  Text, attributes, URLs and script bodies each need different treatment — a
  `javascript:` URL contains no character an HTML escaper touches.
- **Never sanitise by deleting.** Escape and show. A renderer that strips
  suspicious content hides what the enquiry actually said, which is the one
  thing the page exists to show you.

## Status, and the retention trap under it

- **KV cannot update a value while keeping its remaining expiry.** A `put` with
  no TTL removes the expiry; a `put` with the retention period restarts it. So
  marking a lead "replied" on day 364 silently grants it another full year —
  the record outlives the promise on the privacy page, and nothing reports it,
  because from outside it is indistinguishable from a record that has not
  expired yet. Compute what is LEFT from `receivedAt`, and refuse the write if
  the period has already elapsed rather than resurrecting it.
- **Absent means `new`.** Records written before statuses existed have no
  field, and treating that as unknown makes them vanish from a filtered view —
  which reads as data loss and sends someone hunting a bug in the store.
- **POST, not PATCH.** The controls have to work from a plain `<form>`, and a
  form can only issue GET or POST.
- **An unchanged status is a no-op.** Re-submitting the same value must not
  rewrite the record, or it touches the TTL for nothing.

## Spam signals

- **Score, never block.** Every signal has a false-positive case involving a
  real customer: a developer pasting staging URLs, someone typing fast, a
  person submitting twice because the first reply never came. Admitting spam
  costs a message you delete; refusing a client costs the client, and you never
  find out. Those are not comparable.
- **A whole message in another script is a customer, not a signal.**
- **Short messages are exempt from duplicate detection.** "Can you help with a
  website?" is a sentence two different customers will both write.
- **A count that never differs from the total is noise.** `not-configured` is
  not an unverified lead, it is a site with no challenge at all — counting it
  makes the warning permanent and teaches the reader to ignore the line.

## Storage

- **Set an `expirationTtl`.** KV keeps a value forever otherwise, and
  "indefinitely" is not a retention period any regulator accepts. Keep the
  number and the privacy notice in step.
- **No personal data in KV metadata** — `list()` returns metadata without
  reading values, so anything there is exposed by a listing.

## Verifying

Against the deployed site — a green build proves the bundler ran.

`npx leads-kit doctor --url https://host` covers the whole surface, including
the forged-assertion cases. It reads the token from the environment or `.env`;
never pass it as a flag, because `npm run` echoes the command and the secret
ends up in the scrollback and in CI logs.

**Testing `/leads` directly proves nothing.** Access intercepts at the edge, so
`curl -L` lands on its login page with a 200 — which looks like a failure if
you are checking for 404 and like a pass if you are checking "not the leads
page". The API routes are not covered by Access, so those are what exercise the
verification.
