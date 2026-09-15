import { decodeEntities } from '../util/text.ts';
import type { D1Like } from './d1-store.ts';
import type { Product } from '../amazon/types.ts';

interface Row {
  asin: string;
  title: string;
  price_cents: number | null;
  pack_size: number | null;
  image_url: string | null;
  category: string | null;
  department: string | null;
}

const toProduct = (r: Row): Product => ({
  asin: r.asin,
  title: decodeEntities(r.title),
  price_cents: r.price_cents ?? 0,
  pack_size: r.pack_size,
  image_url: r.image_url ?? '',
  category: r.category ?? undefined,
  department: r.department ?? undefined,
});

/**
 * The catalog grows as people paste links. Keyword search reads only from here,
 * so anything already seen needs no network call — which is what makes a demo
 * safe without shipping fake fixtures.
 */
export async function upsertProduct(db: D1Like, p: Product): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO products
         (asin, title, price_cents, pack_size, image_url, category, department, first_seen, last_fetched)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asin) DO UPDATE SET
         title = excluded.title,
         price_cents = COALESCE(excluded.price_cents, products.price_cents),
         pack_size = COALESCE(excluded.pack_size, products.pack_size),
         category = COALESCE(excluded.category, products.category),
         department = COALESCE(excluded.department, products.department),
         last_fetched = excluded.last_fetched`,
    )
    .bind(
      p.asin,
      p.title,
      p.price_cents || null,
      p.pack_size,
      p.image_url || null,
      p.category ?? null,
      p.department ?? null,
      now,
      now,
    )
    .run();
}

export async function getProduct(db: D1Like, asin: string): Promise<Product | undefined> {
  const row = await db.prepare('SELECT * FROM products WHERE asin = ?').bind(asin).first<Row>();
  return row ? toProduct(row) : undefined;
}

/**
 * SQLite refuses a LIKE pattern past a fixed length with "LIKE or GLOB pattern
 * too complex", which is a thrown error rather than an empty result. Nobody
 * searches for a 40-character word, so capping is free.
 */
const MAX_WORD = 40;

/** Every word has to appear somewhere in the title, in any order. */
export async function searchCatalog(db: D1Like, query: string, limit = 5): Promise<Product[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.slice(0, MAX_WORD));
  if (!words.length) return [];

  const where = words.map(() => 'LOWER(title) LIKE ?').join(' AND ');
  const { results } = await db
    .prepare(`SELECT * FROM products WHERE ${where} ORDER BY last_fetched DESC LIMIT ?`)
    .bind(...words.map((w) => `%${w}%`), limit)
    .all<Row>();
  return results.map(toProduct);
}

/**
 * Search a phrase rather than a query someone tuned. `searchCatalog` requires
 * every word, which is right for `/snack add oreos` and wrong for a sentence
 * pulled off a message — "i want barebells" carries a word no title has. So
 * try the whole phrase, then its most distinctive words on their own.
 */
export async function searchPhrase(db: D1Like, phrase: string, limit = 5): Promise<Product[]> {
  const hits = await searchCatalog(db, phrase, limit);
  if (hits.length) return hits;

  const words = phrase
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  for (const w of words) {
    const loose = await searchCatalog(db, w, limit);
    if (loose.length) return loose;
  }
  return [];
}

/** Every product known, alphabetical. Capped so a growing catalog can't blow past Discord's embed limit in one query. */
export async function listProducts(db: D1Like, limit = 200): Promise<Product[]> {
  const { results } = await db
    .prepare('SELECT * FROM products ORDER BY title COLLATE NOCASE LIMIT ?')
    .bind(limit)
    .all<Row>();
  return results.map(toProduct);
}

export async function catalogSize(db: D1Like): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM products').bind().first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Prices already known, with no network call. The digest uses this so it can
 * answer inside Discord's three-second deadline; refreshing from Amazon happens
 * in the background afterwards.
 */
export async function catalogPrices(db: D1Like, asins: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!asins.length) return out;

  const unique = [...new Set(asins)].slice(0, 100);
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT asin, price_cents FROM products WHERE asin IN (${placeholders})`)
    .bind(...unique)
    .all<{ asin: string; price_cents: number | null }>();

  for (const r of results) if (r.price_cents) out.set(r.asin, r.price_cents);
  return out;
}

/**
 * Products among `asins` whose price hasn't been checked since `cutoff`,
 * oldest first.
 *
 * The refresh is bounded this way rather than by a kill switch: most snacks
 * don't change price week to week, so checking only stale entries and capping
 * how many per run keeps the outbound traffic small no matter how long the list
 * gets, and needs nobody to remember to flip a flag.
 */
export async function staleAsins(
  db: D1Like,
  asins: string[],
  cutoffIso: string,
  limit: number,
): Promise<string[]> {
  if (!asins.length) return [];

  const unique = [...new Set(asins)].slice(0, 100);
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT asin FROM products
       WHERE asin IN (${placeholders}) AND last_fetched < ?
       ORDER BY last_fetched ASC
       LIMIT ?`,
    )
    .bind(...unique, cutoffIso, limit)
    .all<{ asin: string }>();
  return results.map((r) => r.asin);
}
