import { voteCount, type Item } from '../store/fold.ts';
import { bulkWarning, priceChangeWarning, type Warning } from '../amazon/guards.ts';
import { net, type Score } from '../store/scores.ts';

/**
 * How far a past verdict can move an item, in votes.
 *
 * Capped deliberately: the office's current vote should outweigh its history,
 * so a verdict nudges the order rather than overriding it. Negative reaches
 * further than positive because the point is to stop re-buying things nobody
 * eats, which is what the plan asked for.
 */
const MAX_BOOST = 1;
const MAX_PENALTY = -2;

export function scoreAdjustment(score: Score | undefined): number {
  if (!score) return 0;
  return Math.max(MAX_PENALTY, Math.min(MAX_BOOST, net(score)));
}

export interface DigestLine {
  item: Item;
  /** Raw votes cast this week. */
  votes: number;
  /** Votes plus the past-verdict adjustment; what the ranking uses. */
  effective_votes: number;
  adjustment: number;
  score?: Score | undefined;
  line_total_cents: number;
  warnings: Warning[];
}

export interface Digest {
  ordering: DigestLine[];
  rollover: DigestLine[];
  total_cents: number;
  budget_cents: number;
}

const lineTotal = (i: Item) => i.price_cents * i.qty;

/**
 * Sort by votes, fill to the budget cap, and split at the cut line.
 *
 * The fill skips past anything that doesn't fit rather than stopping, so a
 * cheap well-liked item isn't blocked by one expensive item above it.
 * Everything that misses rolls over to next week with its votes intact.
 */
export function buildDigest(
  items: Item[],
  budgetCents: number,
  currentPrices?: Map<string, number>,
  scores?: Map<string, Score>,
): Digest {
  const effective = (i: Item) => voteCount(i) + scoreAdjustment(scores?.get(i.asin));

  const ranked = [...items].sort((a, b) => {
    const d = effective(b) - effective(a);
    // Cheaper first on a tie, so the budget stretches over more of the list.
    return d !== 0 ? d : lineTotal(a) - lineTotal(b);
  });

  const ordering: DigestLine[] = [];
  const rollover: DigestLine[] = [];
  let total = 0;

  for (const item of ranked) {
    const live = currentPrices?.get(item.asin);
    if (live !== undefined) item.price_cents = live;

    const warnings: Warning[] = [];
    const bulk = bulkWarning(item);
    if (bulk) warnings.push(bulk);
    const moved = priceChangeWarning(item.added_price_cents, item.price_cents);
    if (moved) warnings.push(moved);

    const score = scores?.get(item.asin);
    const adjustment = scoreAdjustment(score);
    const line: DigestLine = {
      item,
      votes: voteCount(item),
      effective_votes: voteCount(item) + adjustment,
      adjustment,
      score,
      line_total_cents: lineTotal(item),
      warnings,
    };

    if (total + line.line_total_cents <= budgetCents) {
      ordering.push(line);
      total += line.line_total_cents;
    } else {
      rollover.push(line);
    }
  }

  return { ordering, rollover, total_cents: total, budget_cents: budgetCents };
}
