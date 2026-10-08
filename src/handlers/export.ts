import type { LeadsContext } from '../types.js';
import { guard } from '../auth/guard.js';
import { CONTACT_FORMATS, isContactFormat } from '../format/contacts.js';
import { DEFAULT_COLUMNS, toCsv, toJson, toMarkdown, toXml } from '../format/records.js';
import { toXlsx } from '../format/xlsx.js';
import { prefixOf, queryFromUrl, readLeads } from './keys.js';

/* `build` returns a string for the text formats and bytes for xlsx. Response
   accepts both, so nothing branches on it beyond the type header. */
const BUILDERS = {
  csv: { build: toCsv, type: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { build: toJson, type: 'application/json; charset=utf-8', ext: 'json' },
  xml: { build: toXml, type: 'application/xml; charset=utf-8', ext: 'xml' },
  md: { build: toMarkdown, type: 'text/markdown; charset=utf-8', ext: 'md' },
  xlsx: {
    build: toXlsx,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
} as const;

export type ExportFormat = keyof typeof BUILDERS;

/**
 * Every format `handleExport` can produce.
 *
 * ⚠️ EXPORTED SO ROUTERS DERIVE THEIR PATHS FROM IT RATHER THAN RESTATING
 * THEM. The worker adapter used to match `.csv` and `.json` by hand while
 * this map held five formats and the console's toolbar linked to three. The
 * `.xlsx` button therefore 404'd in every project using the package — and
 * the symptom was «Failed to Download», which reads as a network fault
 * rather than a missing route. A list that must agree with another list, and
 * nothing to make them, is the whole defect; this removes the second list.
 */
export const EXPORT_FORMATS = Object.keys(BUILDERS) as readonly ExportFormat[];

/** `/api/leads.xlsx` → `xlsx`; `/api/leads` or an unknown suffix → null. */
export function formatFromPath(path: string, base: string): ExportFormat | null {
  if (!path.startsWith(`${base}.`)) return null;
  const ext = path.slice(base.length + 1);
  return (EXPORT_FORMATS as readonly string[]).includes(ext) ? (ext as ExportFormat) : null;
}

export interface ExportOptions {
  /** Fixed format, or read `?format=` from the URL when omitted. */
  format?: ExportFormat;
  columns?: readonly string[];
}

/**
 * Every lead, in whichever format was asked for.
 *
 * Auth runs BEFORE the format is validated, so an unauthenticated caller
 * cannot enumerate the supported formats by watching which values produce a
 * 400 and which produce a 401.
 */
export async function handleExport(
  request: Request,
  ctx: LeadsContext,
  options: ExportOptions = {},
): Promise<Response> {
  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const requested = options.format ?? (url.searchParams.get('format') ?? 'json');
  if (!(requested in BUILDERS)) {
    return new Response(
      `Unknown format "${requested}". Try: ${Object.keys(BUILDERS).join(', ')}.\n`,
      { status: 400 },
    );
  }

  /* ?since / ?until / ?q / ?email / ?limit. Filtering here rather than in the
     caller means a limit stops the fetch loop instead of trimming the result —
     the point of a limit is the reads it avoids. */
  const leads = await readLeads(ctx.store, prefixOf(ctx), queryFromUrl(url));
  const { build, type, ext } = BUILDERS[requested as ExportFormat];
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(build(leads, options.columns ?? DEFAULT_COLUMNS), {
    status: 200,
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="leads-${stamp}.${ext}"`,
      /* Personal data. Never in a shared cache, never in the back/forward
         cache of a machine someone else uses next. */
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

/** Contact-list CSV. READ src/format/contacts.ts before using the output. */
export async function handleContacts(request: Request, ctx: LeadsContext): Promise<Response> {
  const check = await guard(request, ctx);
  if (!check.ok) return check.response;

  const requested = new URL(request.url).searchParams.get('format') ?? 'contacts';
  if (!isContactFormat(requested)) {
    return new Response(
      `Unknown format "${requested}". Try: ${Object.keys(CONTACT_FORMATS).join(', ')}.\n`,
      { status: 400 },
    );
  }

  const leads = await readLeads(ctx.store, prefixOf(ctx), queryFromUrl(new URL(request.url)));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(CONTACT_FORMATS[requested].build(leads), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${requested}-${stamp}.csv"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
