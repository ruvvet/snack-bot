import { asinFromUrl, isAmazonUrl, isShortened, looksLikeUrl, titleFromUrl } from '../amazon/url.ts';
import { fetchProduct, resolveShortLink } from '../amazon/scrape.ts';
import { bulkWarning } from '../amazon/guards.ts';
import { classify, departmentName } from '../amazon/category.ts';
import { canBuy, buyerOnly } from '../buyer.ts';
import { config } from '../config.ts';
import { getProduct, searchPhrase, upsertProduct, catalogSize } from '../store/catalog.ts';
import { getScores } from '../store/scores.ts';
import { fold, findByAsin, voteCount } from '../store/fold.ts';
import { rememberChannel, type D1Like } from '../store/d1-store.ts';
import type { EventStore } from '../store/types.ts';
import type { Product } from '../amazon/types.ts';
import { weekLabel } from '../util/week.ts';
import { activeWeek, isNextWeek } from '../store/active.ts';
import { ulid } from '../util/id.ts';
import { usd } from '../util/money.ts';
import { itemCard, productPicker, voteRow, row, button, Style } from '../platform/http/components.ts';
import type { Handler, Invocation, Reply } from '../platform/http/types.ts';
import type { Rest } from '../platform/http/rest.ts';

/** Dollars as typed by a person — "4.99", "$4.99", "4" — to cents. */
function parsePriceOption(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 500 ? Math.round(n * 100) : null;
}

/**
 * Put an item on this week's list, or bump it if the ASIN is already there.
 * Shared by both entry points: a pasted link, and a pick from the catalog.
 */
async function addItem(
  store: EventStore,
  rest: Rest,
  db: D1Like,
  i: Invocation,
  product: Product,
  opts: { allowNonFood?: boolean } = {},
): Promise<Reply> {
  if (!opts.allowNonFood && classify(product.category, product.department) === 'not_food') {
    return nonFoodReply(i, product);
  }

  const week = await activeWeek(store);
  const nextRun = isNextWeek(week);
  const existing = findByAsin(fold(await store.read(week)), product.asin);

  if (existing) {
    // Two people wanting the same thing means it's popular, not that two boxes
    // are needed — so a duplicate add is a vote.
    if (existing.voters.has(i.actorId)) {
      return {
        kind: 'ephemeral',
        text: `**${existing.title}** is already on the list and you've already voted for it (${voteCount(existing)} vote${voteCount(existing) === 1 ? '' : 's'}).`,
      };
    }

    await store.append({ week, type: 'voted', item_id: existing.item_id, actor_id: i.actorId });
    const votes = voteCount(existing) + 1;

    // Keep the card's count honest, since the vote didn't come from its button.
    if (existing.message_id) {
      await rest
        .editMessage(i.channelId, existing.message_id, {
          embeds: [
            itemCard({
              title: existing.title,
              priceCents: existing.price_cents,
              packSize: existing.pack_size,
              requesterId: existing.requester_id,
              votes,
              warning: bulkWarning(existing)?.text,
              allergens: existing.allergens,
              score: (await getScores(db, [existing.asin])).get(existing.asin),
            }),
          ],
          components: [voteRow(existing.item_id, votes, week)],
        })
        .catch(() => {});
    }

    return {
      kind: 'ephemeral',
      text:
        `Already on the ${nextRun ? weekLabel(week) : 'list'} — added your vote. ` +
        `**${existing.title}** now has ${votes} vote${votes === 1 ? '' : 's'}.`,
    };
  }

  const itemId = ulid();
  const warning = bulkWarning(product)?.text;
  const score = (await getScores(db, [product.asin])).get(product.asin);
  const messageId = await rest.createMessage(i.channelId, {
    embeds: [
      itemCard({
        title: product.title,
        priceCents: product.price_cents,
        packSize: product.pack_size,
        requesterId: i.actorId,
        votes: 1,
        warning,
        score,
        forWeek: nextRun ? weekLabel(week) : undefined,
      }),
    ],
    components: [voteRow(itemId, 1, week)],
  });

  await store.append({
    week,
    type: 'added',
    item_id: itemId,
    actor_id: i.actorId,
    asin: product.asin,
    title: product.title,
    price_cents: product.price_cents,
    image_url: product.image_url,
    pack_size: product.pack_size,
    qty: 1,
    message_id: messageId,
    allergens: null,
  });

  // The scheduled digest has no interaction to reply to, so it needs a channel
  // recorded ahead of time.
  await rememberChannel(db, i.channelId, i.guildId);

  return {
    kind: 'ephemeral',
    text:
      `Added **${product.title}** — ${usd(product.price_cents)}.` +
      (nextRun
        ? ` This week's order is already placed, so it's on the ${weekLabel(week)} list.`
        : ''),
  };
}

/**
 * Someone pasting a laptop is the failure this catches.
 *
 * The buyer used to bypass the check outright, on the reasoning that a snack
 * run legitimately buys a kettle or paper plates. That made the check useless
 * for the person most likely to be pasting links, and $460 headphones went on
 * the list with no warning at all. So the bypass became a confirmation: the
 * buyer can still add it, but has to say so.
 */
