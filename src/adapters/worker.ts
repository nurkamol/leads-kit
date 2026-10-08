import type { LeadsContext } from '../types.js';
import {
  formatFromPath,
  handleAudit,
  handleContacts,
  handleDelete,
  handleErasure,
  handleExport,
  handleSubjectAccess,
  handleSubmit,
  handleStatus,
  handleLeadsPage,
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
    if (path === `${base}/submit` || path === '/api/contact') {
      return handleSubmit(request, ctx, {
        clientAddress: request.headers.get('cf-connecting-ip') ?? undefined,
      });
    }
    if (path === '/leads') return handleLeadsPage(request, ctx);
    if (path === `${base}/status`) {
      return handleStatus(request, ctx, { redirectTo: '/leads/?updated=1' });
    }
    if (path === `${base}/subject`) return handleSubjectAccess(request, ctx);
    if (path === `${base}/erase`) return handleErasure(request, ctx);
    if (path === `${base}/audit`) return handleAudit(request, ctx);
    /*
     * The export, as `${base}` (format from `?format=`) or `${base}.<ext>`
     * for any format the handler can build.
     *
     * ⚠️ THE EXTENSIONS COME FROM `EXPORT_FORMATS`, NOT FROM A LIST HERE.
     * This used to spell out `.csv` and `.json` while BUILDERS held five
     * formats and the console's own toolbar linked to `.xlsx` — so the Excel
     * button 404'd in every project using this package, and did it in the
     * most misleading way available: the browser says «Failed to Download»,
     * which reads as a network fault, while CSV from the same toolbar works,
     * which reads as a problem with the spreadsheet. Deriving the paths from
     * the builders means a format added later is routed the day it is added.
     */
    const format = formatFromPath(path, base);
    if (path === base || format) {
      return handleExport(request, ctx, format ? { format } : {});
    }
    return null;
  };
}
