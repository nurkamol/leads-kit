import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapLeads } from '../dist/cli/unwrap.js';

const leads = [{ id: '1', email: 'a@b.com' }];

test('a bare array passes through', () => {
  assert.deepEqual(unwrapLeads(leads, 'x'), leads);
});

test('the wrapper shape a hand-written endpoint actually returns', () => {
  // This is nurkamol.com/api/leads.json. 0.1.1 died on it.
  assert.deepEqual(unwrapLeads({ exportedAt: 'now', count: 1, leads }, 'x'), leads);
});

test('other common wrapper keys', () => {
  for (const key of ['data', 'results', 'items', 'records']) {
    assert.deepEqual(unwrapLeads({ [key]: leads }, 'x'), leads, key);
  }
});

test('an empty array is a valid answer, not a missing one', () => {
  assert.deepEqual(unwrapLeads({ leads: [] }, 'x'), []);
  assert.deepEqual(unwrapLeads([], 'x'), []);
});

test('an object with no array throws, naming what it saw', () => {
  // Never return [] here: an empty export reads as "no enquiries yet", which
  // is a much worse thing to believe than an error.
  assert.throws(() => unwrapLeads({ error: 'unauthorized' }, 'https://x/api'), (e) => {
    assert.match(e.message, /https:\/\/x\/api/);
    assert.match(e.message, /error/);
    return true;
  });
});

test('non-objects throw', () => {
  for (const bad of [null, 'a string', 42, undefined]) {
    assert.throws(() => unwrapLeads(bad, 'x'));
  }
});
