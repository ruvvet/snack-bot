import { fold } from '../store/fold.ts';
import { delivered, orderedWeekOf } from '../store/delivered.ts';
import { getProduct, upsertProduct } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';
import type { EventStore, SnackEvent } from '../store/types.ts';
import { isoWeek, prevIsoWeek, weekLabel } from '../util/week.ts';
import { usd } from '../util/money.ts';
import { canBuy, buyerOnly } from '../buyer.ts';
import { asinFromUrl, isAmazonUrl, isShortened, looksLikeUrl } from '../amazon/url.ts';
import { fetchProduct, resolveShortLink } from '../amazon/scrape.ts';
import { classify, departmentName } from '../amazon/category.ts';
import { matchTitles } from '../util/text.ts';
import type { Handler, Invocation, Reply } from '../platform/http/types.ts';
import type { Rest } from '../platform/http/rest.ts';
import type { Item } from '../store/fold.ts';

/**
 * Purchase outcomes attach to the week that was actually ordered, which is
 * usually the current one — the buyer shops the same week — but stays reachable
 * the following Monday once the list has rolled on.
 */
async function findOrderedWeek(store: EventStore): Promise<{ week: string; events: SnackEvent[] } | null> {
  const candidates = [isoWeek(), prevIsoWeek()];
  const loaded = [];
  for (const week of candidates) loaded.push({ week, events: await store.read(week) });
  const week = orderedWeekOf(loaded);
  return week ? (loaded.find((w) => w.week === week) ?? null) : null;
}

/**
 * Match an ordered item by part of its name. The failure case matters as much
 * as the success: the buyer is looking at the channel, where the current list
 * is usually *next* week's, so "no match" has to say which order it searched
 * and what was in it.
 */
function matchOne(items: Item[], needle: string, week: string): { item: Item } | { error: string } {
  const hits = matchTitles(items, needle);
  if (!hits.length) {
    const listing = items.length
      ? `\n\nThe ${weekLabel(week)} order was:\n` + items.map((it) => `• ${it.title}`).join('\n')
      : '';
    return {
      error:
        `Nothing in the ${weekLabel(week)} order matches “${needle}”. ` +
        `This only covers items that were actually ordered — anything added since is on next week's list.` +
        listing,
    };
  }
  if (hits.length > 1) {
    return {
      error:
        `“${needle}” matches ${hits.length} items — be more specific:\n` +
        hits.map((h) => `• ${h.title}`).join('\n'),
    };
  }
  return { item: hits[0]! };
}

function orderedItems(events: SnackEvent[]): Item[] {
  const ids = new Set(events.filter((e) => e.type === 'ordered').map((e) => e.item_id));
  return fold(events).filter((it) => ids.has(it.item_id));
}

/** `/snack unavailable item:oreos` — couldn't be bought. Recorded, not requeued. */
export function unavailableCommand(store: EventStore, rest: Rest): Handler {
  return async (i) => {
    if (!canBuy(i)) return buyerOnly('report an item as unavailable');

    const needle = (i.options['item'] ?? '').trim().toLowerCase();
    if (!needle) {
      return { kind: 'ephemeral', text: 'Usage: `/snack unavailable item:oreos`' };
    }

    const found = await findOrderedWeek(store);
    if (!found) {
      return {
        kind: 'ephemeral',
        text: "No order has been marked placed yet, so there's nothing to report against.",
      };
    }

    const items = orderedItems(found.events);
    const already = new Set(found.events.filter((e) => e.type === 'unavailable').map((e) => e.item_id));
    const match = matchOne(items.filter((it) => !already.has(it.item_id)), needle, found.week);
    if ('error' in match) return { kind: 'ephemeral', text: match.error };

    const { item } = match;
    await store.append({
      week: found.week,
      type: 'unavailable',
      item_id: item.item_id,
      actor_id: i.actorId,
      asin: item.asin,
      title: item.title,
    });

    // The requester should hear it from the channel, not discover it never came.
    await rest
      .createMessage(i.channelId, {
        embeds: [
          {
            title: `Couldn't buy — ${item.title}`,
            description:
              `<@${item.requester_id}>, this wasn't available for the ${weekLabel(found.week)} order.\n\n` +
              `It hasn't been carried over — add it again with \`/snack add\` if it's worth another try.`,
            color: 0x9a5b3f,
          },
        ],
      })
      .catch(() => {});

    return {
      kind: 'ephemeral',
      text: `Recorded **${item.title}** as unavailable. It won't be rated, and it hasn't been rolled forward.`,
    };
  };
}

