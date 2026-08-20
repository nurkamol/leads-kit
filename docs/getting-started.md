# Getting started

Adding enquiry capture and a protected reader to an existing project.

**The short way:**

```bash
npx leads-kit init
```

That writes everything below. The rest of this page is what it wrote and why,
which is worth reading either way — the decisions are the same whether a
generator made them or you did.

Or let the plugin do the fitting, which is worth it when the project is
unusual:

```
/plugin marketplace add nurkamol/leads-kit
/plugin install leads-view
/leads-view
```

---

## What you need before starting

- **A store.** Workers KV is what ships (`kvStore`). Anything else is four
  methods — see *A different store* at the end.
- **A way to authenticate the reader.** Cloudflare Access is what the auth path
  is built around. Without it, `/leads` returns 404 forever, which is the
  correct way to fail.
- **A form.** The package accepts submissions; it does not render the form.
  That one is public, sits in your layout, and belongs to you.

---

## Astro on Cloudflare

### 1. Install and bind

```bash
npm install @nurkamol/leads-kit
npx wrangler kv namespace create LEADS
```

`wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [{ "binding": "LEADS", "id": "<the id wrangler printed>" }],
  "vars": {
    // NOT secrets. Both appear in plain sight in Access's own redirect and
    // authorise nothing on their own — verification needs a signature from
    // the team's published keys, which is the part that cannot be forged.
    // In `vars` they are version-controlled and deploy with the code.
    "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
    "ACCESS_AUD": "<the AUD tag>"
  }
}
```

```bash
npx wrangler secret put LEADS_EXPORT_TOKEN     # openssl rand -hex 32
npx wrangler secret put TURNSTILE_SECRET_KEY   # if you use Turnstile
```

### 2. One module that builds the context

```ts
// src/lib/leads-context.ts
import { env } from 'cloudflare:workers';
import { kvStore, type LeadsContext } from '@nurkamol/leads-kit';

/**
 * A FUNCTION, not a constant.
 *
 * `env` is a lazy proxy: importing it is fine, reading a property outside a
 * request throws. Every adapter takes a factory for exactly this reason.
 */
export function leadsContext(): LeadsContext | null {
  const store = (env as Record<string, unknown>).LEADS;
  if (!store) return null;

  return {
    store: kvStore(store as never),
    token: (env as Record<string, string>).LEADS_EXPORT_TOKEN,
    access: {
      teamDomain: (env as Record<string, string>).ACCESS_TEAM_DOMAIN,
      aud: (env as Record<string, string>).ACCESS_AUD,
    },
    /* Needed by any write that REWRITES a record — a status change most
       obviously. KV cannot update a value while keeping its remaining expiry,
       so without this, marking a lead "replied" on day 364 grants it another
       full year and quietly outlives your privacy notice. */
    retentionSeconds: 365 * 24 * 60 * 60,
  };
}

/*
 * Returning null is the point: pass `leadsContext` itself to any adapter and
 * an unbound store becomes a 503 saying so. The alternative — a `!` assertion
 * in every route — turns a missing binding into a stack trace about
 * `undefined`, instead of the one message that says what to fix.
 */
```

### 3. The routes

Every one needs `export const prerender = false`. The default is a build-time
render, and a prerendered endpoint is a file on your CDN containing every
enquiry you have ever received.

```ts
// src/pages/api/contact.ts
import type { APIRoute } from 'astro';
import { astroSubmit } from '@nurkamol/leads-kit/astro';
import { leadsContext } from '../../lib/leads-context';

export const prerender = false;

export const POST: APIRoute = astroSubmit(leadsContext, {
  schema: {
    name: { required: true, minLength: 2, maxLength: 100 },
    email: { required: true, type: 'email' },
    phone: { type: 'phone' },
    message: { maxLength: 4000 },
  },
  honeypotField: 'company',
  rateLimit: { limit: 5, windowSeconds: 600 },
  retentionSeconds: 365 * 24 * 60 * 60,
  notify: async () => {
    /* your provider — or a builder, see Notifiers in the README */
  },
  redirects: {
    success: '/?sent=1#contact',
    // A FUNCTION when anything must follow the field list — an anchor, most
    // often. A string form ends at `/?invalid=name,email`, which on a
    // single-page site lands the visitor at the top with the form below the
    // fold: a rejected submission that looks like a page which merely scrolled.
    invalid: (fields) => `/?invalid=${encodeURIComponent(fields.join(','))}#contact`,
    // NEVER the success URL. That one is usually your conversion, and sending
    // caught spam there lets any bot running JavaScript inflate it.
    honeypot: '/#contact',
  },
});
```

```ts
// src/pages/leads.astro  — the whole file
---
import { astroLeadsPage } from '@nurkamol/leads-kit/astro';
import { leadsContext } from '../lib/leads-context';
import tokens from '../styles/tokens.css?raw';

export const prerender = false;

const handler = astroLeadsPage(leadsContext, {
  siteName: 'Your Site',
  backHref: '/',
  // ?raw, and this is the non-obvious bit. A plain CSS import does nothing
  // here: Astro injects stylesheets while rendering a TEMPLATE, and this page
  // renders none — it returns a Response. Without this the palette falls back
  // to the package's own colours and looks completely fine while not being
  // your site. Drop this line if you have no token file; it still looks
  // finished, just not yours.
  css: tokens,
});

