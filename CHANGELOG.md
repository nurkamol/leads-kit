# Changelog

## 0.7.1

**Fixed — the documented way to run `doctor` printed your token.**
`npm run doctor -- --token $LEADS_EXPORT_TOKEN` works, and `npm run` echoes the
command it is about to run, so the secret lands in the terminal, the
scrollback, any CI log, and `ps` output for every other process on the machine.
Found by running it once and reading my own output.

`doctor` now reads `LEADS_EXPORT_TOKEN` from the environment or a local `.env`.
`--token` still exists for a throwaway value, but the flag is no longer the
documented path, because documenting a flag is what invites the mistake.

## 0.7.0

**Added — `npx leads-kit doctor --url <site>`.** Every serious risk in this
package is a configuration mistake rather than a code bug: the code is tested,
the wiring is not, because the wiring lives in someone else's repo. A route
missing `prerender = false` publishes every enquiry as a file on a CDN;
`checkOrigin` off leaves delete reachable from a hostile page with the
visitor's own cookie; `/leads` in the sitemap invites a crawler to personal
data. None of those fail loudly.

Probes a deployed site for exactly those, including a forged
`Cf-Access-Jwt-Assertion`, an `alg:none` token and a forged `CF_Authorization`
cookie — the most common way this feature is built wrong is treating the
presence of that header as the check.

Read-only. The one POST is the CSRF probe, carrying a foreign `Origin` and an
all-zero id so it cannot match a record; a diagnostic that changes state is one
people stop running. Exits non-zero on failure, so it belongs in CI.

Every failure carries a fix, not just a verdict — asserted by a test.

Tested against deliberately misconfigured servers, because a checker that only
ever passes is worthless and the only way to know it would catch a real problem
is to give it one.

124 tests, up from 114.

## 0.6.0

**Added — spam scoring and duplicate detection**, for what Turnstile cannot
catch: a human paid to fill in forms, or a script driving a real browser. Both
pass a challenge exactly as a customer does; what separates them is content.

**It scores and never blocks, and the API gives you no way to make it.** Every
signal has a false-positive case involving a real customer, and the cost of
admitting spam (a message you delete) is not comparable to the cost of refusing
a client (you never find out). `autoSpamAt` is the only lever and it merely
pre-sets `status: 'spam'` — the enquiry is still stored, exported and readable.

Scoring runs AFTER validation and after the record is built, so admission is
already decided before any signal is computed.

Duplicate detection catches a spam run and, far more often, a person
double-clicking submit. Messages under 40 characters are exempt: "Can you help
with a website?" is a sentence two customers will both write.

The phrase list is deliberately short. A long one dates badly, is trivially
evaded, and every entry is a way to insult a customer whose business involves
the word.

114 tests, up from 97 — and the false-positive cases are tested first, because
they matter more than the detections.

## 0.5.0

**Added — notifier builders.** Resend, Brevo, Postmark, MailChannels, Slack, a
generic webhook, and `allNotifiers` to combine them. Still zero dependencies:
each is one `fetch` against a documented JSON API, and an SDK would add a
package and a supply-chain surface in exchange for wrapping one POST.

The `Notifier` interface is three lines, so these are not there to save typing.
They exist because the same decisions get made badly in every hand-rolled
version: `reply_to` set to the ENQUIRER rather than the site, a timeout so a
hanging provider does not hang the form POST, and throwing on a non-2xx —
because a provider answering 401 and treated as success means notifications
stop silently and nobody learns until a client asks why they were ignored.

`allNotifiers` uses `allSettled`: a broken Slack webhook must not stop the
email that actually matters. Slack sends `plain_text`, since the message is
built from visitor input and Slack renders `mrkdwn` — including injected links
and `@channel`. `webhookNotifier` takes a `fields` list, because a webhook is
an export and every field included leaves your infrastructure permanently.

97 tests, up from 88.

## 0.4.0

**Added — lead status.** `new` / `replied` / `archived` / `spam`, with
`handleStatus`, `?status=` filtering, and `unanswered` + `byStatus` on
`summarise()`. Until now the only two things you could do with a lead were read
it and destroy it, so the only way to clear one was to delete it — and deleting
a real enquiry to tidy a list is how you lose the record of a client you won.

Four statuses, not more. A status list becomes a workflow engine at six, and
the only question this answers is "does this still need me".

**The hard part was retention, not the field.** KV cannot update a value while
keeping its remaining expiry: a `put` without a TTL removes the expiry, and one
with the retention period restarts it. Marking a lead "replied" on day 364
would have granted it another full year — outliving the promise on the privacy
page, with nothing to report it, because from outside it is simply a record
that has not expired yet.

`remainingTtl()` counts down from the original `receivedAt`, so a status change
can never extend retention, and a lead already past its period is refused
rather than resurrected. `LeadsContext` gains `retentionSeconds` for this.

An absent status counts as `new` everywhere — filtering, summarising, display —
so records written before this release do not vanish from a filtered view,
which would read as data loss.

POST rather than PATCH: this has to work from a plain `<form>`, and a form can
only issue GET or POST.

88 tests, up from 76.

## 0.3.1

**Fixed** — `redirects.invalid` could not carry an anchor. It was a string with
the failing field names appended, so `/?invalid=` produced
`/?invalid=name,email` and nothing could follow. On a single-page site whose
form is a section, that lands the visitor at the TOP of the page with the form
and its error state below the fold — a failed submission looks like a page that
merely scrolled.

Found migrating nurkamol.com onto the package, where the hand-written route it
was extracted from had appended `#contact` all along.

`invalid` now also accepts `(fields: string[]) => string`, returning the whole
URL. The string form is unchanged.

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
