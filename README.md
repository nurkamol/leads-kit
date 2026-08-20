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

// A FUNCTION, not an object. On Cloudflare the bindings live at
// locals.runtime.env, which only exists per request — build the context at
// module scope and there is no KV namespace to reach.
export const GET = astroExport(({ locals }) => {
  const env = locals.runtime.env;
  return {
    store: kvStore(env.LEADS),
    token: env.LEADS_EXPORT_TOKEN,
    access: { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD },
  };
}, { format: 'csv' });
```

### Next (App Router)

```ts
// app/api/leads/delete/route.ts
import { kvStore } from '@nurkamol/leads-kit';
import { checkOrigin, nextDelete } from '@nurkamol/leads-kit/next';

export const dynamic = 'force-dynamic';

const ctx = () => ({
  store: kvStore(getKvBinding()),
  token: process.env.LEADS_EXPORT_TOKEN,
  access: {
    teamDomain: process.env.ACCESS_TEAM_DOMAIN,
    aud: process.env.ACCESS_AUD,
  },
});

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

## Accepting submissions

`handleSubmit` is the write path. **The order of its steps is the point of the
function** — every one is placed where it is for a reason invisible in a
status-code test, and a reordered version passes the same tests while being
wrong.

```ts
// src/pages/api/contact.ts
import { kvStore } from '@nurkamol/leads-kit';
import { astroSubmit } from '@nurkamol/leads-kit/astro';

export const prerender = false;

export const POST = astroSubmit(
  ({ locals }) => ({ store: kvStore(locals.runtime.env.LEADS) }),
  {
    schema: {
      name: { required: true, minLength: 2, maxLength: 100 },
      email: { required: true, type: 'email' },
      phone: { type: 'phone' },
      budget: { oneOf: BUDGET_OPTIONS },
      message: { maxLength: 4000 },
    },
    turnstile: { secret: env.TURNSTILE_SECRET_KEY },
    rateLimit: { limit: 5, windowSeconds: 600 },
    retentionSeconds: 365 * 24 * 60 * 60,
    notify: async (lead) => { /* your provider, ~20 lines of fetch */ },
    redirects: { success: '/?sent=1#contact', invalid: '/?invalid=', honeypot: '/#contact' },
  },
);
```

| Step | Placed there because |
| --- | --- |
| 1. Cross-origin | **Before parsing.** Ordered after, it only ever fires on submissions that were being rejected anyway — present in the code, protecting nothing |
| 2. Honeypot | Free and local. No network round trip on a request already known to be a bot |
| 3. Rate limit | One store read; cheaper than siteverify |
| 4. Turnstile | A network call, so last of the refusals — and before validation, so a refusal never depends on the payload being well-formed |
| 5. Validate | |
| 6. **Store** | Durable first |
| 7. Notify | Third party last. Its failure is logged, never fatal |

### Four decisions worth knowing about

**Caught spam must not land on your success URL.** That URL is usually the
conversion — analytics fires `generate_lead` on it for the no-JS path. Send
caught spam there and any bot running JavaScript inflates the only conversion
the site owns, silently, in a shape that looks like the site doing unusually
well. Nobody investigates that. Hence the separate `honeypot` redirect.

**A Turnstile outage stores the lead.** A bad token is refused — that is what
the widget is for. But a timeout, a 5xx, or Cloudflare's own `internal-error`
means you learnt *nothing* about the submission, and refusing there means an
outage silently costs real enquiries. Those are stored and flagged
`unavailable`, so they are visibly different from ones that passed.

**`acceptWithoutToken` defaults to `true`.** A challenge cannot mint a token
without JavaScript. With `false`, a no-JS visitor cannot submit at all — and if
the widget ever fails to load, *every* enquiry is refused silently. It does not
disable Turnstile: a supplied token is still verified and a bad one still
refused. Set it to `false` only once you have confirmed the widget mints tokens
for real visitors.

**Phone validation is country-agnostic**: 7–15 digits, per E.164. A 10-digit
rule is a US rule, and shipping one silently rejects every UK, Irish and
Australian visitor with an error they cannot act on, because their number is
correct.

### Rate limiting

Fixed window, keyed on the identifier you pass — and it **fails open** if the
store is unreachable, the same judgement as the Turnstile outage rule.

Pass only an address your runtime vouches for (`clientAddress`,
`cf-connecting-ip`). Never a forwarded-for header on a deployment where nothing
overwrites it: an attacker sets those, so every request gets a fresh bucket and
the limit is decorative while still looking present.

## Notifiers

The `Notifier` interface is three lines, so these builders are not there to
save you writing it. They exist because the same handful of decisions gets made
badly in every hand-rolled version:

```ts
import { resendNotifier, slackNotifier, allNotifiers } from '@nurkamol/leads-kit';

notify: allNotifiers(
  resendNotifier(env.RESEND_API_KEY, {
    from: 'hello@yoursite.com', fromName: 'Your Site', to: 'you@gmail.com',
  }),
  slackNotifier(env.SLACK_WEBHOOK),
),
```