function nonFoodReply(i: Invocation, product: Product): Reply {
  const dept = departmentName(product.category, product.department);
  const head = `**${product.title}** is listed under ${dept}, not food.`;

  if (canBuy(i)) {
    return {
      kind: 'ephemeral',
      text: `${head}\n\nIf it belongs on the snack run anyway — a kettle, paper plates — add it deliberately:`,
      components: [row(button(`force:${product.asin}`, 'Add anyway', Style.DANGER))],
    };
  }

  return {
    kind: 'ephemeral',
    text:
      `${head}\n\n` +
      (config.buyerRoleId
        ? `If it belongs on the snack run anyway, ask <@&${config.buyerRoleId}> to add it.`
        : `If it belongs on the snack run anyway, someone with the buyer role can add it.`),
  };
}

/** The Add anyway button. Only the buyer can act on it, not just see it. */
export function forceAddHandler(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i) => {
    const asin = i.value.split(':')[1];
    if (!asin) return { kind: 'noop' };
    if (!canBuy(i)) return buyerOnly('add something that isn’t food');

    const product = await getProduct(db, asin);
    if (!product) {
      return { kind: 'ephemeral', text: 'That product left the catalog — paste the Amazon link again.' };
    }
    return addItem(store, rest, db, i, product, { allowNonFood: true });
  };
}

/** An Amazon link: resolve it, learn the product, add it. No picker needed. */
async function addFromUrl(
  store: EventStore,
  rest: Rest,
  db: D1Like,
  i: Invocation,
  rawUrl: string,
): Promise<Reply> {
  if (!isAmazonUrl(rawUrl)) {
    return { kind: 'ephemeral', text: "That's not an Amazon link. Paste an amazon.com product URL, or search by keyword." };
  }

  const url = isShortened(rawUrl) ? ((await resolveShortLink(rawUrl)) ?? rawUrl) : rawUrl;
  const asin = asinFromUrl(url);
  if (!asin) {
    return {
      kind: 'ephemeral',
      text: "Couldn't find a product ID in that link. Use the full product URL — the part that looks like `/dp/B07GPFDL1K`.",
    };
  }

  const override = parsePriceOption(i.options['price']);
  let product = await getProduct(db, asin);

  // Fetch when the product is new, or when we never managed to read a price.
  if (!product || !product.price_cents) {
    const res = await fetchProduct(asin, url);
    if (res.ok && res.product) {
      product = res.product;
      await upsertProduct(db, res.product);
    } else if (!product) {
      const msg =
        res.reason === 'not_found'
          ? `Amazon has no product with ID \`${asin}\`. Check the link — it may be delisted or region-locked.`
          : res.reason === 'network'
            ? "Couldn't reach Amazon just now. Try again, or add it with `price:` to skip the lookup."
            : `Couldn't read that listing. Add it with a price — \`/snack add query:<url> price:4.99\`.`;
      // A title from the URL slug is enough to add it by hand.
      const slug = titleFromUrl(url);
      if (override && slug) {
        const manual: Product = { asin, title: slug, price_cents: override, image_url: '', pack_size: null };
        await upsertProduct(db, manual);
        return addItem(store, rest, db, i, manual);
      }
      return { kind: 'ephemeral', text: msg };
    }
  }

  if (!product) {
    return { kind: 'ephemeral', text: `Couldn't resolve that link.` };
  }

  if (override) {
    product = { ...product, price_cents: override };
    await upsertProduct(db, product);
  }

  if (!product.price_cents) {
    return {
      kind: 'ephemeral',
      text: `Found **${product.title}** but couldn't read its price — Amazon renders some listings differently. Re-run with the price: \`/snack add query:<url> price:4.99\`.`,
    };
  }

  return addItem(store, rest, db, i, product);
}

export function addCommand(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i) => {
    const input = i.value.trim();
    if (!input) {
      return {
        kind: 'ephemeral',
        text: 'Paste an Amazon link, or search the catalog by keyword — `/snack add oreos`.',
      };
    }

    if (looksLikeUrl(input)) return addFromUrl(store, rest, db, i, input);

    const results = await searchPhrase(db, input, 5);
    // Always hand back a search link, so "not in the catalog" is one click from
    // being fixed rather than a dead end.
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(input)}`;
    const paste = `Find it on Amazon, copy the product URL, and run \`/snack add\` with the link:\n${searchUrl}`;

    if (!results.length) {
      const n = await catalogSize(db);
      return {
        kind: 'ephemeral',
        text:
          (n
            ? `Nothing in the catalog matches “${input}” yet — ${n} product${n === 1 ? '' : 's'} known so far.\n\n`
            : `The catalog is empty, so there's nothing to search yet.\n\n`) + paste,
      };
    }

    const scores = await getScores(db, results.map((r) => r.asin));
    return {
      kind: 'ephemeral',
      text:
        `Found ${results.length} in the catalog for “${input}” — pick one:\n\n` +
        `_Not the one you wanted?_ ${paste}`,
      components: [productPicker(results, scores)],
    };
  };
}

export function pickHandler(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i) => {
    const asin = i.value.split(':')[1];
    if (!asin) return { kind: 'noop' };

    const product = await getProduct(db, asin);
    if (!product) {
      return { kind: 'ephemeral', text: 'That product left the catalog — paste the Amazon link again.' };
    }
    return addItem(store, rest, db, i, product);
  };
}
