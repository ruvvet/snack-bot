import type { Product } from './types.ts';

export interface Warning {
  kind: 'bulk' | 'price_change';
  text: string;
}

const BULK_WORDS = /\b(case|pack of|bulk|wholesale|club pack|food service)\b/i;

/**
 * Catch bulk SKUs before they reach the cart. An $80 24-count case in a demo
 * cart is the fastest way to lose the room, so this errs toward flagging.
 */
export function bulkWarning(p: Pick<Product, 'title' | 'pack_size' | 'price_cents'>): Warning | null {
  if (p.pack_size !== null && p.pack_size > 12) {
    return { kind: 'bulk', text: `looks like a bulk pack (${p.pack_size} count)` };
  }
  if (BULK_WORDS.test(p.title)) {
    return { kind: 'bulk', text: 'title suggests a case or bulk pack' };
  }
  if (p.price_cents > 5000) {
    return { kind: 'bulk', text: `unusually expensive for a snack item` };
  }
  return null;
}

export function priceChangeWarning(oldCents: number, newCents: number): Warning | null {
  if (oldCents === newCents) return null;
  const dir = newCents > oldCents ? '↑' : '↓';
  return {
    kind: 'price_change',
    text: `${dir} $${(oldCents / 100).toFixed(2)} → $${(newCents / 100).toFixed(2)}`,
  };
}
