import type { APIRoute } from 'astro';
import { astroExport } from '@nurkamol/leads-kit/astro';
import { LEAD_COLUMNS } from '../../lib/lead';
import { leadsContext, noStore } from '../../lib/leads-context';

export const prerender = false;

/**
 * Every lead as a CSV, oldest first.
 *
 *   curl -H "Authorization: Bearer $LEADS_EXPORT_TOKEN" \
 *        https://nurkamol.com/api/leads.csv -o leads.csv
 *
 * The auth, the KV read and the CSV writing are @nurkamol/leads-kit — the same
 * code this project was the source of, now shared with every other site built
 * on it. What stays here is the one thing that is genuinely local: which
 * columns this project's records have, and in what order.
 *
 * Supports ?since ?until ?q ?email ?limit.
 */
const handler = astroExport(() => leadsContext()!, { format: 'csv', columns: LEAD_COLUMNS });

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
