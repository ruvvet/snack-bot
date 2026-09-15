import { ulid } from '../src/util/id.ts';
import type { EventStore, SnackEvent } from '../src/store/types.ts';

/** Append-only in-memory store, same contract as D1. */
export function memStore(): EventStore & { rows: SnackEvent[] } {
  const rows: SnackEvent[] = [];
  let n = 0;
  return {
    rows,
    async append(e) {
      const full: SnackEvent = {
        ...e,
        sk: `ts#2026-09-07T00:00:00.${String(n++).padStart(3, '0')}Z#${ulid()}`,
      };
      rows.push(full);
      return full;
    },
    async read(week) {
      return rows.filter((r) => r.week === week).sort((a, b) => a.sk.localeCompare(b.sk));
    },
    async findByMessageId(messageId) {
      return rows.find((r) => r.message_id === messageId && r.type === 'added');
    },
  };
}

/**
 * Minimal D1 stand-in. Enough for code paths that consult the catalog without
 * caring what's in it; returns empty for every query.
 */
export function emptyDb() {
  const stmt = {
    bind: () => stmt,
    run: async () => ({}),
    all: async <T>() => ({ results: [] as T[] }),
    first: async <T>() => null as T | null,
  };
  return { prepare: () => stmt };
}
