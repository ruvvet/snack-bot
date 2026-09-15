/**
 * When to chase an unbought order.
 *
 * Backoff inverted: the pressure rises each day rather than easing off. One
 * reminder on Monday, two on Tuesday, three on Wednesday — then it stops.
 *
 * Expressed as named slots rather than shrinking intervals. Interval-based
 * escalation was tried and kept sliding out of the working day, landing wherever
 * the next morning happened to be, so the nominal gaps bore no relation to when
 * reminders actually arrived. Naming the slots makes the schedule the thing you
 * can read.
 *
 * Six notices across three days is the ceiling: past that it isn't
 * forgetfulness, it's a decision, and a bot that keeps asking gets muted.
 */
export interface Slot {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Local hour, 24h. */
  hour: number;
}

export const SLOTS: Slot[] = [
  // Monday: one, mid-afternoon, after the digest has had the day to be seen.
  { weekday: 1, hour: 15 },
  // Tuesday: two, morning and afternoon.
  { weekday: 2, hour: 10 },
  { weekday: 2, hour: 15 },
  // Wednesday: three, spread across the day.
  { weekday: 3, hour: 9 },
  { weekday: 3, hour: 12 },
  { weekday: 3, hour: 16 },
];

export const MAX_REMINDERS = SLOTS.length;

/** Weekday and hour as one comparable number, so slots order naturally. */
const position = (weekday: number, hour: number) => weekday * 100 + hour;

export interface EscalationInput {
  /** How many reminders have already gone out this week. */
  sent: number;
  localWeekday: number;
  localHour: number;
}

export interface EscalationResult {
  due: boolean;
  /** 1-based index of the reminder that would be sent. */
  number: number;
  reason: 'due' | 'too_soon' | 'exhausted';
}

/**
 * Whether the next slot has arrived.
 *
 * Compares against the slot's position rather than an exact hour, so a firing
 * missed while the Worker was unreachable is picked up on the next one instead
 * of being skipped.
 */
export function nextReminder({ sent, localWeekday, localHour }: EscalationInput): EscalationResult {
  const number = sent + 1;
  if (sent >= SLOTS.length) return { due: false, number, reason: 'exhausted' };

  const slot = SLOTS[sent]!;
  const now = position(localWeekday, localHour);

  return now >= position(slot.weekday, slot.hour)
    ? { due: true, number, reason: 'due' }
    : { due: false, number, reason: 'too_soon' };
}

/** "Mon 1pm" — for the reminder footer, so people know when the next one lands. */
export function describeSlot(index: number): string | null {
  const slot = SLOTS[index];
  if (!slot) return null;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const h = slot.hour % 12 || 12;
  return `${days[slot.weekday - 1]} ${h}${slot.hour < 12 ? 'am' : 'pm'}`;
}
