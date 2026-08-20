import type { APIRoute } from 'astro';
import { astroContacts } from '@nurkamol/leads-kit/astro';
import { leadsContext, noStore } from '../../../lib/leads-context';

export const prerender = false;

/**
 * Contact-list CSV: ?format=mailchimp | klaviyo, or omit for a neutral CRM shape.
 *
 * READ THE CONSENT NOTE in the package before sending to anything built from
 * this. /privacy tells everyone who uses the form they will not be added to a
 * mailing list, and none of these people ticked a marketing box — there isn't
 * one. The files are built so neither platform can mark a profile subscribed
 * on import, but that is a guardrail, not permission.
 */
const handler = astroContacts(() => leadsContext()!);

export const GET: APIRoute = (context) => (leadsContext() ? handler(context) : noStore());
