import type { APIRoute } from 'astro';
import { astroAudit } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * The audit trail — who deleted what, who looked up whom, newest first.
 *
 *   /api/leads/audit/?limit=50
 *
 * Records carry the email's DOMAIN, never the address: a trail that keeps a
 * second copy of what it just erased has undone the erasure it is recording.
 */
const handler = astroAudit(() => leadsContext()!);

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
