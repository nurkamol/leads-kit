# Changelog

## 0.3.0

**Added — the write path.** `handleSubmit` accepts a submission end to end:
cross-origin refusal, honeypot, rate limit, Turnstile, validation, store,
notify. Until now the package could only read leads, so every project
re-implemented the half where the security decisions live.

The ORDER is the deliverable. Each step sits where it does for a reason that a
status-code test cannot see — a reordered version returns identical statuses
and is wrong — so the suite asserts the order directly: a cross-origin POST
with a malformed body must be 403 and not 400; the honeypot must spend no
network call; the store `put` must be observed before the notifier.

**Turnstile**, with the outage rule: a bad token is refused, but a timeout, a
5xx or Cloudflare's own `internal-error` stores the lead flagged `unavailable`.
`acceptWithoutToken` defaults to `true` — a challenge cannot mint a token
without JavaScript, and `false` silently refuses every enquiry if the widget
fails to load.

**Rate limiting**, fixed-window, KV-backed, failing OPEN when the store is
unreachable — a storage blip must not be indistinguishable from abuse. Refuses
to key on an absent identifier rather than falling back to a header an attacker
controls.

**Validation** takes a schema, because the fields and select options belong to
the site. What is baked in is the phone rule: 7–15 digits per E.164, never a
10-digit US rule that rejects every UK, Irish and Australian visitor with an
error they cannot act on.

**Notification is an interface**, not a provider. An email provider is a
business decision with a price attached, and baking one in makes every install
inherit it.

74 tests, up from 49.

## 0.2.0

**Added — data-subject requests.** `handleSubjectAccess` returns everything
held about one address (GDPR Art. 15, CCPA "right to know"); `handleErasure`
deletes it (Art. 17). Both audited — including the *read*, because "who looked
this person up" is a question a regulator asks and a log that only records
destruction answers half of it. Erasure requires `confirm` to equal `email`,
since unlike a single delete it takes an unbounded number of records with it.

**Added — retention sweep.** `sweepExpired()` deletes leads past a retention
period. `expirationTtl` only applies to records written after it was
introduced; everything stored before that has none, and KV keeps a value
without one forever. Those records outlive the privacy notice that promised
they would not, and nothing flags it. Supports `dryRun`, and throws on a
non-positive retention period rather than computing a cutoff of "now" and
taking everything.

**Added — audit reader.** `readAudit` / `handleAudit`. We had been writing
`audit:` records since the delete handler existed and nothing could read them.
A log nobody can read is not a log; it is storage costs and a false sense of
accountability.

**Added — filtering.** `?since` `?until` `?q` `?email` `?limit` on the export
routes. Date bounds are pushed into the KV key range rather than filtered after
reading, which is what the timestamp-first key format was always for. Where no
value-level filter is present, `limit` applies to the key list, so it saves
reads rather than trimming results.

**Added — xlsx.** A real workbook, still zero dependencies. A CSV opened in
Excel turns `+998901234567` into scientific notation and strips leading zeros
from ids, and none of that looks like an error to whoever opens it. Header row
frozen.

**Changed — `readAllLeads` no longer loads everything by default.** Handlers
call `readLeads(store, prefix, query)`. The old behaviour loaded every record
into memory; a Worker has 128MB, and the failure was an isolate killed
mid-request with no message mentioning memory.

**Added** — `SECURITY.md`, and 30 more tests (49 total), including the first
coverage of `handleDelete` — previously untested, and the irreversible one.

## 0.1.2

**Fixed** — the CLI refused the response shape its own reference implementation
returns. `handleExport` emits a bare array, but a hand-written endpoint
commonly wraps it (`{ exportedAt, count, leads: [...] }`), and
`npx leads-kit export` died on that with an error naming neither the URL nor
the shape that arrived. It now accepts a bare array or a `leads` / `data` /
`results` / `items` / `records` wrapper.

Only those keys, and only when the value is an array. Guessing at an arbitrary
object would turn a malformed response into an empty export — and an empty
export reads as "no enquiries yet", which is a worse thing to believe than an
error.

## 0.1.1

**Fixed** — the Astro adapter could not work on Cloudflare. Bindings live at
`locals.runtime.env`, which only exists per request, but the adapter took a
plain context that had to be built at module scope. The documented example
referenced `locals` at the top level, where it is not defined; it could never
have run.

Adapters now accept a context **or a function returning one**, resolved per
request. The plain object stays supported for hosts whose env really is
available at import time.

## 0.1.0

Initial release. Extracted from nurkamol.com.