Available: `resendNotifier`, `brevoNotifier`, `postmarkNotifier`,
`mailChannelsNotifier`, `slackNotifier`, `webhookNotifier` (n8n, Zapier, Make,
your own), and `allNotifiers` to combine them. No dependencies — each is one
`fetch` against a documented JSON API.

**What they get right that a quick version usually doesn't:**

- **`reply_to` is the enquirer, not the site.** This is the most useful line in
  any of them: it turns "reply" into a reply to the person, rather than an
  email to yourself that you then copy an address out of.
- **A timeout.** A form POST is waiting on this; a hanging provider must not
  become a hanging site.
- **A non-2xx throws, carrying the provider's own message.** A provider that
  answers 401 and is treated as success means notifications stop silently, and
  nobody finds out until a client asks why they were ignored. The body usually
  contains the one line that fixes it — "sender not verified", most often.
- **`allNotifiers` uses `allSettled`, not `all`.** A broken Slack webhook must
  not stop the email that actually matters.
- **Slack sends `plain_text`, not `mrkdwn`.** The message is built from visitor
  input, and Slack will happily render an injected link or an `@channel`.
- **`webhookNotifier` takes a `fields` list.** A webhook is an export: every
  field you include leaves your infrastructure permanently, so sending the
  whole record — IP address included — to a third party should be a decision.

⚠ **MailChannels** needs a DKIM-signed domain and an SPF record naming it, and
silently drops mail without them rather than erroring. A 202 there is not proof
of delivery; check the inbox once.

## Lead status

Before this, the only two things you could do with a lead were read it and
destroy it — which makes the list a viewer rather than an inbox, and means the
only way to clear something is to delete it. Deleting a real enquiry to tidy a
list is how you lose the record of a client you won.

```
POST /api/leads/status  { id, status }     new | replied | archived | spam
GET  /api/leads.csv?status=new             filter by it
```

Four statuses, not more: a status list becomes a workflow engine at six, and
the only question this answers is "does this still need me". `spam` is separate
from `archived` because they mean different things to whoever reads the list
next — one was dealt with, the other should never have arrived.

`summarise()` gains `unanswered` and `byStatus`. `unanswered` is the figure
worth putting at the top of a page; "12 total" is trivia.

### One trap worth knowing about

**KV cannot update a value while keeping its remaining expiry.** A `put` with
no TTL removes the expiry; a `put` with your retention period restarts it. So
marking a lead "replied" on day 364 would silently grant it another full year —
the record outlives the promise on your privacy page, and nothing reports it,
because from outside it is just a record that has not expired yet.

`setLeadStatus` computes what is LEFT from the original `receivedAt`, so a
status change can never extend retention. Pass `retentionSeconds` on the
context for that to work. If the period has already elapsed the write is
refused rather than resurrecting a record that was due to go.

## Data-subject requests

Someone can ask what you hold about them and ask you to delete it. Under GDPR
you have a month; under CCPA, 45 days. Neither regime cares that it is "just a
contact form" — a name, an address and free text about their situation is
personal data.

```ts
GET  /api/leads/subject?email=someone@example.com     // everything you hold
POST /api/leads/erase   { email, confirm: email }      // delete all of it
GET  /api/leads/audit?limit=50                         // who did what, newest first
```

Erasure needs `confirm` to equal `email`, because unlike deleting one enquiry
it takes an unbounded number of records with it and you may not know how many.
Both operations are audited — including the *read*, since "who looked this
person up" is a question worth being able to answer.

The audit records store the email's **domain**, never the address. A trail that
keeps a second copy of what it just erased has undone the erasure it records.

### Retention

```ts
import { sweepExpired } from '@nurkamol/leads-kit';

await sweepExpired(ctx, 365, { dryRun: true });   // report, touch nothing
await sweepExpired(ctx, 365);                     // then actually sweep
```

`expirationTtl` only covers records written *after* you started setting it.
Anything stored before has none, and KV keeps a value without one forever —
those records will outlive the privacy notice that promised they would not, and
nothing will ever flag it. Run this from a Cron Trigger.

Dry run first, always. A cutoff computed in the wrong unit is not something to
discover afterwards.

## Filtering

```
/api/leads.csv?since=2026-01-01&limit=100
/api/leads.csv?q=redesign
/api/leads.xlsx?email=someone@example.com
```

Date bounds become a **key range**, not a filter applied after reading — the
key format puts the timestamp first precisely so this works. Where no
value-level filter is present, `limit` applies to the key list, so it saves
reads rather than trimming results.

`q` cannot be pushed down: KV has no index, so the value must be read to be
searched. That one is honestly a scan, and is documented as one rather than
made to look cheap.

## Formats

| | |
| --- | --- |
| `csv` `json` `xml` `md` | the records, as they are |
| `xlsx` | a real workbook. A CSV in Excel turns `+998901234567` into scientific notation and strips leading zeros from ids — and none of that looks like an error to whoever opens it |
| `mailchimp` `klaviyo` `contacts` | contact lists — read the consent note below |

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
