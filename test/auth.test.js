import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches } from '../dist/src/auth/token.js';
import { verifyAccess } from '../dist/src/auth/access.js';
import { guard } from '../dist/src/auth/guard.js';

test('tokenMatches rejects a longer presented token without reading past the end', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abcd', 'abc'), false);
  assert.equal(tokenMatches('ab', 'abc'), false);
  assert.equal(tokenMatches('', ''), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
});

const post = (headers = {}) =>
  new Request('https://example.com/api/leads/delete', { method: 'POST', headers });

test('a forged Cf-Access-Jwt-Assertion header is not an identity', async () => {
  assert.equal(await verifyAccess(post({ 'cf-access-jwt-assertion': 'forged.token.here' }), 'team.cloudflareaccess.com', 'aud'), null);
});

test('alg:none is refused', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'none', kid: 'k' })}.${b64({ aud: 'aud', exp: 2e9, email: 'a@b.c' })}.`;
  assert.equal(await verifyAccess(post({ 'cf-access-jwt-assertion': token }), 'team.cloudflareaccess.com', 'aud'), null);
});

test('unconfigured Access denies rather than allows', async () => {
  assert.equal(await verifyAccess(post({ 'cf-access-jwt-assertion': 'x.y.z' }), undefined, undefined), null);
});

test('guard falls through to Access when no Authorization header is sent', async () => {
  // A browser following a download link. Must not 401 on the token path.
  const res = await guard(new Request('https://example.com/api/leads.csv'), { store: {}, token: 'secret' });
  assert.equal(res.ok, false);
  assert.equal(res.response.status, 401);
  assert.ok(res.response.headers.get('www-authenticate'));
});

test('guard accepts a correct bearer token', async () => {
  const res = await guard(
    new Request('https://example.com/api/leads.csv', { headers: { authorization: 'Bearer secret' } }),
    { store: {}, token: 'secret' },
  );
  assert.equal(res.ok, true);
  assert.equal(res.via, 'token');
});

test('guard rejects a wrong bearer token', async () => {
  const res = await guard(
    new Request('https://example.com/api/leads.csv', { headers: { authorization: 'Bearer wrong' } }),
    { store: {}, token: 'secret' },
  );
  assert.equal(res.ok, false);
  assert.equal(res.response.status, 401);
});
