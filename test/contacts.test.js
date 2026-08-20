import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeByEmail, e164, splitName, toKlaviyoCsv, toMailchimpCsv,
} from '../dist/src/format/contacts.js';

test('splitName does not duplicate a single-token name', () => {
  assert.deepEqual(splitName('Nurkamol'), { first: 'Nurkamol', last: '' });
  assert.deepEqual(splitName('Nurkamol Vakhidov'), { first: 'Nurkamol', last: 'Vakhidov' });
  assert.equal(splitName('Maria del Carmen Rodriguez').first, 'Maria del Carmen');
  assert.deepEqual(splitName('   '), { first: '', last: '' });
});

test('e164 refuses to invent a country code', () => {
  assert.equal(e164('+998 90 123 45 67'), '+998901234567');
  assert.equal(e164('+1 (415) 555-0100'), '+14155550100');
  assert.equal(e164('90 123 45 67'), '', 'no + means no country, and guessing is inventing data');
  assert.equal(e164('call me on the mobile'), '');
  assert.equal(e164('+0123456789'), '', 'E.164 numbers do not start with zero');
  assert.equal(e164(undefined), '');
});

const lead = (over) => ({
  id: 'x', receivedAt: '2026-01-01T00:00:00Z', name: 'A B', email: 'a@b.com',
  phone: '', service: '', budget: '', timeline: '', message: '', page: '/',
  country: '', verification: 'passed', env: 'live', ...over,
});

test('dedupe keeps the newest regardless of input order', () => {
  const old = lead({ id: 'o', receivedAt: '2026-01-01T00:00:00Z', name: 'Old' });
  const recent = lead({ id: 'n', receivedAt: '2026-02-01T00:00:00Z', name: 'New' });
  for (const order of [[old, recent], [recent, old]]) {
    const kept = dedupeByEmail(order);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].name, 'New', 'input order must not decide which survives');
  }
});

test('dedupe is case-insensitive on the address', () => {
  assert.equal(dedupeByEmail([lead({ email: 'Same@Example.com' }), lead({ email: 'same@example.com' })]).length, 1);
});

test('dedupe drops records with no address', () => {
  assert.equal(dedupeByEmail([lead({ email: '' }), lead({ email: '  ' })]).length, 0);
});

test('exports carry no subscribe column for either platform to read', () => {
  // The name carries the quotes, because it is the one field both formats
  // emit — Mailchimp deliberately omits the enquiry message.
  const rows = [lead({ name: 'Ann "AJ" Jones', message: 'hi "there"\nsecond line' })];
  for (const csv of [toKlaviyoCsv(rows), toMailchimpCsv(rows)]) {
    const header = csv.split('\r\n')[0].toLowerCase();
    for (const banned of ['subscribe', 'email marketing consent', '$consent', 'opt_in', 'opt-in']) {
      assert.ok(!header.includes(banned), `header must not contain "${banned}": ${header}`);
    }
    assert.ok(csv.includes('no-marketing-consent'), 'every row must be tagged');
    assert.ok(csv.includes('""AJ""'), 'RFC 4180 quote doubling');
    assert.ok(csv.startsWith('﻿'), 'BOM, or Excel mangles accented names');
  }
});

test('Mailchimp omits the message, Klaviyo keeps it', () => {
  const rows = [lead({ message: 'the whole enquiry text' })];
  assert.ok(toKlaviyoCsv(rows).includes('the whole enquiry text'));
  assert.ok(
    !toMailchimpCsv(rows).includes('the whole enquiry text'),
    'Mailchimp text merge fields cap around 255 chars and truncate quietly past it',
  );
});
