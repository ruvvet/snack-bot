/**
 * Anchored so the registrable domain really is amazon.<tld>. A looser pattern
 * that allows dots in the suffix accepts lookalikes like
 * `amazon.com.evil.example`, which would then be treated as a trusted link.
 */
const HOSTS = /^([a-z0-9-]+\.)*amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;
const SHORTENERS = /^([a-z0-9-]+\.)*(a\.co|amzn\.to|amzn\.eu)$/i;

/** ASINs are 10 characters of uppercase alphanumerics. */
const ASIN = /^[A-Z0-9]{10}$/;

const PATTERNS = [
  /\/dp\/([A-Z0-9]{10})/i,
  /\/gp\/product\/([A-Z0-9]{10})/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
  /\/product\/([A-Z0-9]{10})/i,
  /[?&]asin=([A-Z0-9]{10})/i,
];

/**
 * A pasted link with the scheme left off — copying out of the address bar on a
 * phone gives `amazon.com/Sony-...`, with no `https://`. Requiring a scheme
 * sent those down the keyword-search path with a 700-character "keyword".
 * Any bare domain counts, so a Walmart link gets the honest "not an Amazon
 * link" answer rather than a nonsense catalog search.
 */
const BARE_URL = /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i;

export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\//i.test(t) || BARE_URL.test(t);
}

/** A form `new URL()` accepts, so everything downstream is one code path. */
export function normalizeUrl(s: string): string {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isAmazonUrl(s: string): boolean {
  try {
    const h = new URL(normalizeUrl(s)).hostname;
    return HOSTS.test(h) || SHORTENERS.test(h);
  } catch {
    return false;
  }
}

export function isShortened(s: string): boolean {
  try {
    return SHORTENERS.test(new URL(normalizeUrl(s)).hostname);
  } catch {
    return false;
  }
}

export function asinFromUrl(s: string): string | null {
  let path: string;
  try {
    const u = new URL(normalizeUrl(s));
    path = u.pathname + u.search;
  } catch {
    return null;
  }
  for (const re of PATTERNS) {
    const m = path.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }
  // Some links carry the ASIN as a bare path segment.
  for (const seg of path.split(/[/?&=]/)) {
    const up = seg.toUpperCase();
    if (ASIN.test(up) && /\d/.test(up)) return up;
  }
  return null;
}

/**
 * The slug ahead of /dp/ is a readable product name, which is enough to name an
 * item when the page fetch fails or is skipped.
 */
export function titleFromUrl(s: string): string | null {
  try {
    const parts = new URL(normalizeUrl(s)).pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'dp' || p === 'product');
    const slug = idx > 0 ? parts[idx - 1] : undefined;
    if (!slug || slug.length < 4) return null;
    const words = decodeURIComponent(slug).replace(/-/g, ' ').trim();
    return words.length > 3 ? words.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Pack size out of a product title: "24 Count", "Pack of 12", "12-ct". */
export function packSizeFromTitle(title: string): number | null {
  const m =
    title.match(/\bpack\s+of\s+(\d{1,3})\b/i) ??
    title.match(/\b(\d{1,3})\s*[- ]?\s*(?:count|ct|pack|pk)\b/i);
  const n = m?.[1] ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : null;
}
