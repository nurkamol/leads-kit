import type { LeadsContext } from '../types.js';
import {
  handleAudit,
  handleContacts,
  handleDelete,
  handleErasure,
  handleExport,
  handleSubjectAccess,
} from '../index.js';

/**
 * A bare Cloudflare Worker (or Deno, or Bun, or Hono — all the same shape).
 *
 * Routes by pathname so a whole leads surface is one `fetch` export. Returns
 * null when the path is not ours, so the caller keeps its own routing.
 */
export function leadsRouter(
  source: LeadsContext | ((request: Request) => LeadsContext),
  base = '/api/leads',
) {
  return async (request: Request): Promise<Response | null> => {
    /* A Worker's bindings arrive on `env` in fetch(), not at module scope, so
       the factory form is the normal one here too. */
    const ctx = typeof source === 'function' ? source(request) : source;
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === `${base}/delete`) {
      return handleDelete(request, ctx, { redirectTo: '/leads/?deleted=1' });
    }
    if (path === `${base}/contacts.csv`) return handleContacts(request, ctx);
    if (path === `${base}/subject`) return handleSubjectAccess(request, ctx);
    if (path === `${base}/erase`) return handleErasure(request, ctx);
    if (path === `${base}/audit`) return handleAudit(request, ctx);
    if (path === base || path === `${base}.csv` || path === `${base}.json`) {
      const format = path.endsWith('.csv') ? 'csv' : path.endsWith('.json') ? 'json' : undefined;
      return handleExport(request, ctx, format ? { format } : {});
    }
    return null;
  };
}
