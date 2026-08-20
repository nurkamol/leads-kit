import type { APIRoute } from 'astro';
import { astroSubjectAccess } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * Everything held about one person — GDPR Art. 15, CCPA "right to know".
 *
 *   /api/leads/subject/?email=someone@example.com
 *
 * You have a month to answer one of these under GDPR, and 45 days under CCPA.
 * Doing it by hand means grepping a KV namespace under time pressure, which is
 * how the wrong record gets sent and the right one gets missed.
 *
 * The lookup is itself audited. "Who looked this person up, and when" is a
 * question a regulator asks, and a trail that only records destruction answers
 * half of it.
 */
const handler = astroSubjectAccess(() => leadsContext()!);

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
