# Templates

Reference implementations, not files to paste.

`astro/leads.astro` is a real page from a real site — which means its tokens,
its type scale and its copy belong to that site, not to yours. Read it for the
shape and the comments, then build the equivalent out of the host project's own
design system. If the installed page can be recognised as having come from
here, the install was done wrong.

The behaviour that must survive adaptation, whatever it ends up looking like:

- returns **404**, not 403, when the session does not verify
- the delete is a real `<form method="post">`, so it works without JavaScript;
  the `confirm()` is an enhancement layered on top, and names the person
- nothing hides an element that JavaScript is expected to reveal — a page that
  needs a bundle to render is a blank page whenever the bundle fails
- excluded from the sitemap
- `cache-control: no-store` on every response carrying enquiry data
