import { decodeEntities } from '../util/text.ts';
import type { SnackEvent } from './types.ts';

export interface Item {
  item_id: string;
  asin: string;
  title: string;
  price_cents: number;
  image_url: string;
  pack_size: number | null;
  qty: number;
  /** actor_id from the `added` event. */
  requester_id: string;
  message_id: string | undefined;
  voters: Set<string>;
  allergens: string[];
  /** Price when the item was added, for change detection at digest time. */
  added_price_cents: number;
}

export const voteCount = (i: Item): number => i.voters.size;

/**
 * Fold an event log into the week's current items.
 *
 * - An item exists if it has an `added` event and no later `removed` event
 * - Votes are distinct actors with a `voted` event, minus `unvoted`
 * - Only the requester's `removed` counts; anyone else's is ignored
 */
export function fold(events: SnackEvent[]): Item[] {
  const items = new Map<string, Item>();
  const removed = new Set<string>();

  for (const e of events) {
    switch (e.type) {
      case 'added': {
        items.set(e.item_id, {
          item_id: e.item_id,
          asin: e.asin ?? '',
          title: decodeEntities(e.title ?? '(unknown)'),
          price_cents: e.price_cents ?? 0,
          added_price_cents: e.price_cents ?? 0,
          image_url: e.image_url ?? '',
          pack_size: e.pack_size ?? null,
          qty: e.qty ?? 1,
          requester_id: e.actor_id,
          message_id: e.message_id,
          voters: new Set([e.actor_id]),
          allergens: e.allergens ?? [],
        });
        break;
      }
      case 'voted': {
        items.get(e.item_id)?.voters.add(e.actor_id);
        break;
      }
      case 'unvoted': {
        items.get(e.item_id)?.voters.delete(e.actor_id);
        break;
      }
      case 'removed': {
        const it = items.get(e.item_id);
        if (it && it.requester_id === e.actor_id) removed.add(e.item_id);
        break;
      }
      case 'flagged': {
        const it = items.get(e.item_id);
        if (it && e.allergens) it.allergens = [...new Set([...it.allergens, ...e.allergens])];
        break;
      }
      case 'ordered':
      case 'liked':
      case 'disliked':
      case 'digested':
      case 'reminded':
      case 'unavailable':
      case 'substituted':
        // Verdicts, order marks, purchase outcomes and notice bookkeeping all
        // describe what happened to an item, not whether it's on the list.
        break;
    }
  }

  return [...items.values()].filter((i) => !removed.has(i.item_id));
}

export function findByAsin(items: Item[], asin: string): Item | undefined {
  return items.find((i) => i.asin === asin);
}
