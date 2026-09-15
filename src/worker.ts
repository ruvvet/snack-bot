import { initConfig, config, type Env } from './config.ts';
import { d1Store, digestChannels } from './store/d1-store.ts';
import { rest } from './platform/http/rest.ts';
import { createRouter } from './platform/http/router.ts';
import { addCommand, pickHandler, forceAddHandler } from './commands/add.ts';
import { listCommand } from './commands/list.ts';
import { catalogCommand } from './commands/catalog.ts';
import {
  digestCommand,
  runDigest,
  rollOver,
  markOrderedHandler,
  remindIfUnordered,
  markDigested,
} from './commands/digest.ts';
import { orderedRow } from './platform/http/components.ts';
import { hourIn, weekdayIn, isoWeek } from './util/week.ts';
import { nextReminder } from './digest/escalation.ts';
import { fold } from './store/fold.ts';
import { refreshStalePrices } from './amazon/prices.ts';

const TZ = 'America/New_York';
const DIGEST_HOUR = 9;
const MONDAY = 1;
import { voteHandler, removeHandler } from './commands/vote.ts';
import { unavailableCommand, substituteCommand } from './commands/outcome.ts';
import { repeatCommand } from './commands/repeat.ts';
import { flagCommand } from './commands/flag.ts';
import { suggestCommand } from './commands/suggest.ts';
import { rateCommand, ratePickHandler, verdictHandler } from './commands/rate.ts';
import { budgetCommand } from './commands/budget.ts';
import { helpCommand } from './commands/help.ts';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('snack-bot', { status: 200 });

    initConfig(env);
    const store = d1Store(env.DB);
    const api = rest(config.token);

    const router = createRouter(config.publicKey, {
      waitUntil: (p) => ctx.waitUntil(p),
      editOriginalReply: (appId, token, payload) => api.editOriginalReply(appId, token, payload),
    })
      // `add` and `pick` fetch an Amazon page, which is several megabytes and
      // routinely slower than Discord's three-second deadline.
      .command('add', addCommand(store, api, env.DB), true)
      .command('list', listCommand(store, env.DB))
      .command('catalog', catalogCommand(env.DB))
      .command('digest', digestCommand(store, api, env.DB))
      .command('unavailable', unavailableCommand(store, api))
      .command('substitute', substituteCommand(store, api, env.DB), true)
      .command('repeat', repeatCommand(store))
      .command('flag', flagCommand(store, api))
      .command('rate', rateCommand(store, env.DB))
      .command('budget', budgetCommand(env.DB))
      .command('help', helpCommand(env.DB))
      .command('Add as snack', suggestCommand(env.DB))
      .component('pick', pickHandler(store, api, env.DB), true)
      .component('force', forceAddHandler(store, api, env.DB), true)
      .component('vote', voteHandler(store))
      .component('remove', removeHandler(store))
      .component('rate', ratePickHandler())
      .component('rup', verdictHandler(store, env.DB, 'liked'))
      .component('rdn', verdictHandler(store, env.DB, 'disliked'))
      .component('ordered', markOrderedHandler(store, env.DB));

    return router.handle(request);
  },

  /**
   * Monday 09:00 Eastern. Posts the digest, then rolls the losers into next
   * week so their votes survive the cut.
   *
   * Invoked hourly, because cron only understands UTC and any fixed hour drifts
   * an hour across daylight saving. Each firing reads the local clock and takes
   * whichever job it owes: the digest at 9am Monday, a purchase reminder at one
   * of the escalation slots, or nothing at all.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Runs hourly and decides for itself: one trigger, and the whole schedule
    // lives in code where it can be reasoned about and tested.
    const hour = hourIn(TZ);
    const day = weekdayIn(TZ);
    initConfig(env);
    const store = d1Store(env.DB);
    const api = rest(config.token);

    const targets = new Set(await digestChannels(env.DB));
    if (config.digestChannelId) targets.add(config.digestChannelId);

    if (day === MONDAY && hour === DIGEST_HOUR) {
      // Refresh before building, not after: the scheduled run has no response
      // deadline, and Monday's numbers and price-change flags should be current.
      // Bounded inside refreshStalePrices, so this stays a handful of fetches.
      const pending = fold(await store.read(isoWeek()));
      if (pending.length) {
        await refreshStalePrices(env.DB, pending.map((it) => it.asin)).catch((err) =>
          console.error('price refresh failed, using known prices', err),
        );
      }

      const { embed, week, ordering } = await runDigest(store, env.DB);

      for (const channelId of targets) {
        try {
          await api.createMessage(channelId, {
            embeds: [embed],
            components: ordering ? [orderedRow(week)] : [],
          });
        } catch (err) {
          console.error(`digest post to ${channelId} failed`, err);
        }
      }

      await markDigested(store, week);
      await rollOver(store, env.DB);
      return;
    }

    // Escalating purchase reminders: the gap shrinks each time nobody buys.
    const week = isoWeek();
    const events = await store.read(week);
    const digested = events.find((e) => e.type === 'digested');
    if (!digested) return;

    const decision = nextReminder({
      sent: events.filter((e) => e.type === 'reminded').length,
      localWeekday: day,
      localHour: hour,
    });

    if (!decision.due) return;

    const sent = await remindIfUnordered(
      store,
      env.DB,
      api,
      [...targets],
      week,
      decision.number,
    );
    console.log(sent ? `reminder ${decision.number} sent` : 'nothing outstanding');
  },
} satisfies ExportedHandler<Env>;
