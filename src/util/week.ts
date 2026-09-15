/** ISO-8601 week key, e.g. "2026-W37". Weeks start Monday. */
export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week determines the ISO year.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function prevIsoWeek(d = new Date()): string {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() - 7);
  return isoWeek(n);
}

export function nextIsoWeek(d = new Date()): string {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 7);
  return isoWeek(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The Monday an ISO week key starts on. ISO week 1 is the week containing
 * Jan 4, so that date's Monday is the anchor everything counts from.
 */
export function mondayOf(week: string): Date | null {
  const m = week.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > 53) return null;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const anchor = new Date(jan4);
  anchor.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  anchor.setUTCDate(anchor.getUTCDate() + (n - 1) * 7);
  return anchor;
}

/**
 * "week of Sep 7 (2026-W37)". The ISO key alone is precise but nobody can
 * place it on a calendar, so both go together wherever a week is named.
 */
export function weekLabel(week: string): string {
  const d = mondayOf(week);
  if (!d) return week;
  return `week of ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} (${week})`;
}

/**
 * Hour of day in a named zone, 0–23.
 *
 * Cron triggers only understand UTC, so a fixed UTC hour drifts an hour twice
 * a year: 9am Eastern is 13:00 UTC in summer (EDT) but 14:00 in winter (EST).
 * The schedule fires every hour and the handler keeps the firing that is
 * actually 9am locally.
 */
export function hourIn(timeZone: string, at = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(at);
  return Number(hour) % 24;
}

/** Day of week in a named zone: 1 = Monday … 7 = Sunday. */
export function weekdayIn(timeZone: string, at = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.indexOf(name) + 1;
}

/** The timestamp inside a sort key of the form `ts#<iso8601>#<ulid>`. */
export function eventTime(sk: string): Date | null {
  const iso = sk.split('#')[1];
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
