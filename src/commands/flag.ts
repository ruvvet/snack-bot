import { fold } from '../store/fold.ts';
import { matchTitles } from '../util/text.ts';
import { bulkWarning } from '../amazon/guards.ts';
import type { EventStore } from '../store/types.ts';
import { activeWeek } from '../store/active.ts';
import { weekLabel } from '../util/week.ts';
import { itemCard, voteRow } from '../platform/http/components.ts';
import { voteCount } from '../store/fold.ts';
import type { Handler } from '../platform/http/types.ts';
import type { Rest } from '../platform/http/rest.ts';

/** `/snack flag item:oreos allergens:peanuts, milk` */
export function flagCommand(store: EventStore, rest: Rest): Handler {
  return async (i) => {
    const needle = (i.options['item'] ?? '').trim().toLowerCase();
    const allergens = (i.options['allergens'] ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    if (!needle || !allergens.length) {
      return {
        kind: 'ephemeral',
        text: 'Usage: `/snack flag item:oreos allergens:peanuts, milk`',
      };
    }

    const week = await activeWeek(store);
    const items = fold(await store.read(week));
    const matches = matchTitles(items, needle);

    if (!matches.length) {
      return {
        kind: 'ephemeral',
        text: `Nothing on the ${weekLabel(week)} list matches “${needle}”.`,
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'ephemeral',
        text:
          `“${needle}” matches ${matches.length} items — be more specific:\n` +
          matches.map((m) => `• ${m.title}`).join('\n'),
      };
    }

    const item = matches[0]!;
    await store.append({
      week,
      type: 'flagged',
      item_id: item.item_id,
      actor_id: i.actorId,
      allergens,
    });

    // Refresh the item's card so the warning is visible where people vote,
    // not only in Monday's digest.
    const merged = [...new Set([...item.allergens, ...allergens])];
    if (item.message_id) {
      await rest
        .editMessage(i.channelId, item.message_id, {
          embeds: [
            itemCard({
              title: item.title,
              priceCents: item.price_cents,
              packSize: item.pack_size,
              requesterId: item.requester_id,
              votes: voteCount(item),
              warning: bulkWarning(item)?.text,
              allergens: merged,
            }),
          ],
          components: [voteRow(item.item_id, voteCount(item), week)],
        })
        .catch(() => {});
    }

    return {
      kind: 'ephemeral',
      text: `Flagged **${item.title}** with ${merged.join(', ')}. It'll show on the card and in the digest.`,
    };
  };
}
