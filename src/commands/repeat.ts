import { fold } from '../store/fold.ts';
import type { EventStore } from '../store/types.ts';
import { prevIsoWeek, weekLabel } from '../util/week.ts';
import { activeWeek } from '../store/active.ts';
import { usd } from '../util/money.ts';
import type { Handler } from '../platform/http/types.ts';

/**
 * Clone last week's ordered list into this week.
 *
 * Only items that actually shipped are copied — an `ordered` event marks those.
 * Anything that rolled over is already here, so it's skipped rather than
 * duplicated.
 */
export function repeatCommand(store: EventStore): Handler {
  return async (i) => {
    const week = await activeWeek(store);
    const last = prevIsoWeek();

    const lastEvents = await store.read(last);
    const orderedIds = new Set(lastEvents.filter((e) => e.type === 'ordered').map((e) => e.item_id));
    if (!orderedIds.size) {
      return {
        kind: 'ephemeral',
        text: `Nothing was ordered in the ${weekLabel(last)}, so there's nothing to repeat. Run \`/snack digest\` to close out a week.`,
      };
    }

    const lastItems = fold(lastEvents).filter((it) => orderedIds.has(it.item_id));
    const present = new Set(fold(await store.read(week)).map((it) => it.asin));

    const copied: string[] = [];
    for (const it of lastItems) {
      if (present.has(it.asin)) continue;
      await store.append({
        week,
        type: 'added',
        item_id: it.item_id,
        actor_id: i.actorId,
        asin: it.asin,
        title: it.title,
        price_cents: it.price_cents,
        image_url: it.image_url,
        pack_size: it.pack_size,
        qty: it.qty,
        allergens: it.allergens.length ? it.allergens : null,
      });
      copied.push(`${it.title} — ${usd(it.price_cents * it.qty)}`);
    }

    if (!copied.length) {
      return { kind: 'ephemeral', text: `Everything from the ${weekLabel(last)} is already on this week's list.` };
    }

    return {
      kind: 'ephemeral',
      text:
        `Copied ${copied.length} item${copied.length === 1 ? '' : 's'} from the ${weekLabel(last)}:\n` +
        copied.map((c) => `• ${c}`).join('\n') +
        `\n\nThey start with your vote only — run \`/snack list\` to see where the budget line falls.`,
    };
  };
}