return handler({ request: Astro.request, locals: Astro.locals as never });
---
```

The rest, each one line, all with `prerender = false`:

| File | Export |
| --- | --- |
| `src/pages/api/leads.csv.ts` | `astroExport(leadsContext, { format: 'csv' })` |
| `src/pages/api/leads.json.ts` | `astroExport(leadsContext, { format: 'json' })` |
| `src/pages/api/leads.xlsx.ts` | `astroExport(leadsContext, { format: 'xlsx' })` |
| `src/pages/api/leads/contacts.csv.ts` | `astroContacts(leadsContext)` |
| `src/pages/api/leads/delete.ts` | `astroDelete(leadsContext, '/leads/?deleted=1')` — POST only |
| `src/pages/api/leads/status.ts` | `astroStatus(leadsContext, '/leads/?updated=1')` — POST only |
| `src/pages/api/leads/subject.ts` | `astroSubjectAccess(leadsContext)` |
| `src/pages/api/leads/erase.ts` | `astroErasure(leadsContext)` — POST only |
| `src/pages/api/leads/audit.ts` | `astroAudit(leadsContext)` |

On the POST-only ones, also export a GET returning 405. A GET that deletes is
one a prefetcher or a link scanner will eventually fire with nobody having
clicked anything.

### 4. Two Astro settings that matter

```js
// astro.config.mjs
export default defineConfig({
  // Defaults to true. Pin it: it is the only thing stopping a hostile page
  // POSTing to your delete route carrying the visitor's own session cookie.
  // Access authenticates the person; this decides which SITE asked.
  security: { checkOrigin: true },
  trailingSlash: 'always',
});
```

With `trailingSlash: 'always'`, point forms at the **slashed** URL
(`/api/leads/delete/`). A redirected POST is one round-trip and one
spec-compliance assumption away from arriving with no body. Paths with a file
extension are exempt, which is why `contacts.csv` needs none.

Also exclude `/leads` from your sitemap. A page of personal data should not be
advertised, and a permanently-404 URL in a sitemap is a Search Console error.

### 5. Cloudflare Access

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain = your
   production host, path `leads`. Policy: Allow → Include → **Emails** → your
   address. Not "Everyone", not a whole domain.
2. Read the team domain and AUD out of an unauthenticated request rather than
   hunting the dashboard:
   ```bash
   curl -s -o /dev/null -w '%{redirect_url}\n' https://yoursite.com/leads/
   # → https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…?kid=<AUD>&…
   ```
3. Put both in `vars` and deploy.

### 6. Check it

```bash
npx leads-kit doctor --url https://yoursite.com
```

Reads `LEADS_EXPORT_TOKEN` from the environment or `.env`. **Never pass it as
`--token`** — `npm run` echoes the command it executes, so the secret lands in
your scrollback and in any CI log.

**Do not "verify" by curling `/leads` and reading the status.** Access
intercepts at the edge, so `curl -L` follows the redirect to its login page and
returns 200 — which reads as a failure if you check for 404 and as a pass if
you check "not the leads page". Neither answer is about your code. Doctor
probes the API routes, which Access does not cover.

---

## Next.js (App Router)

The same package; three differences worth knowing.

```ts
// app/leads/page.tsx  →  use a route handler, not a page
// app/leads/route.ts
import { nextLeadsPage } from '@nurkamol/leads-kit/next';
import { leadsContext } from '@/lib/leads-context';

export const dynamic = 'force-dynamic';   // or Next may cache it — a cached
                                          // enquiry list is a public one
export const GET = nextLeadsPage(leadsContext, { siteName: 'Your Site' });
```

**1. Next has no CSRF default.** Astro ships `security.checkOrigin`; Next does
not, so a hostile page can POST to your delete route with the visitor's cookie
unless you check. Use the helper:

```ts
// app/api/leads/delete/route.ts
import { checkOrigin, nextDelete } from '@nurkamol/leads-kit/next';
import { leadsContext } from '@/lib/leads-context';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const blocked = checkOrigin(request, 'https://yoursite.com');
  if (blocked) return blocked;
  return nextDelete(leadsContext, '/leads?deleted=1')(request);
}
```

**2. `clientAddress` does not exist.** Pass the address explicitly, and only one
your platform vouches for. On Vercel that is `x-forwarded-for`'s first entry,
because the platform overwrites it. On a self-hosted deployment behind an
arbitrary proxy that same header is whatever the client typed — and a rate
limit keyed on an attacker-controlled value gives every request a fresh bucket
while still looking present in the code.

**3. `process.env` is available at module scope**, so the plain-object context
form works. The factory is still accepted, and is what you want if the store
needs per-request state.

---

## A different store

`kvStore` wraps Workers KV. Anything else is four methods:

```ts
import type { LeadStore } from '@nurkamol/leads-kit';

const store: LeadStore = {
  list: async (prefix, opts) => [/* keys, sorted, honouring startAfter/endBefore */],
  get: async (key) => null,          // the parsed record, or null
  put: async (key, value, opts) => {}, // honour opts.expirationTtl
  delete: async (key) => {},
};
```

`list` must page to exhaustion. KV caps a page at 1000 keys, and a caller that
ignores the cursor gets a silently truncated export — the worst failure this
feature has, because 1000 rows looks exactly like all of them.

`startAfter`/`endBefore` are optional to honour: the handlers filter again
afterwards, so ignoring them costs performance and never correctness. Honouring
them turns a date filter into a key-range scan, which is what the
timestamp-first key format exists for.

---

## Then hand this over

[`using-the-leads-page.md`](using-the-leads-page.md) is written for whoever
reads the enquiries rather than for you. Put it in the handover.
