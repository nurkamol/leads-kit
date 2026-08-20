# Adapters

Each of these is a handful of lines, and that is the load-bearing fact about
this package rather than an accident of scope.

Astro, Next (App Router), SvelteKit, Nuxt/Nitro, Hono and a bare Cloudflare
Worker all speak the same two objects: a `Request` in, a `Response` out. So an
adapter has nothing to translate. It unwraps whatever container the framework
puts the `Request` in, and hands it to a handler that has never heard of that
framework.

The moment an adapter needs more than that — its own copy of the auth check,
its own KV read, its own CSV writer — the abstraction has failed and the
package has quietly become several packages that drift apart. If you find
yourself adding logic here, it belongs in `handlers/` instead.
