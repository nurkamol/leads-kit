import type { LeadsContext } from '../types.js';
import { handleContacts, handleDelete, handleExport, type ExportOptions } from '../index.js';

/**
 * Astro API routes.
 *
 * Astro hands the route a context object; the Request is on `.request`. That
 * is the entire difference between Astro and a bare Worker.
 *
 * Every route using these needs `export const prerender = false` — the default
 * is a build-time render, and a prerendered endpoint is a file on a CDN with
 * everyone's enquiries in it.
 *
 * Two more things Astro-specific, both of which have bitten:
 *
 *   · trailingSlash:'always' makes /api/leads/delete redirect. A redirected
 *     POST is one round-trip and one spec assumption away from arriving with
 *     no body — so point the form at the slashed URL. Paths WITH a file
 *     extension are exempt, which is why contacts.csv needs none.
 *   · security.checkOrigin defaults to true and is what stops a hostile page
 *     POSTing to the delete route with the visitor's own cookie. Pin it in
 *     astro.config so switching it off has to be a deliberate, reviewable edit.
 */
type AstroLike = { request: Request };

export const astroExport = (ctx: LeadsContext, options?: ExportOptions) => (c: AstroLike) =>
  handleExport(c.request, ctx, options);

export const astroContacts = (ctx: LeadsContext) => (c: AstroLike) =>
  handleContacts(c.request, ctx);

export const astroDelete = (ctx: LeadsContext, redirectTo?: string) => (c: AstroLike) =>
  handleDelete(c.request, ctx, { redirectTo });
