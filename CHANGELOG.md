# Changelog

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
