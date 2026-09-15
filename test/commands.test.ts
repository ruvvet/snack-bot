import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatCommand } from '../src/commands/repeat.ts';
import { fold } from '../src/store/fold.ts';
import { isoWeek, prevIsoWeek } from '../src/util/week.ts';
import { memStore } from './helpers.ts';
import type { Invocation } from '../src/platform/http/types.ts';

const inv = (actorId = 'u1', roles: string[] = [], permissions = '0'): Invocation => ({
  actorId,
  channelId: 'c1',
  guildId: 'g1',
  value: '',
  roles,
  permissions,
  options: {},
  waitUntil: (p) => void p.catch(() => {}),
});

async function seedLastWeek(store: ReturnType<typeof memStore>, ordered: boolean) {
  const last = prevIsoWeek();
  await store.append({
    week: last,
    type: 'added',
    item_id: 'oreo',
    actor_id: 'u9',
    asin: 'A1',
    title: 'Oreos',
    price_cents: 500,
    qty: 2,
    pack_size: 3,
  });
  if (ordered) {
    await store.append({ week: last, type: 'ordered', item_id: 'oreo', actor_id: 'system', qty: 2 });
  }
}

test('repeat copies last week’s ordered items into this week', async () => {
  const store = memStore();
  await seedLastWeek(store, true);

  const reply = await repeatCommand(store)(inv());
  assert.equal(reply.kind, 'ephemeral');

  const now = fold(await store.read(isoWeek()));
  assert.equal(now.length, 1);
  assert.equal(now[0]!.title, 'Oreos');
  assert.equal(now[0]!.qty, 2, 'quantity carries over');
  assert.equal(now[0]!.requester_id, 'u1', 'whoever ran repeat owns the copy');
});

test('repeat ignores items that were never ordered', async () => {
  const store = memStore();
  await seedLastWeek(store, false);

  const reply = await repeatCommand(store)(inv());
  assert.match((reply as { text: string }).text, /[Nn]othing was ordered/);
  assert.equal(fold(await store.read(isoWeek())).length, 0);
});

test('repeat does not duplicate something already on this week’s list', async () => {
  const store = memStore();
  await seedLastWeek(store, true);
  await store.append({
    week: isoWeek(),
    type: 'added',
    item_id: 'fresh',
    actor_id: 'u2',
    asin: 'A1',
    title: 'Oreos',
    price_cents: 500,
    qty: 1,
  });

  const reply = await repeatCommand(store)(inv());
  assert.match((reply as { text: string }).text, /already on this week/);
  assert.equal(fold(await store.read(isoWeek())).length, 1);
});

test('rollover no longer claims the order was placed', async () => {
  const { rollOver } = await import('../src/commands/digest.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 1000;

  const store = memStore();
  const week = isoWeek();
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'A', price_cents: 500, qty: 1 });

  await rollOver(store, emptyDb(), week);
  assert.equal(
    (await store.read(week)).filter((e) => e.type === 'ordered').length,
    0,
    'only a person clicking Mark as ordered writes an ordered event',
  );
});

test('marking a week ordered records who did it, once', async () => {
  const { markOrderedHandler } = await import('../src/commands/digest.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 10000;

  const store = memStore();
  const week = isoWeek();
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 2 });

  const first = await markOrderedHandler(store, emptyDb())({ ...inv('u7'), value: `ordered:${week}` });
  assert.equal(first.kind, 'update');

  const ordered = (await store.read(week)).filter((e) => e.type === 'ordered');
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0]!.actor_id, 'u7');
  assert.equal(ordered[0]!.qty, 2);

  const again = await markOrderedHandler(store, emptyDb())({ ...inv('u8'), value: `ordered:${week}` });
  assert.equal(again.kind, 'ephemeral');
  assert.match((again as { text: string }).text, /already marked by <@u7>/);
  assert.equal((await store.read(week)).filter((e) => e.type === 'ordered').length, 1);
});

test('a verdict is recorded against the week that shipped, not the current one', async () => {
  const { rateCommand, verdictHandler } = await import('../src/commands/rate.ts');
  const { emptyDb } = await import('./helpers.ts');
  const store = memStore();
  await seedLastWeek(store, true);

  // Nothing shipped this week, so rating targets last week.
  const opened = await rateCommand(store, emptyDb())(inv());
  assert.equal(opened.kind, 'ephemeral');

  await verdictHandler(store, emptyDb(), 'liked')({ ...inv('u5'), value: 'rup:A1' });

  const last = prevIsoWeek();
  const verdicts = (await store.read(last)).filter((e) => e.type === 'liked');
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0]!.asin, 'A1');
  assert.equal(verdicts[0]!.actor_id, 'u5');
  // The current week's list is untouched by a verdict.
  assert.equal(fold(await store.read(isoWeek())).length, 0);
});

