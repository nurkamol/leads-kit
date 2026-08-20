import type { APIRoute } from 'astro';
import { astroStatus } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * Move an enquiry along: new → replied → archived, or → spam.
 *
 * POST rather than PATCH, because the buttons on /leads are plain forms and a
 * form can only issue GET or POST. Tidier REST would cost the no-JavaScript
 * guarantee, which is not a trade this project makes.
 *
 * The retention subtlety is handled in the package and depends on
 * `retentionSeconds` being set in leadsContext — see the note there. Without
 * it, marking a lead replied would quietly extend how long it is kept.
 */
const handler = astroStatus(() => leadsContext()!, '/leads/?updated=1');

export const GET: APIRoute = () => new Response('Method not allowed\n', { status: 405 });
export const POST: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
