import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allNotifiers, brevoNotifier, mailChannelsNotifier, postmarkNotifier,
  resendNotifier, slackNotifier, webhookNotifier,
} from '../dist/src/notify/providers.js';
import { lead } from './fake-store.js';

/** Capture the outgoing request instead of making it. */
const capture = async (fn, reply = () => new Response('{}', { status: 200 })) => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return reply();
  };
  try { await fn(); } finally { globalThis.fetch = real; }
  return calls;
};

const l = lead({ name: 'Ann Jones', email: 'ann@example.com', message: 'hello there' });
const opts = { from: 'hello@site.test', to: 'owner@site.test', fromName: 'Site' };

test('every email provider sets reply-to to the ENQUIRER', async () => {
  // The single most useful line in any of these: it turns "reply" into a reply
  // to the person, not an email to yourself you must copy an address out of.
  const cases = [
    ['resend',       resendNotifier('k', opts),        (b) => b.reply_to],
    ['brevo',        brevoNotifier('k', opts),         (b) => b.replyTo?.email],
    ['postmark',     postmarkNotifier('k', opts),      (b) => b.ReplyTo],
    ['mailchannels', mailChannelsNotifier(opts),       (b) => b.reply_to?.email],
  ];
  for (const [name, notifier, pick] of cases) {
    const [call] = await capture(() => notifier(l));
    assert.equal(pick(call.body), 'ann@example.com', name);
  }
});

test('a lead with no usable address simply omits reply-to', async () => {
  const [call] = await capture(() => resendNotifier('k', opts)(lead({ email: 'not-an-address' })));
  assert.ok(!('reply_to' in call.body), 'a malformed reply-to is worse than none — it bounces');
});

test('a non-2xx throws, and carries the provider body', async () => {
  // A provider answering 401 and being treated as success means notifications
  // stop silently, and nobody learns until a client asks why they were ignored.
  const bad = () => new Response('{"message":"sender not verified"}', { status: 422 });
  await assert.rejects(
    () => capture(() => resendNotifier('k', opts)(l), bad),
    (e) => {
      assert.match(e.message, /resend: 422/);
      assert.match(e.message, /sender not verified/, 'the reason must survive — it is the line that fixes it');
      return true;
    },
  );
});

test('a network failure throws rather than resolving', async () => {
  await assert.rejects(() => capture(() => brevoNotifier('k', opts)(l), () => { throw new Error('ECONNRESET'); }));
});

test('each provider posts to its own documented endpoint', async () => {
  const expected = [
    [resendNotifier('k', opts), 'https://api.resend.com/emails'],
    [brevoNotifier('k', opts), 'https://api.brevo.com/v3/smtp/email'],
    [postmarkNotifier('k', opts), 'https://api.postmarkapp.com/email'],
    [mailChannelsNotifier(opts), 'https://api.mailchannels.net/tx/v1/send'],
  ];
  for (const [notifier, url] of expected) {
    const [call] = await capture(() => notifier(l));
    assert.equal(call.url, url);
  }
});

test('multiple recipients are accepted in each provider’s own shape', async () => {
  const many = { ...opts, to: ['a@site.test', 'b@site.test'] };
  const [r] = await capture(() => resendNotifier('k', many)(l));
  assert.deepEqual(r.body.to, ['a@site.test', 'b@site.test']);
  const [b] = await capture(() => brevoNotifier('k', many)(l));
  assert.deepEqual(b.body.to, [{ email: 'a@site.test' }, { email: 'b@site.test' }]);
  const [p] = await capture(() => postmarkNotifier('k', many)(l));
  assert.equal(p.body.To, 'a@site.test,b@site.test');
});

test('Slack does not let a visitor inject formatting into your workspace', async () => {
  const nasty = lead({ name: '<!channel> *urgent*', message: '<https://evil.test|click me>' });
  const [call] = await capture(() => slackNotifier('https://hooks.slack.test/x')(nasty));
  const block = call.body.blocks[0].text;
  assert.equal(block.type, 'plain_text', 'mrkdwn would render an injected link or @channel');
  assert.equal(block.emoji, false);
});

test('a webhook can be limited to named fields', async () => {
  // A webhook is an export: every field included leaves your infrastructure
  // permanently, so sending the whole record to a third party is a choice.
  const [all] = await capture(() => webhookNotifier('https://hook.test')(l));
  assert.ok('ip' in all.body.lead && 'message' in all.body.lead);

  const [some] = await capture(() => webhookNotifier('https://hook.test', { fields: ['name', 'email'] })(l));
  assert.deepEqual(Object.keys(some.body.lead), ['name', 'email']);
  assert.ok(!('ip' in some.body.lead), 'the IP address must not travel unless asked for');
});

test('allNotifiers runs every one even when the first fails', async () => {
  // Promise.all would reject on the first failure and skip the rest, so a
  // broken Slack webhook would stop the email that actually matters.
  const ran = [];
  const ok = (name) => async () => { ran.push(name); };
  const bad = (name) => async () => { ran.push(name); throw new Error(`${name} down`); };

  await assert.rejects(() => allNotifiers(bad('slack'), ok('email'))(l), /1\/2 notifiers failed/);
  assert.deepEqual(ran.sort(), ['email', 'slack'], 'the email still went');

  ran.length = 0;
  await allNotifiers(ok('a'), ok('b'))(l);
  assert.deepEqual(ran.sort(), ['a', 'b']);

  await assert.rejects(() => allNotifiers(bad('a'), bad('b'))(l), /all notifiers failed/);
});
