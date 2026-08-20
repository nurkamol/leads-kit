import type { APIRoute } from 'astro';
import { astroExport } from '@nurkamol/leads-kit/astro';
import { LEAD_COLUMNS } from '../../lib/lead';
import { leadsContext, noStore } from '../../lib/leads-context';

export const prerender = false;

/**
 * A real Excel workbook.
 *
 * Worth having over the CSV because Excel rewrites a CSV as it opens it: a
 * phone number becomes scientific notation, an id loses its leading zeros, a
 * date is reinterpreted in the local format. None of that is recoverable by
 * whoever opened the file, and none of it looks like an error — it looks like
 * the data is wrong. An xlsx carries the type with the cell.
 */
const handler = astroExport(() => leadsContext()!, { format: 'xlsx', columns: LEAD_COLUMNS });

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
