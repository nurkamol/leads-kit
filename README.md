# @nurkamol/leads-kit

Contact-form enquiries in Workers KV, read back safely.

Auth that verifies instead of trusting a header, an audited delete, and exports
that will not quietly turn an enquiry into a mailing-list subscriber.

```bash
npm install @nurkamol/leads-kit
```

## What it is

Two things, from one repo:

**The npm package** is the logic — reading the store, checking who is asking,
and turning records into files. It is framework-free: web standards only, no
`node:` imports, no framework imports, enforced by a test. That is what lets it
run on Workers, Deno, Bun, Node 18+ and both edge runtimes, and why the
framework adapters are eight lines each rather than a fork.

**The Claude Code plugin** is the fitting — the routes and the page, which have
to match the host project's conventions and design tokens. Those cannot be a
package: a component that ships its own palette looks pasted in, because it is.

```
/plugin marketplace add nurkamol/leads-kit
/plugin install leads-view
/leads-view
```

## The page is not in the package

Deliberately. A leads page needs the host site's typography, spacing and
colour, and there are only two ways to ship one from a package — drag a design
system along, or look foreign everywhere it lands. The plugin adapts a
reference implementation to the project it is being installed into, which is
judgement work, which is why an agent does it and a codemod does not.

## Use it

### Astro

```ts
// src/pages/api/leads.csv.ts
import { kvStore } from '@nurkamol/leads-kit';
import { astroExport } from '@nurkamol/leads-kit/astro';

export const prerender = false;   // or you publish a CDN file of everyone's enquiries

export const GET = astroExport(
  {
    store: kvStore(locals.runtime.env.LEADS),
    token: locals.runtime.env.LEADS_EXPORT_TOKEN,
    access: {
      teamDomain: locals.runtime.env.ACCESS_TEAM_DOMAIN,
      aud: locals.runtime.env.ACCESS_AUD,
    },
  },
  { format: 'csv' },
);
```

### Next (App Router)

```ts
// app/api/leads/delete/route.ts
import { kvStore } from '@nurkamol/leads-kit';
import { checkOrigin, nextDelete } from '@nurkamol/leads-kit/next';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Next has no CSRF default. Without this, a hostile page can POST here
  // carrying the visitor's own session cookie.
  const blocked = checkOrigin(request, 'https://example.com');
  if (blocked) return blocked;
  return nextDelete(ctx, '/leads?deleted=1')(request);
}
```

### Anything else

```ts
import { leadsRouter } from '@nurkamol/leads-kit/worker';

const leads = leadsRouter(ctx);
export default {
  async fetch(request) {
    return (await leads(request)) ?? new Response('Not found', { status: 404 });
  },
};
```

### A different store

Workers KV ships as `kvStore()`. Anything else is four methods:

```ts
const store: LeadStore = {
  list: (prefix) => /* every key, paging to exhaustion */,
  get: (key) => /* parsed record or null */,
  put: (key, value, opts) => /* honour opts.expirationTtl */,
  delete: (key) => /* … */,
};
```

## CLI

```bash
npx leads-kit export --url https://example.com --formats csv,klaviyo
```

Refuses to write to a directory inside a git repo that is not gitignored. The
retention promise in a privacy notice covers the database; it says nothing
about a copy committed to a public repository forever, and that is the one
mistake here that deleting the file afterwards does not undo.

## About the contact-list exports

Mailchimp, Klaviyo and a neutral CRM shape — built so they can be **imported
without being mailable**.

A contact form is not consent, and most privacy notices attached to one say in
as many words that the person will not be added to a mailing list. So no
subscribe column is emitted for either platform to read, every row carries the
consent status and its source in plain words, and a `no-marketing-consent` tag
lands on every contact. Import as non-subscribed.

If real consent is ever collected it belongs in the form, as a separate
unticked box stored on the record — and then the privacy notice changes to
match. Both, not one.

Two details that cost rows if you get them wrong, and are handled here: Klaviyo
rejects an entire profile on a malformed `phone_number` rather than ignoring
the field, so a number is emitted only when already E.164; and Mailchimp text
merge fields truncate near 255 characters, so the enquiry message is not in the
audience import at all.

## What it will not do for you

Create a KV namespace, set a secret, or configure Cloudflare Access. Those are
live-account operations, they are not reversible from here, and a machine with
more than one Cloudflare account configured is a machine where the wrong one is
a plausible accident. `RELEASING.md` and the plugin walk you through them.

## Verifying

Against the deployed site, always — a green build proves the bundler ran.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cf-Access-Jwt-Assertion: forged.token.here' -L https://host/leads/   # 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: CF_Authorization=forged'            -L https://host/leads/   # 404
curl -s -o /dev/null -w '%{http_code}\n'                                                    https://host/api/leads.csv   # 401
curl -s -o /dev/null -w '%{http_code}\n'                                                    https://host/api/leads/delete/  # 405
```

The forged cases are the ones that matter. If a route treats the presence of
`Cf-Access-Jwt-Assertion` as the check rather than verifying its signature,
both return 200 and nothing about the page looks wrong.

## Licence

MIT
