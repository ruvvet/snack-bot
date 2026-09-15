import { fetchProduct } from './scrape.ts';
import { getProduct, staleAsins, upsertProduct } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';

/** How long a known price is trusted before it's worth re-checking. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Ceiling on fetches per run, so one long list can't turn into a burst. */
const MAX_PER_RUN = 10;

/**
 * Bring stale catalog prices up to date.
 *
 * Deliberately bounded rather than gated behind a flag: only entries older than
 * a week are candidates, the oldest go first, and no more than a handful are
 * fetched per run. A failure leaves the last known price in place, so the budget
 * maths never loses an item.
 *
 * Returns the prices it changed, for callers that want to report movement.
 */
export async function refreshStalePrices(
  db: D1Like,
  asins: string[],
): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const due = await staleAsins(db, asins, cutoff, MAX_PER_RUN);
  const changed = new Map<string, number>();

  for (const asin of due) {
    const before = await getProduct(db, asin);
    const res = await fetchProduct(asin);
    if (!res.ok || !res.product?.price_cents) continue;

    await upsertProduct(db, res.product);
    if (before?.price_cents !== res.product.price_cents) {
      changed.set(asin, res.product.price_cents);
    }
  }

  return changed;
}
