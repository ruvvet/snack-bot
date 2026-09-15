import type { EventStore } from './types.ts';
import { isoWeek, nextIsoWeek } from '../util/week.ts';

/**
 * The week new requests belong to.
 *
 * Normally this week. Once someone has marked this week ordered, the list is
 * settled — anything added afterwards is for the next run, not a shipment
 * that already happened.
 */
export async function activeWeek(store: EventStore): Promise<string> {
  const week = isoWeek();
  const events = await store.read(week);
  return events.some((e) => e.type === 'ordered') ? nextIsoWeek() : week;
}

export function isNextWeek(week: string): boolean {
  return week !== isoWeek();
}
