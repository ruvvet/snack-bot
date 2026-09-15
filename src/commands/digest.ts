import { config } from '../config.ts';
import { getBudget } from '../store/settings.ts';
import { getScores } from '../store/scores.ts';
import { usd } from '../util/money.ts';
import { COLOR, orderedRow } from '../platform/http/components.ts';
import { describeSlot, MAX_REMINDERS } from '../digest/escalation.ts';
import { fold } from '../store/fold.ts';
import { catalogPrices } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';
import { buildDigest } from '../digest/build.ts';
import { renderDigest, renderOrdered } from '../digest/render.ts';
import { nextIsoWeek, isoWeek, weekLabel } from '../util/week.ts';
import type { EventStore } from '../store/types.ts';
import type { Handler } from '../platform/http/types.ts';
import { canBuy, buyerOnly } from '../buyer.ts';
import type { Rest } from '../platform/http/rest.ts';
import type { Embed } from '../platform/http/rest.ts';

/**
 * The weekly logic. Reachable on demand via `/snack digest` and on a schedule
 * from the Worker's cron trigger, so the whole path is demoable without waiting
 * for Monday.
 */
export async function runDigest(
  store: EventStore,
  db: D1Like,
  week = isoWeek(),
): Promise<{ embed: Embed; week: string; rolledOver: number; ordering: number; orderedBy?: string }> {
  const events = await store.read(week);
  const confirmed = events.find((e) => e.type === 'ordered');
  if (confirmed) {
    return {
      embed: renderOrdered(events, week),
      week,
      rolledOver: 0,
      ordering: 0,
      orderedBy: confirmed.actor_id,
    };
  }

  const items = fold(events);
  const [prices, budget, scores] = await Promise.all([
    catalogPrices(db, items.map((i) => i.asin)),
    getBudget(db),
    getScores(db, items.map((i) => i.asin)),
  ]);
  const digest = buildDigest(items, budget, prices, scores);
  return {
    embed: renderDigest(digest, week),
    week,
    rolledOver: digest.rollover.length,
    ordering: digest.ordering.length,
  };
}

/**
 * Carry the losing items into next week with their votes intact, so popular
 * things that just missed the cut win the next round.
 *
 * This runs on the schedule regardless of whether anyone buys anything —
 * an item rolls over because it lost the vote, not because of a purchase.
 * Marking a week ordered is a separate, human act; see `markOrdered`.
 */
export async function rollOver(store: EventStore, db: D1Like, week = isoWeek()): Promise<number> {
  const items = fold(await store.read(week));
  const [prices, budget, scores] = await Promise.all([
    catalogPrices(db, items.map((i) => i.asin)),
    getBudget(db),
    getScores(db, items.map((i) => i.asin)),
  ]);
  const { ordering, rollover } = buildDigest(items, budget, prices, scores);
  const next = nextIsoWeek();

  for (const line of rollover) {
    const it = line.item;
    await store.append({
      week: next,
      type: 'added',
      item_id: it.item_id,
      actor_id: it.requester_id,
      asin: it.asin,
      title: it.title,
      price_cents: it.price_cents,
      image_url: it.image_url,
      pack_size: it.pack_size,
      qty: it.qty,
      allergens: it.allergens.length ? it.allergens : null,
    });
    // Votes carry over: replay each voter other than the requester, who is
    // already counted by the `added` event.
    for (const voter of it.voters) {
      if (voter === it.requester_id) continue;
      await store.append({ week: next, type: 'voted', item_id: it.item_id, actor_id: voter });
    }
  }

  void ordering;
  return rollover.length;
}

export function digestCommand(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i) => {
    const { embed, week, ordering, orderedBy } = await runDigest(store, db);

    // Posting is a REST round trip and price refresh is several megabytes per
    // item, so both run after the reply rather than inside the 3s window.
    i.waitUntil(
      rest
        .createMessage(i.channelId, {
          embeds: [embed],
          components: ordering ? [orderedRow(week)] : [],
        })
        .catch((err) => console.error('digest post failed', err)),
    );

    return {
      kind: 'ephemeral',
      text: orderedBy
        ? `The ${weekLabel(week)} order was already placed by <@${orderedBy}> — posting the receipt.`
        : `Posting the digest for the ${weekLabel(week)}…`,
    };
  };
}

/**
 * Record that a human actually placed the week's order.
 *
 * The set marked is whatever sits above the budget line at click time, which is
 * the best available truth — votes may have moved since the digest posted.
 */
