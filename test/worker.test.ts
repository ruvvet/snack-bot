import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRequest } from '../src/platform/http/verify.ts';
import { renderDigest } from '../src/digest/render.ts';
import { buildDigest } from '../src/digest/build.ts';
import { fold } from '../src/store/fold.ts';
import { rollOver } from '../src/commands/digest.ts';
import { config } from '../src/config.ts';
import { isoWeek, nextIsoWeek } from '../src/util/week.ts';
import { memStore, emptyDb } from './helpers.ts';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

test('a correctly signed interaction verifies', async () => {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = hex((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  const body = '{"type":1}';
  const ts = '1757450000';
  const sig = hex(
    await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(ts + body)),
  );

  assert.equal(await verifyRequest(pub, sig, ts, body), true);
});

test('a tampered body fails verification', async () => {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = hex((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  const ts = '1757450000';
  const sig = hex(
    await crypto.subtle.sign(
      { name: 'Ed25519' },
      kp.privateKey,
      new TextEncoder().encode(ts + '{"type":1}'),
    ),
  );

  assert.equal(await verifyRequest(pub, sig, ts, '{"type":2}'), false);
});

test('missing signature headers fail closed', async () => {
  assert.equal(await verifyRequest('00'.repeat(32), null, null, '{}'), false);
});

test('the digest links each product rather than the dead cart URL', async () => {
  const store = memStore();
  await store.append({
    week: '2026-W37',
    type: 'added',
    item_id: 'a',
    actor_id: 'u1',
    asin: 'B0947SQPQ2',
    title: 'Oreos',
    price_cents: 799,
    qty: 1,
    pack_size: 3,
  });

  const d = buildDigest(fold(await store.read('2026-W37')), 5000);
  const embed = renderDigest(d, '2026-W37');

  // Masked links only render inside embeds, which is why the digest is one.
  // Each item links to its product page; the multi-item cart URL no longer
  // adds anything for a normal signed-in user.
  assert.match(embed.description!, /\[Oreos\]\(https:\/\/www\.amazon\.com\/dp\/B0947SQPQ2\)/);
  assert.doesNotMatch(embed.description!, /gp\/aws\/cart\/add/);
  assert.equal(typeof embed.color, 'number');
});

test('rollover carries losing items into next week with votes intact', async () => {
  config.budgetCents = 1000;
  const store = memStore();
  const week = isoWeek();

  // Winner: cheap, two votes. Loser: blows the budget, one vote.
  await store.append({ week, type: 'added', item_id: 'win', actor_id: 'u1', asin: 'W', title: 'Win', price_cents: 500, qty: 1, pack_size: 1 });
  await store.append({ week, type: 'voted', item_id: 'win', actor_id: 'u2' });
  await store.append({ week, type: 'added', item_id: 'lose', actor_id: 'u3', asin: 'L', title: 'Lose', price_cents: 900, qty: 1, pack_size: 1 });
  await store.append({ week, type: 'voted', item_id: 'lose', actor_id: 'u4' });

  const rolled = await rollOver(store, emptyDb(), week);
  assert.equal(rolled, 1);

  const next = fold(await store.read(nextIsoWeek()));
  assert.equal(next.length, 1);
  assert.equal(next[0]!.item_id, 'lose');
  assert.equal(next[0]!.voters.size, 2, 'both voters carry over');
  assert.equal(next[0]!.requester_id, 'u3', 'the original requester is preserved');

  // The winner stays put and is not marked ordered — only a person clicking
  // Mark as ordered does that.
  assert.ok(!next.some((i) => i.item_id === 'win'));
  assert.ok(!store.rows.some((r) => r.type === 'ordered'));
});

test('an unvote drops the count without deleting the item', async () => {
  const store = memStore();
  const week = '2026-W37';
  await store.append({ week, type: 'added', item_id: 'a', actor_id: 'u1', asin: 'A', title: 'A', price_cents: 100, qty: 1 });
  await store.append({ week, type: 'voted', item_id: 'a', actor_id: 'u2' });
  await store.append({ week, type: 'unvoted', item_id: 'a', actor_id: 'u2' });

  const items = fold(await store.read(week));
  assert.equal(items.length, 1);
  assert.equal(items[0]!.voters.size, 1);
});

test('a score renders only once there are verdicts', async () => {
  const { scoreLabel } = await import('../src/store/scores.ts');
  assert.equal(scoreLabel(undefined), '');
  assert.equal(scoreLabel({ likes: 0, dislikes: 0 }), '');
  assert.equal(scoreLabel({ likes: 3, dislikes: 1 }), ' · 👍3 👎1');
});
