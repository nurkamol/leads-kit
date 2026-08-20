import type { LeadsContext } from '../types.js';
import { handleContacts, handleDelete, handleExport } from '../index.js';

/**
 * A bare Cloudflare Worker (or Deno, or Bun, or Hono — all the same shape).
 *
 * Routes by pathname so a whole leads surface is one `fetch` export. Returns
 * null when the path is not ours, so the caller keeps its own routing.
 */
export function leadsRouter(ctx: LeadsContext, base = '/api/leads') {
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === `${base}/delete`) {
      return handleDelete(request, ctx, { redirectTo: '/leads/?deleted=1' });
    }
    if (path === `${base}/contacts.csv`) return handleContacts(request, ctx);
    if (path === base || path === `${base}.csv` || path === `${base}.json`) {
      const format = path.endsWith('.csv') ? 'csv' : path.endsWith('.json') ? 'json' : undefined;
      return handleExport(request, ctx, format ? { format } : {});
    }
    return null;
  };
}
