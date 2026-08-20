import type { APIRoute } from 'astro';
import { astroDelete } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * Delete one enquiry. POST only, Access-verified, audited.
 *
 * Never a GET: a GET that deletes is one a prefetcher, a link scanner or the
 * browser's own speculation rules will eventually fire unprompted. It takes an
 * id and rebuilds the key server-side, because a client-supplied key is a
 * client-supplied delete target.
 *
 * CSRF is NOT handled in the package — deliberately, since it cannot know this
 * site's origin. Astro's `security.checkOrigin` covers it and is pinned in
 * astro.config.mjs. Re-test after touching this route:
 *
 *   curl -X POST https://nurkamol.com/api/leads/delete/    → must be refused
 */
const handler = astroDelete(() => leadsContext()!, '/leads/?deleted=1');

export const GET: APIRoute = () => new Response('Method not allowed\n', { status: 405 });
export const POST: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
