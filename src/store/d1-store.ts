import { ulid } from '../util/id.ts';
import type { EventStore, SnackEvent } from './types.ts';

/** Minimal shape of the D1 binding, so this file needs no Workers types. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
}

interface Row {
  week: string;
  sk: string;
  type: string;
  item_id: string;
  actor_id: string;
  asin: string | null;
  title: string | null;
  price_cents: number | null;
  image_url: string | null;
  pack_size: number | null;
  qty: number | null;
  message_id: string | null;
  allergens: string | null;
}

const toEvent = (r: Row): SnackEvent => ({
  week: r.week,
  sk: r.sk,
  type: r.type as SnackEvent['type'],
  item_id: r.item_id,
  actor_id: r.actor_id,
  ...(r.asin !== null && { asin: r.asin }),
  ...(r.title !== null && { title: r.title }),
  ...(r.price_cents !== null && { price_cents: r.price_cents }),
  ...(r.image_url !== null && { image_url: r.image_url }),
  ...(r.pack_size !== null && { pack_size: r.pack_size }),
  ...(r.qty !== null && { qty: r.qty }),
  ...(r.message_id !== null && { message_id: r.message_id }),
  ...(r.allergens !== null && { allergens: JSON.parse(r.allergens) as string[] }),
});

const INSERT = `INSERT INTO events
  (week, sk, type, item_id, actor_id, asin, title, price_cents, image_url, pack_size, qty, message_id, allergens)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function d1Store(db: D1Like): EventStore {
  return {
    async append(e) {
      const full: SnackEvent = { ...e, sk: `ts#${new Date().toISOString()}#${ulid()}` };
      await db
        .prepare(INSERT)
        .bind(
          full.week,
          full.sk,
          full.type,
          full.item_id,
          full.actor_id,
          full.asin ?? null,
          full.title ?? null,
          full.price_cents ?? null,
          full.image_url ?? null,
          full.pack_size ?? null,
          full.qty ?? null,
          full.message_id ?? null,
          full.allergens ? JSON.stringify(full.allergens) : null,
        )
        .run();
      return full;
    },

    async read(week) {
      const { results } = await db
        .prepare('SELECT * FROM events WHERE week = ? ORDER BY sk ASC')
        .bind(week)
        .all<Row>();
      return results.map(toEvent);
    },

    async findByMessageId(messageId) {
      const row = await db
        .prepare(`SELECT * FROM events WHERE message_id = ? AND type = 'added' LIMIT 1`)
        .bind(messageId)
        .first<Row>();
      return row ? toEvent(row) : undefined;
    },
  };
}

/** Digest targets, written on install and read by the scheduled handler. */
export async function rememberChannel(db: D1Like, channelId: string, guildId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO channels (channel_id, guild_id, added_at) VALUES (?, ?, ?)')
    .bind(channelId, guildId, new Date().toISOString())
    .run();
}

export async function digestChannels(db: D1Like): Promise<string[]> {
  const { results } = await db.prepare('SELECT channel_id FROM channels').bind().all<{ channel_id: string }>();
  return results.map((r) => r.channel_id);
}
