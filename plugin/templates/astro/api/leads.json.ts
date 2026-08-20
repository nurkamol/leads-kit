import type { APIRoute } from 'astro';
import { astroExport } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../lib/leads-context';

export const prerender = false;

/**
 * Every lead as JSON — the machine-readable twin of /api/leads.csv.
 *
 * ── THE SHAPE CHANGED ON 2026-08-20 ───────────────────────────────────────
 * This used to return `{ exportedAt, count, leads: [...] }`. It now returns a
 * bare array, which is what leads-kit emits and therefore what every other
 * site built on the package returns.
 *
 * `scripts/export-leads.mjs` was the only consumer and now accepts either, so
 * an older deployment does not break the newer script. If you add a consumer,
 * accept both — the wrapper shape is a natural thing to write and will show up
 * again.
 */
const handler = astroExport(() => leadsContext()!, { format: 'json' });

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
