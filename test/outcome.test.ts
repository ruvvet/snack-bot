import test from 'node:test';
import assert from 'node:assert/strict';
import { memStore, emptyDb } from './helpers.ts';
import { delivered, unavailable, orderedWeekOf } from '../src/store/delivered.ts';
import { unavailableCommand, substituteCommand } from '../src/commands/outcome.ts';
import { renderOrdered } from '../src/digest/render.ts';
import { rollOver } from '../src/commands/digest.ts';
import { fold } from '../src/store/fold.ts';
import { isoWeek, nextIsoWeek } from '../src/util/week.ts';
import { config } from '../src/config.ts';
import type { Invocation, Reply } from '../src/platform/http/types.ts';
import type { EventStore } from '../src/store/types.ts';

/** A REST stand-in that records the channel messages a handler sends. */
function fakeRest() {
  const sent: unknown[] = [];
  return {
    sent,
    createMessage: async (_c: string, payload: unknown) => {
      sent.push(payload);
      return { id: 'm1' };
    },
  } as never;
}

function invocation(options: Record<string, string>, roles: string[] = []): Invocation {
  return {
    actorId: 'buyer',
    channelId: 'chan',
    guildId: 'guild',
    value: '',
    roles,
    permissions: '0',
    options,
    waitUntil: () => {},
  };
}

async function orderedWeek(store: EventStore) {
  const week = isoWeek();
  await store.append({ week, type: 'added', item_id: 'oreo', actor_id: 'u1', asin: 'AAA', title: 'Oreos', price_cents: 800, qty: 1, pack_size: 1 });
  await store.append({ week, type: 'added', item_id: 'chips', actor_id: 'u2', asin: 'BBB', title: 'Chips', price_cents: 500, qty: 2, pack_size: 1 });
  await store.append({ week, type: 'ordered', item_id: 'oreo', actor_id: 'buyer', asin: 'AAA', title: 'Oreos', price_cents: 800, qty: 1 });
  await store.append({ week, type: 'ordered', item_id: 'chips', actor_id: 'buyer', asin: 'BBB', title: 'Chips', price_cents: 500, qty: 2 });
  return week;
}

const text = (r: Reply) => ('text' in r ? (r.text ?? '') : '');

test('an unavailable item drops out of what was delivered', async () => {
  const store = memStore();
  const week = await orderedWeek(store);

  const reply = await unavailableCommand(store, fakeRest())(invocation({ item: 'oreo' }));
  assert.match(text(reply), /unavailable/i);

  const got = delivered(await store.read(week));
  assert.deepEqual(got.map((d) => d.title), ['Chips']);
  assert.deepEqual(unavailable(await store.read(week)).map((u) => u.title), ['Oreos']);
});

test('an unavailable item is not carried into next week', async () => {
  config.budgetCents = 10000;
  const store = memStore();
  const week = await orderedWeek(store);
  await unavailableCommand(store, fakeRest())(invocation({ item: 'oreo' }));

  // It lost nothing — it won the week and simply wasn't in stock. Rollover is
  // only for items the budget squeezed out.
  const rolled = await rollOver(store, emptyDb(), week);
  assert.equal(rolled, 0);
  assert.equal(fold(await store.read(nextIsoWeek())).length, 0);
});

test('a substitution replaces the original in what gets rated', async () => {
  const store = memStore();
  const week = await orderedWeek(store);

  // Seed the catalog hit so the handler never reaches out to Amazon.
  const db = {
    prepare: () => ({
      bind: () => ({
        run: async () => ({}),
        all: async () => ({ results: [] }),
        first: async () => ({
          asin: 'B0947SQPQ2',
          title: 'Double Stuf Oreos',
          price_cents: 900,
          pack_size: 2,
          image_url: '',
          category: 'grocery',
          department: 'Grocery',
        }),
      }),
    }),
  } as never;

  const reply = await substituteCommand(store, fakeRest(), db)(
    invocation({ item: 'oreo', url: 'https://www.amazon.com/dp/B0947SQPQ2' }),
  );
  assert.match(text(reply), /Double Stuf/);

  const got = delivered(await store.read(week));
  assert.deepEqual(got.map((d) => d.asin), ['B0947SQPQ2', 'BBB']);
  assert.equal(got[0]!.substituted_for, 'Oreos', 'the receipt remembers what was asked for');
  assert.equal(got[0]!.price_cents, 900, 'the substitute’s price is what was spent');
});

