import { fold, voteCount } from '../store/fold.ts';
import { bulkWarning } from '../amazon/guards.ts';
import type { EventStore } from '../store/types.ts';
import { activeWeek } from '../store/active.ts';
import { itemCard, voteRow } from '../platform/http/components.ts';
import type { Handler } from '../platform/http/types.ts';

/**
 * Voting is a button rather than a 👍 reaction: reaction events are gateway
 * only and never arrive over HTTP interactions. Buttons also do two things
 * reactions can't — render a live count, and give Remove an affordance.
 */
export function voteHandler(store: EventStore): Handler {
  return async (i) => {
    const [, itemId, tagged] = i.value.split(':');
    if (!itemId) return { kind: 'noop' };

    // Cards posted before the week was tagged fall back to the active week.
    const week = tagged ?? (await activeWeek(store));
    const item = fold(await store.read(week)).find((it) => it.item_id === itemId);
    if (!item) {
      return { kind: 'ephemeral', text: 'That item is no longer on the list.' };
    }

    // Clicking again takes the vote back, so the button is a toggle.
    const had = item.voters.has(i.actorId);
    await store.append({
      week,
      type: had ? 'unvoted' : 'voted',
      item_id: itemId,
      actor_id: i.actorId,
    });

    const votes = voteCount(item) + (had ? -1 : 1);
    return {
      kind: 'update',
      embeds: [
        itemCard({
          title: item.title,
          priceCents: item.price_cents,
          packSize: item.pack_size,
          requesterId: item.requester_id,
          votes,
          warning: bulkWarning(item)?.text,
          allergens: item.allergens,
        }),
      ],
      components: [voteRow(itemId, votes, week)],
    };
  };
}

export function removeHandler(store: EventStore): Handler {
  return async (i) => {
    const [, itemId, tagged] = i.value.split(':');
    if (!itemId) return { kind: 'noop' };

    const week = tagged ?? (await activeWeek(store));
    const item = fold(await store.read(week)).find((it) => it.item_id === itemId);
    if (!item) return { kind: 'ephemeral', text: 'That item is already gone.' };

    if (item.requester_id !== i.actorId) {
      return {
        kind: 'ephemeral',
        text: `Only <@${item.requester_id}> can remove that. Take your vote back with the Vote button instead.`,
      };
    }

    await store.append({ week, type: 'removed', item_id: itemId, actor_id: i.actorId });

    return {
      kind: 'update',
      embeds: [
        {
          title: `~~${item.title}~~`,
          description: `Removed by <@${i.actorId}>.`,
          color: 0x4f545c,
        },
      ],
      components: [],
    };
  };
}
