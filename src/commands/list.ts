import { fold } from '../store/fold.ts';
import { getBudget } from '../store/settings.ts';
import { getScores } from '../store/scores.ts';
import type { D1Like } from '../store/d1-store.ts';
import { buildDigest } from '../digest/build.ts';
import { renderList } from '../digest/render.ts';
import type { EventStore, SnackEvent } from '../store/types.ts';
import { activeWeek, isNextWeek } from '../store/active.ts';
import { isoWeek, weekLabel } from '../util/week.ts';
import type { Handler } from '../platform/http/types.ts';

export function listCommand(store: EventStore, db: D1Like): Handler {
  return async () => {
    const week = await activeWeek(store);
    const events = await store.read(week);
    const items = fold(events);
    const [budget, scores] = await Promise.all([
      getBudget(db),
      getScores(db, items.map((i) => i.asin)),
    ]);
    const digest = buildDigest(items, budget, undefined, scores);
    const embed = renderList(digest, week);

    // The banner has to come from the week that was ordered. Once the list
    // rolls forward, `week` is next week's and holds no ordered event at all.
    const banner = await orderedBanner(store, week, events);
    if (banner) embed.description = `${banner}\n\n${embed.description ?? ''}`;

    return { kind: 'update', embeds: [embed] };
  };
}

async function orderedBanner(
  store: EventStore,
  week: string,
  events: SnackEvent[],
): Promise<string | null> {
  if (!isNextWeek(week)) {
    const confirmed = events.find((e) => e.type === 'ordered');
    return confirmed ? `✅ **Already ordered** by <@${confirmed.actor_id}>.` : null;
  }

  const current = isoWeek();
  const confirmed = (await store.read(current)).find((e) => e.type === 'ordered');
  if (!confirmed) return null;
  return (
    `✅ The ${weekLabel(current)} order is already placed by <@${confirmed.actor_id}>, ` +
    `so everything below is for **next week**.`
  );
}