export function markOrderedHandler(store: EventStore, db: D1Like): Handler {
  return async (i) => {
    if (!canBuy(i)) return buyerOnly('confirm a purchase');

    const week = i.value.split(':')[1] ?? isoWeek();
    const events = await store.read(week);

    const already = events.find((e) => e.type === 'ordered');
    if (already) {
      return {
        kind: 'ephemeral',
        text: `The ${weekLabel(week)} order was already marked by <@${already.actor_id}>.`,
      };
    }

    const items = fold(events);
    if (!items.length) {
      return { kind: 'ephemeral', text: `Nothing on the list for the ${weekLabel(week)}.` };
    }

    const [prices, budget, scores] = await Promise.all([
      catalogPrices(db, items.map((it) => it.asin)),
      getBudget(db),
      getScores(db, items.map((it) => it.asin)),
    ]);
    const { ordering, total_cents } = buildDigest(items, budget, prices, scores);

    for (const line of ordering) {
      await store.append({
        week,
        type: 'ordered',
        item_id: line.item.item_id,
        actor_id: i.actorId,
        asin: line.item.asin,
        title: line.item.title,
        price_cents: line.item.price_cents,
        qty: line.item.qty,
      });
    }

    return {
      kind: 'update',
      embeds: [
        {
          title: `Ordered — ${weekLabel(week)}`,
          description:
            `<@${i.actorId}> placed this order: **${ordering.length} items, ${usd(total_cents)}**.\n\n` +
            ordering
              .map((l) => `• ${l.item.title}${l.item.qty > 1 ? ` ×${l.item.qty}` : ''}`)
              .join('\n')
              .slice(0, 3500),
          color: COLOR.digest,
          footer: { text: `Rate these with /snack rate once they arrive — opens next week.` },
        },
      ],
      components: [],
    };
  };
}

/**
 * Nudge whoever is buying, if the week was never confirmed.
 *
 * Runs a couple of days after the digest. Silent once someone has clicked Mark
 * as ordered, and silent when there is nothing to buy, so it can't become
 * background noise. The reminder carries the button itself — the point is to
 * make confirming easier, not to ask again.
 */
export async function remindIfUnordered(
  store: EventStore,
  db: D1Like,
  rest: Rest,
  channelIds: string[],
  week = isoWeek(),
  attempt = 1,
): Promise<boolean> {
  const events = await store.read(week);
  if (events.some((e) => e.type === 'ordered')) return false;

  const items = fold(events);
  if (!items.length) return false;

  const [prices, budget, scores] = await Promise.all([
    catalogPrices(db, items.map((it) => it.asin)),
    getBudget(db),
    getScores(db, items.map((it) => it.asin)),
  ]);
  const { ordering, total_cents } = buildDigest(items, budget, prices, scores);
  if (!ordering.length) return false;

  // The role, not a person: whoever holds it can act, so nobody is a
  // bottleneck and there is no stale name to maintain.
  const who = config.buyerRoleId ? `<@&${config.buyerRoleId}>` : '';

  // The wording sharpens as the gaps shorten, so a fourth ping doesn't read
  // like the first.
  const nth =
    attempt === 1 ? '' : ` (reminder ${attempt} of ${MAX_REMINDERS})`;
  const embed = {
    title: `Still unbought — ${weekLabel(week)}${nth}`,
    description:
      `${who ? `${who} — ` : ''}**${ordering.length} items, ${usd(total_cents)}** are waiting on someone to order them.\n\n` +
      ordering
        .map((l) => `• [${l.item.title}](https://www.amazon.com/dp/${l.item.asin})`)
        .join('\n')
        .slice(0, 3500),
    color: COLOR.warn,
    footer: {
      text: (() => {
        const next = describeSlot(attempt);
        return next
          ? `Already bought these? Hit Mark as ordered. Next reminder ${next}.`
          : `Already bought these? Hit Mark as ordered. That's the last reminder.`;
      })(),
    },
  };

  for (const channelId of channelIds) {
    try {
      await rest.createMessage(channelId, { embeds: [embed], components: [orderedRow(week)] });
    } catch (err) {
      console.error(`reminder to ${channelId} failed`, err);
    }
  }

  await store.append({ week, type: 'reminded', item_id: week, actor_id: 'system', qty: attempt });

  return true;
}

/**
 * Start the purchase-reminder clock for a week. Idempotent, so re-running the
 * digest doesn't reset the escalation and hand the buyer another full day.
 */
export async function markDigested(store: EventStore, week: string): Promise<void> {
  const events = await store.read(week);
  if (events.some((e) => e.type === 'digested')) return;
  await store.append({ week, type: 'digested', item_id: week, actor_id: 'system' });
}
