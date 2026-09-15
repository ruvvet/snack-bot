import { decodeEntities } from '../util/text.ts';
import type { SnackEvent } from './types.ts';

/**
 * What actually arrived, as opposed to what was ordered: unavailable items drop
 * out, substituted ones are replaced by what the buyer bought instead. Ratings
 * and order receipts both read from here — rating a snack nobody ever tasted
 * would poison its score for every future week.
 */
export interface Delivered {
  item_id: string;
  asin: string;
  title: string;
  qty: number;
  price_cents: number;
  /** Set when this is a substitute; the title of what was originally asked for. */
  substituted_for?: string | undefined;
}

export function delivered(events: SnackEvent[]): Delivered[] {
  const ordered = events.filter((e) => e.type === 'ordered');
  if (!ordered.length) return [];

  const missing = new Set(events.filter((e) => e.type === 'unavailable').map((e) => e.item_id));
  const swaps = new Map(events.filter((e) => e.type === 'substituted').map((e) => [e.item_id, e]));

  const out: Delivered[] = [];
  for (const e of ordered) {
    if (missing.has(e.item_id)) continue;
    const swap = swaps.get(e.item_id);
    if (swap) {
      out.push({
        item_id: e.item_id,
        asin: swap.asin ?? e.asin ?? '',
        title: decodeEntities(swap.title ?? 'substitute'),
        qty: swap.qty ?? e.qty ?? 1,
        price_cents: swap.price_cents ?? 0,
        substituted_for: decodeEntities(e.title ?? e.asin ?? ''),
      });
      continue;
    }
    out.push({
      item_id: e.item_id,
      asin: e.asin ?? '',
      title: decodeEntities(e.title ?? e.asin ?? 'item'),
      qty: e.qty ?? 1,
      price_cents: e.price_cents ?? 0,
    });
  }
  return out;
}

/** Items the buyer couldn't get, in the order they were reported. */
export function unavailable(events: SnackEvent[]): { item_id: string; title: string }[] {
  return events
    .filter((e) => e.type === 'unavailable')
    .map((e) => ({ item_id: e.item_id, title: decodeEntities(e.title ?? e.asin ?? 'item') }));
}

/** Which of these weeks holds the order to attach outcomes to, newest first. */
export function orderedWeekOf(weeks: { week: string; events: SnackEvent[] }[]): string | undefined {
  for (const w of weeks) if (w.events.some((e) => e.type === 'ordered')) return w.week;
  return undefined;
}
