import { delivered } from '../store/delivered.ts';
import { getScores, recordVerdict, scoreLabel } from '../store/scores.ts';
import type { D1Like } from '../store/d1-store.ts';
import type { EventStore } from '../store/types.ts';
import { prevIsoWeek, weekLabel } from '../util/week.ts';
import { row, button, Style } from '../platform/http/components.ts';
import type { Handler } from '../platform/http/types.ts';

const SELECT = 3;

/**
 * Rate what actually got eaten.
 *
 * Deliberately a week behind: an order placed in week N is rated during week
 * N+1, once people have had a chance to eat it. Verdicts are recorded against
 * the week that shipped, and aggregate by ASIN so they follow the product into
 * every future week.
 */
export function rateCommand(store: EventStore, db: D1Like): Handler {
  return async () => {
    const last = prevIsoWeek();
    const events = await store.read(last);
    const items = delivered(events);

    if (!items.length) {
      return {
        kind: 'ephemeral',
        text: `Nothing shipped in the ${weekLabel(last)}, so there's nothing to rate yet. Verdicts open the week after an order goes out.`,
      };
    }

    const scores = await getScores(db, items.map((it) => it.asin));

    return {
      kind: 'ephemeral',
      text: `How was last week's order — ${weekLabel(last)}? Pick something to rate — nobody sees your individual verdict.`,
      components: [
        row({
          type: SELECT,
          custom_id: 'rate',
          placeholder: 'Which snack?',
          options: items.slice(0, 25).map((it) => ({
            label: it.title.slice(0, 100),
            value: `rate:${it.asin}`,
            description: `${it.substituted_for ? 'substitute' : 'ordered'} ${it.qty > 1 ? `×${it.qty}` : ''}${scoreLabel(scores.get(it.asin))}`
            .trim()
            .slice(0, 100),
          })),
        }),
      ],
    };
  };
}

/** The select landed; offer the two verdicts for that product. */
export function ratePickHandler(): Handler {
  return async (i) => {
    const asin = i.value.split(':')[1];
    if (!asin) return { kind: 'noop' };
    return {
      kind: 'ephemeral',
      text: 'Worth buying again?',
      components: [
        row(
          button(`rup:${asin}`, '👍 Yes', Style.PRIMARY),
          button(`rdn:${asin}`, '👎 No', Style.DANGER),
        ),
      ],
    };
  };
}

export function verdictHandler(store: EventStore, db: D1Like, verdict: 'liked' | 'disliked'): Handler {
  return async (i) => {
    const asin = i.value.split(':')[1];
    if (!asin) return { kind: 'noop' };

    const last = prevIsoWeek();
    const item = delivered(await store.read(last)).find((it) => it.asin === asin);

    await store.append({
      week: last,
      type: verdict,
      item_id: item?.item_id ?? asin,
      actor_id: i.actorId,
      asin,
    });
    await recordVerdict(db, asin, verdict);

    const name = item?.title ?? asin;
    return {
      kind: 'ephemeral',
      text:
        verdict === 'liked'
          ? `Noted — **${name}** was a hit. It'll show 👍 next time someone adds it.`
          : `Noted — **${name}** wasn't. It'll show 👎 next time someone adds it.`,
    };
  };
}
