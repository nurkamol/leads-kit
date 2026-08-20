import type { APIRoute } from 'astro';
import { astroErasure } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * Erase everything held about one person — GDPR Art. 17.
 *
 *   POST { "email": "…", "confirm": "…" }   both must match
 *
 * The address goes in the BODY, never the query string: a URL ends up in logs,
 * in history and in referrers, and the address of someone exercising an
 * erasure right is the last thing that should still be sitting in an access
 * log after their records are gone.
 *
 * `confirm` is required because, unlike deleting one enquiry, this takes an
 * unbounded number of records with it and the caller may not know how many.
 */
const handler = astroErasure(() => leadsContext()!);

export const GET: APIRoute = () => new Response('Method not allowed\n', { status: 405 });
export const POST: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
