import type { Component, Embed } from './rest.ts';
import { usd } from '../../util/money.ts';
import type { Product } from '../../amazon/types.ts';
import { scoreLabel, type Score } from '../../store/scores.ts';

const ROW = 1;
const BUTTON = 2;
const SELECT = 3;

export const Style = { PRIMARY: 1, SECONDARY: 2, DANGER: 4 } as const;

export const COLOR = { card: 0x5865f2, digest: 0x57f287, warn: 0xfee75c } as const;

export function row(...components: Component[]): Component {
  return { type: ROW, components };
}

export function button(customId: string, label: string, style: number = Style.SECONDARY): Component {
  return { type: BUTTON, custom_id: customId, label, style };
}

/**
 * The picker carries only the ASIN — a Worker keeps no memory between requests
 * and a select value is capped near 100 characters, so the product is looked up
 * again when the choice comes back.
 */
export function productPicker(products: Product[], scores?: Map<string, Score>): Component {
  return row({
    type: SELECT,
    custom_id: 'pick',
    placeholder: 'Pick the exact product',
    options: products.map((p) => ({
      label: p.title.slice(0, 100),
      value: `pick:${p.asin}`,
      description: `${usd(p.price_cents)}${p.pack_size ? ` · ${p.pack_size} count` : ''}${scoreLabel(scores?.get(p.asin))}`.slice(
        0,
        100,
      ),
    })),
  });
}

/**
 * The digest's confirmation. Nothing marks a week as ordered except a person
 * clicking this, so the rating loop can never ask about a purchase that never
 * happened.
 */
export function orderedRow(week: string): Component {
  return row(button(`ordered:${week}`, '✅ Mark as ordered', Style.PRIMARY));
}

/**
 * The week is in the custom id because a card posted after a week is settled
 * belongs to the next one, and its votes have to land there too.
 */
export function voteRow(itemId: string, votes: number, week: string): Component {
  return row(
    button(`vote:${itemId}:${week}`, `👍 Vote (${votes})`, Style.PRIMARY),
    button(`remove:${itemId}:${week}`, 'Remove', Style.DANGER),
  );
}

export interface CardInput {
  title: string;
  priceCents: number;
  packSize: number | null;
  requesterId: string;
  votes: number;
  warning?: string | undefined;
  allergens?: string[];
  /** How it went last time it was ordered, if it has been. */
  score?: Score | undefined;
  /** Set only when the item is for a later run than the current week. */
  forWeek?: string | undefined;
}

export function itemCard(c: CardInput): Embed {
  const lines = [
    `${usd(c.priceCents)}${c.packSize ? ` · ${c.packSize} count` : ''}`,
    `added by <@${c.requesterId}>`,
  ];
  // One marker for every allergen, deliberately. A per-allergen emoji can't
  // cover sesame, sulfites or tree nuts, so half the list would fall back to a
  // generic one anyway — and a literal 🥛 reads as a label, not a warning.
  const verdict = scoreLabel(c.score);
  if (verdict) lines.push(`last time:${verdict}`);
  if (c.forWeek) lines.push(`for the ${c.forWeek}`);
  if (c.allergens?.length) lines.push(`🚩 ${c.allergens.join(', ')}`);
  if (c.warning) lines.push(`⚠ ${c.warning} — check this before Monday`);
  return {
    title: `🧺 ${c.title}`.slice(0, 256),
    description: lines.join('\n'),
    color: c.warning ? COLOR.warn : COLOR.card,
  };
}