test('the receipt shows substitutions and what could not be bought', async () => {
  const store = memStore();
  const week = await orderedWeek(store);
  await store.append({ week, type: 'unavailable', item_id: 'chips', actor_id: 'buyer', asin: 'BBB', title: 'Chips' });
  await store.append({ week, type: 'substituted', item_id: 'oreo', actor_id: 'buyer', asin: 'B0947SQPQ2', title: 'Double Stuf Oreos', price_cents: 900, qty: 1 });

  const embed = renderOrdered(await store.read(week), week);
  assert.match(embed.description!, /Double Stuf Oreos — substituted for Oreos/);
  assert.match(embed.description!, /Couldn't buy/);
  assert.match(embed.description!, /~~Chips~~/);
  assert.match(embed.description!, /\*\*1 items, \$9\.00\*\*/, 'the total is what actually shipped');
});

test('only the snack buyer can record an outcome', async () => {
  config.buyerRoleId = 'role-1';
  try {
    const store = memStore();
    await orderedWeek(store);
    const reply = await unavailableCommand(store, fakeRest())(invocation({ item: 'oreo' }));
    assert.match(text(reply), /role-1/);
    assert.ok(!store.rows.some((r) => r.type === 'unavailable'));
  } finally {
    config.buyerRoleId = '';
  }
});

test('outcomes attach to the week that was ordered, not the calendar week', () => {
  assert.equal(
    orderedWeekOf([
      { week: '2026-W38', events: [] },
      { week: '2026-W37', events: [{ week: '2026-W37', sk: 'ts#x#y', type: 'ordered', item_id: 'a', actor_id: 'u' }] },
    ]),
    '2026-W37',
  );
  assert.equal(orderedWeekOf([{ week: '2026-W38', events: [] }]), undefined);
});

test('a title carrying HTML entities is still matchable and readable', async () => {
  const store = memStore();
  const week = isoWeek();
  // Titles come out of Amazon's HTML, so this is exactly what gets stored.
  await store.append({ week, type: 'added', item_id: 'p', actor_id: 'u1', asin: 'B0DL2LVM8Z', title: 'Dot&#39;s Pretzels Twists, 3-Flavor Snacks Variety Pack', price_cents: 1500, qty: 1, pack_size: 1 });
  await store.append({ week, type: 'ordered', item_id: 'p', actor_id: 'buyer', asin: 'B0DL2LVM8Z', title: 'Dot&#39;s Pretzels Twists, 3-Flavor Snacks Variety Pack', price_cents: 1500, qty: 1 });

  const reply = await unavailableCommand(store, fakeRest())(invocation({ item: 'dots pretzels' }));
  assert.match(text(reply), /unavailable/i, "punctuation shouldn't defeat the match");
  assert.match(text(reply), /Dot's Pretzels/, 'the entity is decoded on the way out');
  assert.equal(store.rows.filter((r) => r.type === 'unavailable').length, 1);
});

test('a failed match names the order it searched and what was in it', async () => {
  const store = memStore();
  await orderedWeek(store);
  const reply = await unavailableCommand(store, fakeRest())(invocation({ item: 'kombucha' }));
  assert.match(text(reply), /next week's list/, 'says why the item may be missing');
  assert.match(text(reply), /• Oreos/);
  assert.match(text(reply), /• Chips/);
});

test('the list says which week it is for once an order is placed', async () => {
  config.budgetCents = 10000;
  const store = memStore();
  await orderedWeek(store);

  // A request arriving after the order belongs to next week.
  const next = nextIsoWeek();
  await store.append({ week: next, type: 'added', item_id: 'gum', actor_id: 'u3', asin: 'DDD', title: 'Gum', price_cents: 300, qty: 1, pack_size: 1 });

  const { listCommand } = await import('../src/commands/list.ts');
  const reply = await listCommand(store, emptyDb())(invocation({}));
  const embed = 'embeds' in reply ? reply.embeds![0]! : null;

  assert.ok(embed, 'the list replies with an embed');
  assert.match(embed.title!, /^Next week’s snacks/);
  assert.match(embed.description!, /order is already placed/);
  assert.match(embed.description!, /for \*\*next week\*\*/);
});