test('rating is closed until something has shipped', async () => {
  const { rateCommand } = await import('../src/commands/rate.ts');
  const { emptyDb } = await import('./helpers.ts');
  const store = memStore();
  await seedLastWeek(store, false);

  const reply = await rateCommand(store, emptyDb())(inv());
  assert.match((reply as { text: string }).text, /[Nn]othing shipped/);
});

test('a bad past verdict pushes an item below a better-liked one', async () => {
  const { buildDigest, scoreAdjustment } = await import('../src/digest/build.ts');

  const store = memStore();
  const week = isoWeek();
  await store.append({ week, type: 'added', item_id: 'hated', actor_id: 'u1', asin: 'H', title: 'Hated', price_cents: 500, qty: 1 });
  await store.append({ week, type: 'voted', item_id: 'hated', actor_id: 'u2' });
  await store.append({ week, type: 'added', item_id: 'fine', actor_id: 'u3', asin: 'F', title: 'Fine', price_cents: 500, qty: 1 });

  const items = fold(await store.read(week));

  // Two votes beats one on votes alone.
  const plain = buildDigest(items, 100000);
  assert.deepEqual(plain.ordering.map((l) => l.item.asin), ['H', 'F']);

  // A pile of dislikes on H flips the order.
  const scores = new Map([['H', { likes: 0, dislikes: 3 }]]);
  const adjusted = buildDigest(items, 100000, undefined, scores);
  assert.deepEqual(adjusted.ordering.map((l) => l.item.asin), ['F', 'H']);
  assert.equal(adjusted.ordering[1]!.adjustment, -2);
  assert.equal(adjusted.ordering[1]!.effective_votes, 0);

  // The adjustment is bounded so this week's vote still dominates history.
  assert.equal(scoreAdjustment({ likes: 99, dislikes: 0 }), 1);
  assert.equal(scoreAdjustment({ likes: 0, dislikes: 99 }), -2);
  assert.equal(scoreAdjustment(undefined), 0);
});

test('the reminder stays silent once a week is confirmed, or has nothing to buy', async () => {
  const { remindIfUnordered } = await import('../src/commands/digest.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 10000;

  const posted: string[] = [];
  const fakeRest = {
    createMessage: async (c: string) => {
      posted.push(c);
      return 'm1';
    },
    editMessage: async () => {},
    editOriginalReply: async () => {},
  } as unknown as Parameters<typeof remindIfUnordered>[2];

  const week = isoWeek();

  // Empty week: nothing to nudge about.
  const empty = memStore();
  assert.equal(await remindIfUnordered(empty, emptyDb(), fakeRest, ['c1'], week), false);

  // Items waiting: nudge, carrying the confirm button.
  const waiting = memStore();
  await waiting.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 1 });
  assert.equal(await remindIfUnordered(waiting, emptyDb(), fakeRest, ['c1'], week), true);
  assert.deepEqual(posted, ['c1']);

  // Already confirmed: silent.
  await waiting.append({ week, type: 'ordered', item_id: 'a', actor_id: 'u7', asin: 'A', qty: 1 });
  posted.length = 0;
  assert.equal(await remindIfUnordered(waiting, emptyDb(), fakeRest, ['c1'], week), false);
  assert.deepEqual(posted, []);
});

test('weekday resolves in the digest timezone', async () => {
  const { weekdayIn } = await import('../src/util/week.ts');
  // 2026-09-07 is a Monday; 14:00 UTC is still Monday morning in New York.
  assert.equal(weekdayIn('America/New_York', new Date('2026-09-07T14:00:00Z')), 1);
  assert.equal(weekdayIn('America/New_York', new Date('2026-09-08T14:00:00Z')), 2);
  assert.equal(weekdayIn('America/New_York', new Date('2026-09-10T14:00:00Z')), 4);
  // Just after UTC midnight is still the previous day locally.
  assert.equal(weekdayIn('America/New_York', new Date('2026-09-08T02:00:00Z')), 1);
});

test('a buyer role gates the purchase confirmation when one is set', async () => {
  const { markOrderedHandler } = await import('../src/commands/digest.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 10000;

  const week = isoWeek();
  const seed = async () => {
    const s = memStore();
    await s.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 1 });
    return s;
  };

  config.buyerRoleId = 'role-buyer';

  // Without the role: refused, and nothing is written.
  const denied = await seed();
  const no = await markOrderedHandler(denied, emptyDb())({ ...inv('u2', ['role-other']), value: `ordered:${week}` });
  assert.equal(no.kind, 'ephemeral');
  assert.match((no as { text: string }).text, /Only <@&role-buyer>/);
  assert.equal((await denied.read(week)).filter((e) => e.type === 'ordered').length, 0);

  // With the role: confirmed.
  const allowed = await seed();
  const yes = await markOrderedHandler(allowed, emptyDb())({ ...inv('u3', ['role-buyer']), value: `ordered:${week}` });
  assert.equal(yes.kind, 'update');
  assert.equal((await allowed.read(week)).filter((e) => e.type === 'ordered').length, 1);

  // Unset: anyone can confirm, which is the default.
  config.buyerRoleId = '';
  const open = await seed();
  const anyone = await markOrderedHandler(open, emptyDb())({ ...inv('u4'), value: `ordered:${week}` });
  assert.equal(anyone.kind, 'update');
});

