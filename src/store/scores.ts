import type { D1Like } from './d1-store.ts';

export interface Score {
  likes: number;
  dislikes: number;
}

export const net = (s: Score): number => s.likes - s.dislikes;

/** Rendered next to a product so people can see how it went last time. */
export function scoreLabel(s: Score | undefined): string {
  if (!s || (!s.likes && !s.dislikes)) return '';
  return ` · 👍${s.likes} 👎${s.dislikes}`;
}

export async function recordVerdict(
  db: D1Like,
  asin: string,
  verdict: 'liked' | 'disliked',
): Promise<void> {
  const col = verdict === 'liked' ? 'likes' : 'dislikes';
  await db
    .prepare(
      `INSERT INTO scores (asin, ${col}, last_rated) VALUES (?, 1, ?)
       ON CONFLICT(asin) DO UPDATE SET
         ${col} = scores.${col} + 1,
         last_rated = excluded.last_rated`,
    )
    .bind(asin, new Date().toISOString())
    .run();
}

export async function getScores(db: D1Like, asins: string[]): Promise<Map<string, Score>> {
  const out = new Map<string, Score>();
  if (!asins.length) return out;

  const unique = [...new Set(asins)].slice(0, 100);
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT asin, likes, dislikes FROM scores WHERE asin IN (${placeholders})`)
    .bind(...unique)
    .all<{ asin: string; likes: number; dislikes: number }>();

  for (const r of results) out.set(r.asin, { likes: r.likes, dislikes: r.dislikes });
  return out;
}
