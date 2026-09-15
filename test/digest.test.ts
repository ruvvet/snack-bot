import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold } from '../src/store/fold.ts';
import { buildDigest } from '../src/digest/build.ts';
import { cartUrl, cartUrls } from '../src/amazon/cart.ts';
import { isoWeek } from '../src/util/week.ts';
import type { SnackEvent } from '../src/store/types.ts';

let n = 0;
const ev = (e: Partial<SnackEvent> & Pick<SnackEvent, 'type' | 'item_id' | 'actor_id'>): SnackEvent => ({
  week: '2026-W37',
  sk: `ts#2026-09-07T00:00:0${n}Z#${String(n++).padStart(26, '0')}`,
  ...e,
});

const added = (id: string, actor: string, asin: string, cents: number, pack = 1) =>
  ev({ type: 'added', item_id: id, actor_id: actor, asin, title: `item ${asin}`, price_cents: cents, pack_size: pack, qty: 1 });

test('an item exists once added and disappears when its requester removes it', () => {
  const items = fold([added('a', 'u1', 'A1', 500), ev({ type: 'removed', item_id: 'a', actor_id: 'u1' })]);
  assert.equal(items.length, 0);
});

test('a removal by anyone but the requester is ignored', () => {
  const items = fold([added('a', 'u1', 'A1', 500), ev({ type: 'removed', item_id: 'a', actor_id: 'u2' })]);
  assert.equal(items.length, 1);
});

test('votes are distinct actors, and the requester counts as one', () => {
  const items = fold([
    added('a', 'u1', 'A1', 500),
    ev({ type: 'voted', item_id: 'a', actor_id: 'u2' }),
    ev({ type: 'voted', item_id: 'a', actor_id: 'u2' }),
    ev({ type: 'unvoted', item_id: 'a', actor_id: 'u1' }),
  ]);
  assert.equal(items[0]!.voters.size, 1);
});

test('the budget fill skips an item that does not fit and keeps going', () => {
  const items = fold([
    added('big', 'u1', 'BIG', 4000),
    ev({ type: 'voted', item_id: 'big', actor_id: 'u2' }),
    ev({ type: 'voted', item_id: 'big', actor_id: 'u3' }),
    added('mid', 'u1', 'MID', 3000),
    ev({ type: 'voted', item_id: 'mid', actor_id: 'u2' }),
    added('small', 'u1', 'SML', 500),
  ]);
  const d = buildDigest(items, 5000);
  assert.deepEqual(d.ordering.map((l) => l.item.asin), ['BIG', 'SML']);
  assert.deepEqual(d.rollover.map((l) => l.item.asin), ['MID']);
  assert.equal(d.total_cents, 4500);
});

test('cart URL is 1-indexed ASIN/Quantity pairs', () => {
  assert.equal(
    cartUrl([{ asin: 'B08N5WRWNW', qty: 2 }, { asin: 'B07GPFDL1K', qty: 1 }]),
    'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=2&ASIN.2=B07GPFDL1K&Quantity.2=1',
  );
});

test('carts chunk at 20 items', () => {
  const lines = Array.from({ length: 45 }, (_, i) => ({ asin: `A${i}`, qty: 1 }));
  assert.equal(cartUrls(lines).length, 3);
});

test('a bulk pack is flagged', () => {
  const items = fold([added('a', 'u1', 'A1', 1800, 24)]);
  const d = buildDigest(items, 100000);
  assert.match(d.ordering[0]!.warnings[0]!.text, /bulk pack/);
});

test('iso week keys are stable and Monday-based', () => {
  assert.equal(isoWeek(new Date('2026-09-07T12:00:00Z')), '2026-W37');
  assert.equal(isoWeek(new Date('2026-09-13T12:00:00Z')), '2026-W37');
  assert.equal(isoWeek(new Date('2026-09-14T12:00:00Z')), '2026-W38');
});
