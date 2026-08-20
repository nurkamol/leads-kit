import type { LeadRecord, LeadStore } from '../types.js';

/**
 * Content-based spam signals, for what Turnstile cannot catch.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 * Turnstile stops bots. It does not stop a human being paid to fill in forms,
 * or a script driving a real browser — both of which pass a challenge exactly
 * as a customer does. What separates them is the CONTENT: eleven links, a
 * message pasted in four seconds, the same body arriving for the ninth time.
 *
 * ── IT SCORES, IT NEVER BLOCKS ────────────────────────────────────────────
 * Nothing here can refuse a submission, and the API gives you no way to make
 * it. That is deliberate and it is the most important line in this file.
 *
 * Every signal below has a false-positive case involving a real customer. A
 * developer pastes three URLs to their staging site. Someone types fast in a
 * language with long words. A person submits twice because the first reply
 * never came. The cost of admitting spam is a message you delete in a second;
 * the cost of refusing a client is that you never learn it happened. Those are
 * not comparable, so the score is recorded on the record and shown in the
 * list, and a human decides.
 *
 * Use it to sort and to pre-set `status: 'spam'` for review — never to reject.
 */

export interface SpamSignal {
  code: string;
  points: number;
  detail: string;
}

export interface SpamScore {
  /** 0 upward. Roughly: under 3 unremarkable, 3-5 worth a look, 6+ probably spam. */
  score: number;
  signals: SpamSignal[];
}

export interface SpamOptions {
  /** Fields whose text is examined. Defaults to message + name. */
  fields?: readonly string[];
  /** Milliseconds since the form was rendered, if the form reports it. */
  elapsedMs?: number;
  /** Below this, a human did not read the form. Default 3000ms. */
  minElapsedMs?: number;
}

const LINK = /\bhttps?:\/\/|\bwww\.|\[url[=\]]/gi;

/*
 * Deliberately short and boring.
 *
 * A long keyword list is a liability: it dates badly, it is trivially evaded,
 * and every entry is a way to insult a real customer whose business happens to
 * involve the word. These are terms that essentially never appear in a genuine
 * enquiry to a small business, and each is worth ONE point — enough to tip a
 * message that already looks wrong, never enough to condemn one on its own.
 */
const PHRASES = [
  'seo services', 'guest post', 'link building', 'buy backlinks',
  'crypto investment', 'binary option', 'forex signal',
  'increase your traffic', 'first page of google', 'dear sir/madam',
];

const CYRILLIC_OR_CJK = /[Ѐ-ӿ一-鿿]/;

/** Fraction of letters that are upper case, ignoring short strings. */
function shoutiness(text: string): number {
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length < 25) return 0;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length;
}

export function scoreSpam(
  input: Record<string, unknown>,
  options: SpamOptions = {},
): SpamScore {
  const fields = options.fields ?? ['message', 'name'];
  const text = fields.map((f) => String(input[f] ?? '')).join(' \n ');
  const message = String(input.message ?? '');
  const signals: SpamSignal[] = [];

  const links = (text.match(LINK) ?? []).length;
  if (links >= 2) {
    /* Two is a portfolio link and a reference. Five is an advertisement. */
    signals.push({
      code: 'links',
      points: links >= 5 ? 3 : 1,
      detail: `${links} link(s) in the message`,
    });
  }

  const hits = PHRASES.filter((p) => text.toLowerCase().includes(p));
  if (hits.length) {
    signals.push({ code: 'phrases', points: Math.min(hits.length, 3), detail: hits.join(', ') });
  }

  const shout = shoutiness(text);
  if (shout > 0.6) {
    signals.push({ code: 'shouting', points: 2, detail: `${Math.round(shout * 100)}% upper case` });
  }

  if (message && message.length < 15) {
    signals.push({ code: 'thin', points: 1, detail: `${message.length} characters` });
  }

  /*
   * A script that fills and submits instantly. Only counted when the form
   * actually reports the elapsed time — inferring it from anything else
   * (a header, a guess) would penalise anyone whose browser or extension
   * behaves unusually.
   */
  const floor = options.minElapsedMs ?? 3000;
  if (typeof options.elapsedMs === 'number' && options.elapsedMs >= 0 && options.elapsedMs < floor) {
    signals.push({
      code: 'too-fast',
      points: 3,
      detail: `submitted ${options.elapsedMs}ms after the form rendered`,
    });
  }

  /* A message that is one long word, or has no spaces at all. */
  if (message.length > 40 && !/\s/.test(message)) {
    signals.push({ code: 'unbroken', points: 2, detail: 'no whitespace in a long message' });
  }

  /* Mixed scripts in a short message is a classic template artefact. Worth one
     point only: plenty of real people write in more than one script, and this
     would be actively wrong as anything stronger. */
  if (CYRILLIC_OR_CJK.test(message) && /[a-z]{12,}/i.test(message) && message.length < 200) {
    signals.push({ code: 'mixed-script', points: 1, detail: 'mixed scripts in a short message' });
  }

  return { score: signals.reduce((n, s) => n + s.points, 0), signals };
}

/**
 * A stable fingerprint of the message body, for duplicate detection.
 *
 * Normalised so that whitespace and case differences do not defeat it, but
 * NOT so aggressively that two people asking the same short question collide —
 * which is why the length floor exists below.
 */
export async function messageFingerprint(message: string): Promise<string> {
  const normalised = message.trim().toLowerCase().replace(/\s+/g, ' ');
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DuplicateCheck {
  isDuplicate: boolean;
  firstSeen?: string;
}

/**
 * Has this exact message arrived before, recently?
 *
 * Catches two different things with one mechanism: a spam run pasting the same
 * body repeatedly, and a real person double-clicking submit — which is far
 * more common and produces two identical records a minute apart.
 *
 * Short messages are EXEMPT. "Hi, can you help with a website?" is a sentence
 * two different customers will both write, and treating the second as a
 * duplicate of the first would silently discard a real enquiry. Below the
 * floor, this always answers no.
 */
export async function findDuplicate(
  store: LeadStore,
  message: string,
  options: { windowSeconds?: number; prefix?: string; minLength?: number } = {},
): Promise<DuplicateCheck> {
  const minLength = options.minLength ?? 40;
  if (message.trim().length < minLength) return { isDuplicate: false };

  const prefix = options.prefix ?? 'dup:';
  const key = `${prefix}${await messageFingerprint(message)}`;

  try {
    const seen = (await store.get(key)) as unknown as { at?: string } | null;
    if (seen?.at) return { isDuplicate: true, firstSeen: seen.at };

    const at = new Date().toISOString();
    await store.put(key, JSON.stringify({ at }), {
      expirationTtl: options.windowSeconds ?? 24 * 60 * 60,
    });
    return { isDuplicate: false };
  } catch {
    /* Storage unreachable. Answer no — the same judgement as the rate limit
       and the Turnstile outage rule: a storage blip must never look like
       abuse, because the visible cost of getting that wrong is a real enquiry
       marked as spam. */
    return { isDuplicate: false };
  }
}

/** Attach the verdict to a record. Never used to refuse one. */
export function annotate(lead: LeadRecord, score: SpamScore, duplicate: DuplicateCheck): LeadRecord {
  return {
    ...lead,
    spamScore: score.score,
    spamSignals: score.signals.map((s) => s.code).join(',') || undefined,
    duplicateOf: duplicate.firstSeen,
  };
}
