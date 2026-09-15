import { config } from '../config.ts';
import type { D1Like } from './d1-store.ts';

/**
 * Settings live in D1 rather than `wrangler.toml` so the office can change them
 * without a deploy. The env var stays the fallback for a fresh database.
 */
export async function getBudget(db: D1Like): Promise<number> {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE key = 'budget_cents'`)
    .bind()
    .first<{ value: string }>();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : config.budgetCents;
}

export async function setBudget(db: D1Like, cents: number, actorId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by)
       VALUES ('budget_cents', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(String(cents), new Date().toISOString(), actorId)
    .run();
}
