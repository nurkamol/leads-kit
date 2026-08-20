import type { LeadsContext } from '../types.js';
import {
  handleAudit,
  handleContacts,
  handleDelete,
  handleErasure,
  handleExport,
  handleSubjectAccess,
  handleSubmit,
  handleStatus,
  handleLeadsPage,
  type ExportOptions,
  type SubmitOptions,
  type LeadsPageHandlerOptions,
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

/**
 * A context, or something that produces one from the request context.
 *
 * The factory may return **null**, and every adapter answers 503 when it does.
 *
 * That is not politeness, it removes a footgun. A `leadsContext()` that cannot
 * find its KV binding has to return something, and the honest something is
 * null — which then forced every single route to write either a `!` assertion
 * or the same four-line guard. `!` on a value that is genuinely sometimes null
 * is how a missing binding becomes a stack trace about `undefined` instead of
 * "lead storage is not bound", which is the one message that would have said
 * what to fix.
 */
export type ContextSource<C> = LeadsContext | ((context: C) => LeadsContext | null);

const resolve = <C>(source: ContextSource<C>, context: C): LeadsContext | null =>
  typeof source === 'function' ? source(context) : source;

/** The answer when the store is not bound. A deployment problem, so it reads like one. */
const unbound = () =>
  new Response('Lead storage is not bound.\n', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

const withCtx = <C, T>(
  source: ContextSource<C>,
  context: C,
  run: (ctx: LeadsContext) => Promise<Response> | Response,
): Promise<Response> | Response => {
  const ctx = resolve(source, context);
  return ctx ? run(ctx) : unbound();
};

export const astroExport =
  (source: ContextSource<AstroLike>, options?: ExportOptions) => (c: AstroLike) =>
    withCtx(source, c, (ctx) => handleExport(c.request, ctx, options));

export const astroContacts = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleContacts(c.request, ctx));

export const astroDelete = (source: ContextSource<AstroLike>, redirectTo?: string) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleDelete(c.request, ctx, { redirectTo }));

export const astroSubjectAccess = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleSubjectAccess(c.request, ctx));

export const astroErasure = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleErasure(c.request, ctx));

export const astroAudit = (source: ContextSource<AstroLike>) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleAudit(c.request, ctx));

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
    withCtx(source, c, (ctx) =>
      handleSubmit(c.request, ctx, { clientAddress: c.clientAddress, ...options }),
    );

export const astroStatus = (source: ContextSource<AstroLike>, redirectTo?: string) => (c: AstroLike) =>
  withCtx(source, c, (ctx) => handleStatus(c.request, ctx, { redirectTo }));

/**
 * The bundled leads page.
 *
 *   export const GET = astroLeadsPage(() => leadsContext()!, { siteName: 'X' });
 *
 * Needs `export const prerender = false` like every other route here — a
 * prerendered leads page is a file on a CDN with every enquiry in it.
 */
export const astroLeadsPage =
  (source: ContextSource<AstroLike>, options?: LeadsPageHandlerOptions) => (c: AstroLike) =>
    withCtx(source, c, (ctx) => handleLeadsPage(c.request, ctx, options));
