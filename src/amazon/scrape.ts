import { packSizeFromTitle, titleFromUrl } from './url.ts';
import { decodeEntities } from '../util/text.ts';
import type { Product } from './types.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/**
 * Amazon renders prices several different ways depending on listing type,
 * variant and stock, so this tries the common shapes in order of reliability
 * and gives up rather than guessing.
 */
const PRICE_PATTERNS = [
  /class="a-offscreen">\s*\$([\d,]+\.\d{2})/,
  /"priceAmount"\s*:\s*([\d.]+)/,
  /id="priceblock_(?:our|deal|sale)price"[^>]*>\s*\$([\d,]+\.\d{2})/,
  /class="a-price-whole">\s*([\d,]+)\s*<[^>]*>\s*<span class="a-price-fraction">\s*(\d{2})/,
];

/**
 * The department. `data-category` on the nav sits on every product page tested,
 * including ones with no breadcrumb at all, so it leads; the breadcrumb is only
 * for a readable name.
 */
const CATEGORY_PATTERN = /nav-subnav[^>]*data-category="([a-z0-9-]{2,40})"/i;

function parseCategory(html: string): string | undefined {
  return html.match(CATEGORY_PATTERN)?.[1]?.toLowerCase();
}

function parseDepartment(html: string): string | undefined {
  const i = html.indexOf('wayfinding-breadcrumbs_feature_div');
  if (i < 0) return undefined;
  const first = html
    .slice(i, i + 4000)
    .match(/<a[^>]*class="a-link-normal a-color-tertiary"[^>]*>\s*([^<]{2,60}?)\s*<\/a>/);
  const name = first?.[1]?.trim();
  return name ? decodeEntities(name) : undefined;
}

const TITLE_PATTERNS = [
  /<span[^>]*id="productTitle"[^>]*>([^<]{3,300})</,
  /<meta[^>]+name="title"[^>]+content="([^"]{3,300})"/,
  /<title>([^<]{3,300})<\/title>/,
];

function parsePrice(html: string): number | null {
  for (const re of PRICE_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const raw = m[2] ? `${m[1]}.${m[2]}` : m[1];
    const n = Number(String(raw).replace(/,/g, ''));
    // A snack priced over $500 is a parse error, not a bulk pack.
    if (Number.isFinite(n) && n > 0 && n < 500) return Math.round(n * 100);
  }
  return null;
}

function parseTitle(html: string): string | null {
  for (const re of TITLE_PATTERNS) {
    const m = html.match(re);
    const t = decodeEntities(m?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*Amazon\.com.*$/i, '')
      .trim();
    if (t && t.length > 3) return t.slice(0, 200);
  }
  return null;
}

export interface FetchResult {
  ok: boolean;
  /** Set when the listing resolved, even if the price didn't parse. */
  product?: Product;
  /** Why it failed, for an honest message back to the user. */
  reason?: 'not_found' | 'blocked' | 'network';
}

/**
 * Fetch a listing and pull out what we can.
 *
 * A 404 means the ASIN is wrong, which is worth surfacing — it catches typos
 * and delisted products at add time rather than in Monday's cart.
 */
export async function fetchProduct(asin: string, sourceUrl?: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(`https://www.amazon.com/dp/${asin}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' },
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (res.status === 404) return { ok: false, reason: 'not_found' };
  if (!res.ok) return { ok: false, reason: 'blocked' };

  const html = await res.text();
  if (/Enter the characters you see below|api-services-support@amazon\.com/i.test(html)) {
    return { ok: false, reason: 'blocked' };
  }

  const title = parseTitle(html) ?? (sourceUrl ? titleFromUrl(sourceUrl) : null);
  if (!title) return { ok: false, reason: 'blocked' };

  const priceCents = parsePrice(html);
  return {
    ok: true,
    product: {
      asin,
      title,
      price_cents: priceCents ?? 0,
      image_url: '',
      pack_size: packSizeFromTitle(title),
      category: parseCategory(html),
      department: parseDepartment(html),
    },
  };
}

/** Short links hide the ASIN behind a redirect. */
export async function resolveShortLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return res.url || null;
  } catch {
    return null;
  }
}
