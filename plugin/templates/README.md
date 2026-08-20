# Templates

Working files from a real site, refreshed on 2026-08-21 from nurkamol.com — the
project this package was extracted from, and its first consumer.

## The page works the moment you install it

`leads.astro` is **self-contained**. It defines its own palette, and every
value defers to the host's:

```css
--lk-ink:    var(--ink, #f0e3de);
--lk-accent: var(--accent, #f58634);
```

So on a project that already defines `--ink`, the page inherits it and looks
native. On one that defines nothing, it still renders as a finished admin tool
rather than unstyled HTML. `var(--x, fallback)` is a default, not a decision.

Fonts work the same way — `var(--font-body, system-ui, …)` — so a project that
has not loaded a typeface gets the system stack rather than Times.

**Why this page ships with a design when the rest of the UI does not:** `/leads`
is internal. Only the owner ever sees it, so "works immediately" is worth more
than "matches the brand exactly". On a public page that trade goes the other
way, which is why nothing else here is a component.

Every default pair clears WCAG AA — measured, not assumed. The obvious red for
the delete control (`#e5484d`) came out at 4.20:1 on the card surface and was
replaced.

If your project has a token file, importing it at the top of the page is better
still: the fallbacks then never fire, and a colour change reaches this page too.

The routes are different — they are thin by design, and copying them is close
to correct. What must change is the import paths and whatever the host calls
its KV binding.

```
leads.astro              → src/pages/leads.astro          (adapt the design)
leads-context.ts         → src/lib/leads-context.ts       (adapt the bindings)
api/contact.ts           → src/pages/api/contact.ts       (adapt the schema)
api/leads.csv|json|xlsx  → src/pages/api/
api/leads/*.ts           → src/pages/api/leads/
```

## What must survive adaptation, whatever it ends up looking like

- **404, not 403**, when the session does not verify
- **Every destructive control is a real `<form method="post">`** — the page
  works with no JavaScript, and the `confirm()` is an enhancement on top
- **Nothing hides an element that JavaScript is expected to reveal.** A page
  that needs a bundle to render is a blank page whenever the bundle fails
- **`export const prerender = false` on every route.** The default is a
  build-time render, and a prerendered endpoint is a file on a CDN containing
  every enquiry
- **`retentionSeconds` on the context.** Without it a status change silently
  restarts the retention clock — see the skill
- **`/leads` excluded from the sitemap**
- **`cache-control: no-store`** on everything carrying enquiry data

## Then check it

```bash
npx leads-kit doctor --url https://the-site.com
```

It probes the deployed site for the mistakes above that do not fail loudly.
Reads `LEADS_EXPORT_TOKEN` from the environment or `.env` — never pass it as a
flag, because `npm run` echoes the command.
