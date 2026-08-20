import type { LeadsContext } from '../types.js';
import {
  handleAudit,
  handleContacts,
  handleDelete,
  handleErasure,
  handleExport,
  handleSubjectAccess,
  handleSubmit,
  type ExportOptions,
  type SubmitOptions,
} from '../index.js';

/**
 * Astro API routes.
 *
 * ── WHY THE CONTEXT MAY BE A FUNCTION ─────────────────────────────────────
 * On Cloudflare, the bindings live at `locals.runtime.env`, and `locals` only
 * exists PER REQUEST. So a context built at module scope cannot reach the KV
 * namespace or the secrets — the first version of this took a plain object and
 * the documented example referenced `locals` at the top level, where it is not
 * defined. It could never have run.
 *
 * Passing a factory is therefore the normal case on Cloudflare, and a plain
 * object stays supported for hosts whose env is genuinely available at import
 * time (Node adapters reading process.env, mostly).
 *
 * ── THREE MORE ASTRO SPECIFICS, ALL OF WHICH HAVE BITTEN ──────────────────
 *   · `export const prerender = false` on every route. The default is a
 *     build-time render, and a prerendered endpoint is a file on a CDN with
 *     everyone's enquiries in it.
 *   · trailingSlash:'always' makes /api/leads/delete redirect, and a
 *     redirected POST is one round-trip and one spec assumption away from
 *     arriving with no body — point the form at the slashed URL. Paths WITH a
 *     file extension are exempt, which is why contacts.csv needs none.
 *   · security.checkOrigin defaults to true and is what stops a hostile page
 *     POSTing to the delete route carrying the visitor's own cookie. Pin it in
 *     astro.config so turning it off is a deliberate, reviewable edit.
 */
export interface AstroLike {
  request: Request;
  locals?: unknown;
}

/** A context, or something that produces one from the request context. */
export type ContextSource<C> = LeadsContext | ((context: C) => LeadsContext);

const resolve = <C>(source: ContextSource<C>, context: C): LeadsContext =>
  typeof source === 'function' ? source(context) : source;

export const astroExport =
  (source: ContextSource<AstroLike>, options?: ExportOptions) => (c: AstroLike) =>
    handleExport(c.request, resolve(source, c), options);

export const astroContacts = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  handleContacts(c.request, resolve(source, c));

export const astroDelete = (source: ContextSource<AstroLike>, redirectTo?: string) => (c: AstroLike) =>
  handleDelete(c.request, resolve(source, c), { redirectTo });

export const astroSubjectAccess = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  handleSubjectAccess(c.request, resolve(source, c));

export const astroErasure = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  handleErasure(c.request, resolve(source, c));

export const astroAudit = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  handleAudit(c.request, resolve(source, c));

/**
 * The submit route.
 *
 * `clientAddress` is Astro's — the runtime's own view of who connected. Never
 * read it from a forwarded-for header: those are attacker-controlled, so a
 * rate limit keyed on one gives every request a fresh bucket while still
 * looking present in the code.
 */
export const astroSubmit =
  (source: ContextSource<AstroLike & { clientAddress?: string }>, options?: SubmitOptions) =>
  (c: AstroLike & { clientAddress?: string }) =>
    handleSubmit(c.request, resolve(source, c), {
      clientAddress: c.clientAddress,
      ...options,
    });
