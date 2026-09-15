import { runDigest, rollOver, markDigested, remindIfUnordered } from './digest.ts';
import { digestChannels, type D1Like } from '../store/d1-store.ts';
import type { EventStore } from '../store/types.ts';
import { config } from '../config.ts';
import { isoWeek, nextIsoWeek, weekLabel } from '../util/week.ts';
import { MAX_REMINDERS, describeSlot } from '../digest/escalation.ts';
import { orderedRow } from '../platform/http/components.ts';
import { isAdmin, type Handler, type Reply } from '../platform/http/types.ts';
import type { Rest } from '../platform/http/rest.ts';

/**
 * Fire the scheduled work on demand.
 *
 * The Monday digest, the escalating reminders and the rollover are the three
 * features nobody can see without waiting a week, which makes them exactly the
 * three a demo needs. This runs the same functions the cron handler calls and
 * posts to the same channels, so what the room sees is the real thing rather
 * than a mock-up — only the trigger is faked.
 *
 * Admin-only. It posts publicly and appends to the log, so it isn't something
 * to leave open to the channel.
 */
export function simulateCommand(store: EventStore, rest: Rest, db: D1Like): Handler {
  return async (i): Promise<Reply> => {
    if (!isAdmin(i.permissions)) {
      return {
        kind: 'ephemeral',
        text: '`/snack simulate` fakes the Monday cron, so it is limited to server admins.',
      };
    }

    const action = (i.options['action'] ?? '').trim();
    const targets = new Set(await digestChannels(db));
    if (config.digestChannelId) targets.add(config.digestChannelId);
    if (!targets.size) targets.add(i.channelId);

    switch (action) {
      case 'digest':
        return simulateDigest(store, rest, db, [...targets]);
      case 'reminder':
        return simulateReminder(store, rest, db, [...targets]);
      case 'rollover':
        return simulateRollover(store, db);
      default:
        return {
          kind: 'ephemeral',
          text: 'Pick an action: `digest`, `reminder` or `rollover`.',
        };
    }
  };
}

/**
 * Monday 9am, minus the price refresh — that one is a handful of Amazon
 * fetches and would stall the demo for no visible gain.
 *
 * Rollover is deliberately left out and given its own action, so the two can
 * be narrated separately instead of one hiding inside the other.
 */
async function simulateDigest(
  store: EventStore,
  rest: Rest,
  db: D1Like,
  targets: string[],
): Promise<Reply> {
  const { embed, week, ordering } = await runDigest(store, db);

  let posted = 0;
  for (const channelId of targets) {
    try {
      await rest.createMessage(channelId, {
        embeds: [embed],
        components: ordering ? [orderedRow(week)] : [],
      });
      posted++;
    } catch (err) {
      console.error(`simulated digest post to ${channelId} failed`, err);
    }
  }

  await markDigested(store, week);

  return {
    kind: 'ephemeral',
    text:
      `Posted the ${weekLabel(week)} digest to ${posted} channel${posted === 1 ? '' : 's'}. ` +
      'The week is now marked digested, so `/snack simulate action:reminder` will work.',
  };
}

/** The next reminder in the sequence, without waiting for its slot. */
async function simulateReminder(
  store: EventStore,
  rest: Rest,
  db: D1Like,
  targets: string[],
): Promise<Reply> {
  const week = isoWeek();
  const events = await store.read(week);

  if (!events.some((e) => e.type === 'digested')) {
    return {
      kind: 'ephemeral',
      text: 'Nothing has been digested this week, so there is no order to chase. Run `/snack simulate action:digest` first.',
    };
  }

  const sent = events.filter((e) => e.type === 'reminded').length;
  if (sent >= MAX_REMINDERS) {
    return {
      kind: 'ephemeral',
      text: `All ${MAX_REMINDERS} reminders have gone out for the ${weekLabel(week)}. The real schedule stops here too.`,
    };
  }

  const number = sent + 1;
  const went = await remindIfUnordered(store, db, rest, targets, week, number);

  if (!went) {
    return {
      kind: 'ephemeral',
      text: 'Nothing outstanding — either the week is already marked ordered, or the list is empty.',
    };
  }

  const slot = describeSlot(sent);
  const next = describeSlot(number);
  return {
    kind: 'ephemeral',
    text:
      `Sent reminder ${number} of ${MAX_REMINDERS}${slot ? ` — the one really due ${slot}` : ''}. ` +
      (next ? `Next would be ${next}.` : 'That was the last one.'),
  };
}

/** Carry the losers forward, as the cron does right after the digest. */
async function simulateRollover(store: EventStore, db: D1Like): Promise<Reply> {
  const week = isoWeek();
  const moved = await rollOver(store, db, week);

  if (!moved) {
    return {
      kind: 'ephemeral',
      text: `Nothing rolled over — everything on the ${weekLabel(week)} list fits the budget. Lower it with \`/snack budget\` and try again.`,
    };
  }

  return {
    kind: 'ephemeral',
    text:
      `Rolled ${moved} item${moved === 1 ? '' : 's'} into the ${weekLabel(nextIsoWeek())}, votes intact. ` +
      'Run `/snack list` to see them waiting there.',
  };
}