test('an admin can confirm without holding the buyer role', async () => {
  const { markOrderedHandler } = await import('../src/commands/digest.ts');
  const { isAdmin } = await import('../src/platform/http/types.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 10000;
  config.buyerRoleId = 'role-buyer';

  assert.equal(isAdmin('8'), true);
  assert.equal(isAdmin('2147483647'), true, 'administrator bit inside a full mask');
  assert.equal(isAdmin('2048'), false, 'send messages alone is not admin');
  assert.equal(isAdmin('nonsense'), false);

  const week = isoWeek();
  const store = memStore();
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 1 });

  // No buyer role, but Administrator — allowed, so an owner can't lock themselves out.
  const reply = await markOrderedHandler(store, emptyDb())({
    ...inv('owner', [], '8'),
    value: `ordered:${week}`,
  });
  assert.equal(reply.kind, 'update');
  assert.equal((await store.read(week)).filter((e) => e.type === 'ordered').length, 1);
});

test('the digest reports a confirmed week instead of offering the button again', async () => {
  const { runDigest } = await import('../src/commands/digest.ts');
  const { emptyDb } = await import('./helpers.ts');
  const { config } = await import('../src/config.ts');
  config.budgetCents = 10000;

  const week = isoWeek();
  const store = memStore();
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 2 });

  const before = await runDigest(store, emptyDb(), week);
  assert.equal(before.orderedBy, undefined);
  assert.equal(before.ordering, 1, 'the button is offered while unbought');

  await store.append({ week, type: 'ordered', item_id: 'a', actor_id: 'u7', asin: 'A', title: 'Oreos', price_cents: 500, qty: 2 });

  const after = await runDigest(store, emptyDb(), week);
  assert.equal(after.orderedBy, 'u7');
  assert.equal(after.ordering, 0, 'no button once bought');
  assert.match(after.embed.title!, /^Ordered —/);
  assert.match(after.embed.description!, /<@u7> marked this ordered/);
  // The receipt totals what was confirmed: 2 x $5.00.
  assert.match(after.embed.description!, /1 items, \$10\.00/);
});

test('changing the budget is buyer-only, reading it is not', async () => {
  const { budgetCommand } = await import('../src/commands/budget.ts');
  const { config } = await import('../src/config.ts');
  config.buyerRoleId = 'role-buyer';
  config.budgetCents = 5000;

  const writes: unknown[][] = [];
  const stmt = {
    bind: (...a: unknown[]) => {
      writes.push(a);
      return stmt;
    },
    run: async () => ({}),
    all: async <T>() => ({ results: [] as T[] }),
    first: async <T>() => null as T | null,
  };
  const db = { prepare: () => stmt };

  // Anyone may read.
  const read = await budgetCommand(db)(inv('u2', []));
  assert.match((read as { text: string }).text, /Weekly budget is \*\*\$50\.00\*\*/);

  // Without the role, a change is refused and nothing is written.
  writes.length = 0;
  const denied = await budgetCommand(db)({ ...inv('u2', ['role-other']), options: { amount: '75' } });
  assert.match((denied as { text: string }).text, /Only <@&role-buyer> can change the budget/);
  assert.equal(writes.length, 0);

  // With the role, it goes through.
  const ok = await budgetCommand(db)({ ...inv('u3', ['role-buyer']), options: { amount: '75' } });
  assert.match((ok as { text: string }).text, /now \*\*\$75\.00\*\*/);
  assert.ok(writes.some((w) => w.includes('7500')));

  // An admin without the role can too.
  const admin = await budgetCommand(db)({ ...inv('owner', [], '8'), options: { amount: '90' } });
  assert.match((admin as { text: string }).text, /now \*\*\$90\.00\*\*/);
});

test('a duplicate add votes instead of bumping quantity', async () => {
  const { fold } = await import('../src/store/fold.ts');
  const store = memStore();
  const week = isoWeek();
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 1 });

  // A second person's add arrives as a vote, carrying no quantity.
  await store.append({ week, type: 'voted', item_id: 'a', actor_id: 'u2' });

  const items = fold(await store.read(week));
  assert.equal(items[0]!.qty, 1, 'quantity is untouched by popularity');
  assert.equal(items[0]!.voters.size, 2);

  // Even a stray qty on a vote event must not change the quantity any more.
  await store.append({ week, type: 'voted', item_id: 'a', actor_id: 'u3', qty: 9 });
  assert.equal(fold(await store.read(week))[0]!.qty, 1);
});

