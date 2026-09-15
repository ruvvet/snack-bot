import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeUrl, isAmazonUrl, asinFromUrl } from '../src/amazon/url.ts';
import { classify, departmentName } from '../src/amazon/category.ts';
import { searchCatalog, searchPhrase } from '../src/store/catalog.ts';
import { describeError } from '../src/util/errors.ts';

/** A D1 stand-in that records the parameters it was bound. */
function recordingDb(rows: { asin: string; title: string }[]) {
  const binds: unknown[][] = [];
  return {
    binds,
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...a: unknown[]) {
          stmt.args = a;
          binds.push(a);
          return stmt;
        },
        async run() {
          return {};
        },
        async all() {
          if (!/FROM products WHERE LOWER/.test(sql)) return { results: [] };
          const patterns = stmt.args
            .filter((a): a is string => typeof a === 'string')
            .map((p) => p.replace(/%/g, '').toLowerCase());
          return {
            results: rows
              .filter((r) => patterns.every((p) => r.title.toLowerCase().includes(p)))
              .map((r) => ({ ...r, price_cents: 100, pack_size: null, image_url: '' })),
          };
        },
        async first() {
          return { n: rows.length } as never;
        },
      };
      return stmt;
    },
  } as never;
}

test('a link pasted without https:// is still a link', () => {
  // Copying out of a phone address bar drops the scheme. Treating it as a
  // keyword sent the whole URL into a SQL LIKE pattern.
  const bare = 'amazon.com/Sony-WH-1000XM6-Headphones/dp/B0GPT1FJBD/ref=sr_1_1';
  assert.equal(looksLikeUrl(bare), true);
  assert.equal(isAmazonUrl(bare), true);
  assert.equal(asinFromUrl(bare), 'B0GPT1FJBD');
});

test('a bare non-Amazon link is refused as a link, not searched', () => {
  assert.equal(looksLikeUrl('walmart.com/ip/oreos/123'), true);
  assert.equal(isAmazonUrl('walmart.com/ip/oreos/123'), false);
});

test('a real keyword is not mistaken for a bare URL', () => {
  for (const k of ['oreos', 'double stuf oreos', 'dot.s pretzels']) {
    assert.equal(looksLikeUrl(k), false, k);
  }
});

test('search never builds a LIKE pattern SQLite will refuse', async () => {
  // SQLite throws "LIKE or GLOB pattern too complex" rather than returning
  // nothing, so an over-long word has to be truncated before it is bound.
  const db = recordingDb([]);
  const huge = 'x'.repeat(700);
  await searchCatalog(db, huge, 5);
  const bound = (db as unknown as { binds: unknown[][] }).binds.at(-1)!;
  const pattern = bound.find((b): b is string => typeof b === 'string')!;
  assert.ok(pattern.length < 60, `bound pattern was ${pattern.length} chars`);
});

test('a sentence finds the product even when it carries extra words', async () => {
  const db = recordingDb([{ asin: 'B09PYB4MQS', title: 'Barebells Protein Bars Variety Pack - 12 Count' }]);

  // Strict search requires every word, so the stray verb kills it.
  assert.equal((await searchCatalog(db, 'want barebells', 5)).length, 0);
  // The phrase search falls back to the distinctive word.
  const hits = await searchPhrase(db, 'want barebells', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.asin, 'B09PYB4MQS');
});

test('Amazon’s own department slugs are what get blocked', () => {
  // `pc` is what a $500 RAM kit reports — the guessed slug `computers` never
  // matched it, so the RAM went on the snack list.
  assert.equal(classify('pc', 'Electronics'), 'not_food');
  assert.equal(classify('apple-devices'), 'not_food');
  assert.equal(classify('grocery', 'Grocery & Gourmet Food'), 'food');
});

test('a food department outranks a misfiled slug', () => {
  // Gummy bears really do come back as toys-and-games.
  assert.equal(classify('toys-and-games', 'Grocery & Gourmet Food'), 'food');
  // With no food signal at all, the breadcrumb decides.
  assert.equal(classify('toys-and-games', 'Toys & Games'), 'not_food');
});

test('anything with no clear signal is still let through', () => {
  assert.equal(classify(undefined, undefined), 'unknown');
  assert.equal(classify('kitchen', 'Home & Kitchen'), 'unknown');
  assert.equal(classify('hpc', 'Health & Household'), 'unknown');
  assert.equal(departmentName('pc', 'Electronics'), 'Electronics');
  assert.equal(departmentName('apple-devices'), 'Apple Devices');
});

test('an error shown in Discord keeps the interaction token out of it', () => {
  const err = new Error('Discord PATCH /webhooks/123/abc.SECRET.tok/messages/@original → 400 bad');
  const msg = describeError(err);
  assert.match(msg, /\/webhooks\/123\/<token>/);
  assert.ok(!msg.includes('SECRET'));
});

test('a non-food item is never added silently, buyer or not', async () => {
  const { addCommand, forceAddHandler } = await import('../src/commands/add.ts');
  const { memStore } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  const sony = {
    asin: 'B0GPT1FJBD',
    title: 'Sony WH-1000XM6 Noise Cancelling Headphones',
    price_cents: 45999,
    pack_size: null,
    image_url: '',
    category: 'electronics',
    department: 'Electronics',
  };
  const db = {
    prepare: () => ({
      bind: () => ({ run: async () => ({}), all: async () => ({ results: [] }), first: async () => sony }),
    }),
  } as never;
  const rest = { createMessage: async () => 'm1', editMessage: async () => {} } as never;
  const inv = (roles: string[], value = 'https://www.amazon.com/dp/B0GPT1FJBD') => ({
    actorId: 'u1',
    channelId: 'c',
    guildId: 'g',
    value,
    roles,
    permissions: '0',
    options: { query: 'https://www.amazon.com/dp/B0GPT1FJBD' },
    waitUntil: () => {},
  });

  config.buyerRoleId = 'role-1';
  try {
    const store = memStore();

    // Not the buyer: refused outright, and told who can.
    const refused = await addCommand(store, rest, db)(inv([]) as never);
    assert.match('text' in refused ? refused.text! : '', /not food/);
    assert.ok(!('components' in refused && refused.components?.length), 'no button for a non-buyer');

    // The buyer: also not added — offered a deliberate confirmation instead.
    const offered = await addCommand(store, rest, db)(inv(['role-1']) as never);
    assert.match('text' in offered ? offered.text! : '', /add it deliberately/);
    assert.equal(store.rows.length, 0, 'nothing is on the list yet');

    // Only the confirmation actually adds it.
    const forced = await forceAddHandler(store, rest, db)(inv(['role-1'], 'force:B0GPT1FJBD') as never);
    assert.match('text' in forced ? forced.text! : '', /Added/);
    assert.equal(store.rows.filter((r) => r.type === 'added').length, 1);

    // And a non-buyer clicking someone else's button gets nowhere.
    const store2 = memStore();
    const denied = await forceAddHandler(store2, rest, db)(inv([], 'force:B0GPT1FJBD') as never);
    assert.match('text' in denied ? denied.text! : '', /role-1/);
    assert.equal(store2.rows.length, 0);
  } finally {
    config.buyerRoleId = '';
  }
});