/** `/snack substitute item:oreos url:<link>` — bought something else instead. */
export function substituteCommand(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i): Promise<Reply> => {
    if (!canBuy(i)) return buyerOnly('record a substitution');

    const needle = (i.options['item'] ?? '').trim().toLowerCase();
    const rawUrl = (i.options['url'] ?? '').trim();
    if (!needle || !rawUrl) {
      return {
        kind: 'ephemeral',
        text: 'Usage: `/snack substitute item:oreos url:https://www.amazon.com/dp/…`',
      };
    }

    const found = await findOrderedWeek(store);
    if (!found) {
      return {
        kind: 'ephemeral',
        text: "No order has been marked placed yet, so there's nothing to substitute into.",
      };
    }

    const items = orderedItems(found.events);
    const match = matchOne(items, needle, found.week);
    if ('error' in match) return { kind: 'ephemeral', text: match.error };

    const replacement = await resolveReplacement(db, i, rawUrl);
    if ('error' in replacement) return { kind: 'ephemeral', text: replacement.error };

    const { item } = match;
    const p = replacement.product;

    await store.append({
      week: found.week,
      type: 'substituted',
      item_id: item.item_id,
      actor_id: i.actorId,
      asin: p.asin,
      title: p.title,
      price_cents: p.price_cents,
      pack_size: p.pack_size,
      qty: item.qty,
    });

    await rest
      .createMessage(i.channelId, {
        embeds: [
          {
            title: `Substituted — ${p.title}`,
            description:
              `<@${item.requester_id}>, **${item.title}** was swapped for ` +
              `[${p.title}](https://www.amazon.com/dp/${p.asin})` +
              (p.price_cents ? ` — ${usd(p.price_cents)}` : '') +
              `.\n\nRate the substitute next week; the original hasn't been carried over.`,
            color: 0x8c6d1f,
          },
        ],
      })
      .catch(() => {});

    return {
      kind: 'ephemeral',
      text: `Recorded: **${item.title}** → **${p.title}**. The substitute is what gets rated.`,
    };
  };
}

async function resolveReplacement(
  db: D1Like,
  i: Invocation,
  rawUrl: string,
): Promise<{ product: NonNullable<Awaited<ReturnType<typeof fetchProduct>>['product']> } | { error: string }> {
  if (!looksLikeUrl(rawUrl) || !isAmazonUrl(rawUrl)) {
    return { error: 'The substitute needs an Amazon product link.' };
  }

  const url = isShortened(rawUrl) ? ((await resolveShortLink(rawUrl)) ?? rawUrl) : rawUrl;
  const asin = asinFromUrl(url);
  if (!asin) return { error: "Couldn't find a product ID in that link." };

  const cached = await getProduct(db, asin);
  if (cached?.price_cents) {
    if (classify(cached.category, cached.department) === 'not_food' && !canBuy(i)) {
      return { error: `That's listed under ${departmentName(cached.category, cached.department)}, not food.` };
    }
    return { product: cached };
  }

  const res = await fetchProduct(asin, url);
  if (!res.ok || !res.product) {
    return {
      error:
        res.reason === 'not_found'
          ? `Amazon has no product with ID \`${asin}\`.`
          : "Couldn't read that listing just now — try again.",
    };
  }

  await upsertProduct(db, res.product);
  return { product: res.product };
}
