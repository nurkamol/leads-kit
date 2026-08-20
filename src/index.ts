/**
 * @nurkamol/leads-kit — contact-form enquiries, read back safely.
 *
 * Framework-free. Everything here is (Request, context) => Response or a pure
 * transform, built on web standards alone — so it runs on Workers, Deno, Bun,
 * Node 18+, Vercel Edge and Netlify Edge, and the framework adapters are a
 * handful of lines each rather than a fork of the logic.
 *
 * The UI is NOT in this package, on purpose: a leads page has to inherit the
 * host site's tokens and typography, and a component that ships its own would
 * either drag a design system along or look foreign everywhere it landed.
 * That part is the Claude Code plugin's job — see plugin/ in this repo.
 */
export * from './types.js';
export * from './store/kv.js';
export * from './auth/token.js';
export * from './auth/access.js';
export * from './auth/guard.js';
export * from './format/index.js';
export * from './handlers/keys.js';
export * from './handlers/export.js';
export * from './handlers/delete.js';
export * from './handlers/stats.js';