test('once a week is ordered, new requests go to the next one', async () => {
  const { activeWeek, isNextWeek } = await import('../src/store/active.ts');
  const { nextIsoWeek } = await import('../src/util/week.ts');

  const store = memStore();
  const week = isoWeek();

  // Nothing ordered yet: this week is still open.
  assert.equal(await activeWeek(store), week);
  assert.equal(isNextWeek(week), false);

  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'Oreos', price_cents: 500, qty: 1 });
  assert.equal(await activeWeek(store), week);

  // Once confirmed, the list is settled and requests move forward.
  await store.append({ week, type: 'ordered', item_id: 'a', actor_id: 'u7', asin: 'A', qty: 1 });
  const active = await activeWeek(store);
  assert.equal(active, nextIsoWeek());
  assert.equal(isNextWeek(active), true);
});

test('a vote button carries its week so a next-week card votes correctly', async () => {
  const { voteHandler } = await import('../src/commands/vote.ts');
  const { nextIsoWeek } = await import('../src/util/week.ts');

  const store = memStore();
  const week = isoWeek();
  const next = nextIsoWeek();

  // This week is settled; the item lives in next week.
  await store.append({ week, type: 'added', item_id: 'old', actor_id: 'u1', asin: 'O', title: 'Old', price_cents: 500, qty: 1 });
  await store.append({ week, type: 'ordered', item_id: 'old', actor_id: 'u7', asin: 'O', qty: 1 });
  await store.append({ week: next, type: 'added', item_id: 'new', actor_id: 'u1', asin: 'N', title: 'New', price_cents: 500, qty: 1 });

  const reply = await voteHandler(store)({ ...inv('u2'), value: `vote:new:${next}` });
  assert.equal(reply.kind, 'update');

  const votes = (await store.read(next)).filter((e) => e.type === 'voted');
  assert.equal(votes.length, 1, 'the vote landed in next week, not this one');
  assert.equal((await store.read(week)).filter((e) => e.type === 'voted').length, 0);
});

test('the price refresh only considers stale entries, oldest first, capped', async () => {
  const { staleAsins } = await import('../src/store/catalog.ts');

  const calls: unknown[][] = [];
  const stmt = {
    bind: (...a: unknown[]) => {
      calls.push(a);
      return stmt;
    },
    run: async () => ({}),
    all: async <T>() => ({ results: [] as T[] }),
    first: async <T>() => null as T | null,
  };
  const db = { prepare: () => stmt };

  const cutoff = '2026-09-03T00:00:00.000Z';
  await staleAsins(db, ['A', 'B', 'A'], cutoff, 10);

  const bound = calls[0]!;
  // Duplicates collapse, then the cutoff and the cap follow the asins.
  assert.deepEqual(bound, ['A', 'B', cutoff, 10]);

  // No asins means no query at all.
  calls.length = 0;
  assert.deepEqual(await staleAsins(db, [], cutoff, 10), []);
  assert.equal(calls.length, 0);
});

/** A D1 stand-in backed by a fixed products table. */
function catalogDb(rows: { asin: string; title: string; price_cents: number }[]) {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  const stmt = {
    bind: () => stmt,
    run: async () => ({}),
    async all<T>() {
      return { results: sorted.map((r) => ({ ...r, pack_size: null, image_url: '' })) as T[] };
    },
    async first<T>() {
      return { n: rows.length } as T;
    },
  };
  return { prepare: () => stmt };
}

test('/snack catalog lists every product, alphabetically, with a count footer', async () => {
  const { catalogCommand } = await import('../src/commands/catalog.ts');
  const db = catalogDb([
    { asin: 'B2', title: 'Pretzels', price_cents: 300 },
    { asin: 'B1', title: 'Oreos', price_cents: 500 },
  ]);

  const reply = await catalogCommand(db as never)(inv());
  assert.equal(reply.kind, 'update');
  const embed = 'embeds' in reply ? reply.embeds[0]! : undefined;
  assert.ok(embed);
  // Oreos sorts before Pretzels even though it was seeded second.
  assert.ok(embed.description!.indexOf('Oreos') < embed.description!.indexOf('Pretzels'));
  assert.match(embed.footer!.text, /2 snacks known/);
});

test('/snack catalog says so when nothing has been added yet', async () => {
  const { catalogCommand } = await import('../src/commands/catalog.ts');
  const reply = await catalogCommand(catalogDb([]) as never)(inv());
  assert.equal(reply.kind, 'update');
  const embed = 'embeds' in reply ? reply.embeds[0]! : undefined;
  assert.match(embed!.description!, /Nothing in the catalog yet/);
});
