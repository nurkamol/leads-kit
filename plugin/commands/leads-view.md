---
description: Add a protected /leads page with exports and audited delete to this project
---

Install the leads view in **this** project.

Do not copy files blindly. The logic comes from the `@nurkamol/leads-kit`
package, which is framework-free; what you are fitting is the routing, the auth
wiring and the page, and those depend on things only this repo can tell you.

## 1. Read the project before writing anything

Establish, from the repo itself:

- **Framework** — look for `astro.config.*`, `next.config.*`, `svelte.config.*`,
  or a bare `wrangler.jsonc`/`wrangler.toml` with a `main`.
- **KV binding name and id** — in `wrangler.jsonc`/`wrangler.toml` under
  `kv_namespaces`. If there is none, stop and say so: this feature reads a
  store that has to already exist and already be receiving submissions. Do not
  create one silently.
- **The record shape actually being written** — find the form handler
  (`api/contact*`, `submit*`, anything calling `.put(`) and read what it stores.
  The columns must match the real fields, not the defaults in the package.
- **The key format** — the package assumes `lead:<iso>:<uuid>` so that KV's
  lexicographic order is chronological. If this project uses something else,
  pass `prefix` and adapt `leadKey`; do not renumber existing keys.
- **Design tokens** — `tokens.css`, `theme.css`, tailwind config. The page must
  use them. A page that ships its own palette looks like it was pasted in,
  because it was.
- **The privacy notice** — search for "mailing list", "marketing", "consent".
  What it promises decides whether the contact-list exports may be offered at
  all. Report what you find; do not decide it for them.

Report these back before proceeding. If any is ambiguous, ask.

## 2. Install

```bash
npm install @nurkamol/leads-kit
```

## 3. Wire the routes

Templates are in `${CLAUDE_PLUGIN_ROOT}/templates/`. Adapt, do not paste.

| | Astro | Next (App Router) |
| --- | --- | --- |
| Export | `src/pages/api/leads.csv.ts` | `app/api/leads/[format]/route.ts` |
| Contacts | `src/pages/api/leads/contacts.csv.ts` | `app/api/leads/contacts/route.ts` |
| Delete | `src/pages/api/leads/delete.ts` | `app/api/leads/delete/route.ts` |
| Page | `src/pages/leads.astro` | `app/leads/page.tsx` |

**Astro:** every route needs `export const prerender = false` — the default is
a build-time render, and a prerendered endpoint is a file on a CDN containing
everyone's enquiries. If `trailingSlash: 'always'`, the delete form's action
needs the slash; paths with a file extension are exempt.

**Next:** set `export const dynamic = 'force-dynamic'`, and add the origin
check from `@nurkamol/leads-kit/next` — Next has no CSRF default, so without it
a hostile page can POST to the delete route carrying the visitor's own cookie.

## 4. Cloudflare Access

Guide the user; do not attempt it for them — it is a live account operation and
this machine may have more than one account configured.

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain = production
   host, path = `leads`. Policy: Allow → Include → **Emails** → their address.
   Not "Everyone", not a whole domain.
2. Read the team domain and AUD out of an unauthenticated request rather than
   hunting the dashboard:
   ```bash
   curl -s -o /dev/null -w '%{redirect_url}\n' "https://<host>/leads/"
   # → https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…?kid=<AUD>&…
   ```
3. Put both in `wrangler` `vars`. They are **not** secrets — they are in plain
   sight in that redirect and authorise nothing on their own. Verification
   needs a signature from the team's published keys, which is the part that
   cannot be forged. In `vars` they are version-controlled and deploy with the
   code, so there is no separate step to forget.

## 5. Verify against the DEPLOYED site

A green build proves the bundler ran. Run every one of these:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -L "https://<host>/leads/"                              # 200 signed in
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cf-Access-Jwt-Assertion: forged.token.here' -L "https://<host>/leads/"
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: CF_Authorization=forged.token.here' -L "https://<host>/leads/"
curl -s -o /dev/null -w '%{http_code}\n' "https://<host>/api/leads.csv"                          # 401
curl -s -o /dev/null -w '%{http_code}\n' "https://<host>/api/leads/delete/"                      # 405
curl -s -X POST "https://<host>/api/leads/delete/"                                               # must be refused cross-site
```

**The forged-header cases are the ones that matter.** Presence of
`Cf-Access-Jwt-Assertion` is not the check; if the route treats it as one, both
return 200 and everything looks fine. They must return 404.

404, not 403 — a route serving personal data should not announce itself. For
the same reason, exclude `/leads` from the sitemap; a permanently-404 URL in a
sitemap is also a Search Console error.

## 6. Tell them what you did not do

Report explicitly: the Access application (theirs), the KV namespace (theirs),
the secrets (theirs), and whether the contact-list exports were wired and what
the privacy notice says about them.
