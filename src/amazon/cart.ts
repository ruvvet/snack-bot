const BASE = 'https://www.amazon.com/gp/aws/cart/add.html';

/** Product detail page — the link that actually works. */
export const productUrl = (asin: string): string => `https://www.amazon.com/dp/${asin}`;

/**
 * Amazon caps the add-to-cart URL length. Twenty items is comfortably safe;
 * a hundred is not, so long lists get split across several links.
 *
 * NOTE: as of 2026-09, this endpoint 302s into an Amazon Associates sign-in
 * flow and does not add anything to a normal signed-in user's cart — verified
 * by redirect trace and by clicking it. The digest links each product instead.
 * The builder is kept because it is correct and tested, so re-enabling it is a
 * one-line change if Amazon restores the behaviour or an Associates account is
 * available.
 */
export const MAX_ITEMS_PER_CART = 20;

export interface CartLine {
  asin: string;
  qty: number;
}

export function cartUrl(items: CartLine[]): string {
  const params = items
    .map((it, i) => `ASIN.${i + 1}=${encodeURIComponent(it.asin)}&Quantity.${i + 1}=${it.qty}`)
    .join('&');
  return `${BASE}?${params}`;
}

/** One URL per chunk of at most MAX_ITEMS_PER_CART items. */
export function cartUrls(items: CartLine[]): string[] {
  const urls: string[] = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS_PER_CART) {
    urls.push(cartUrl(items.slice(i, i + MAX_ITEMS_PER_CART)));
  }
  return urls;
}
