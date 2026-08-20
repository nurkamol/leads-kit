# Changelog

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
