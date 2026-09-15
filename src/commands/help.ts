import { getBudget } from '../store/settings.ts';
import { catalogSize } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';
import { usd } from '../util/money.ts';
import { COLOR } from '../platform/http/components.ts';
import type { Handler } from '../platform/http/types.ts';

export function helpCommand(db: D1Like): Handler {
  return async () => {
    const [budget, known] = await Promise.all([getBudget(db), catalogSize(db)]);

    return {
      kind: 'update',
      embeds: [
        {
          title: 'Snack Bot',
          description: [
            'Request snacks, vote on them, and every Monday the bot posts what fits the budget for someone to buy.',
            '',
            '**Adding**',
            '`/snack add <amazon link>` — the surest way. The link is looked up and remembered.',
            '`/snack add <keyword>` — searches snacks people have already added.',
            'Right-click any message → Apps → **Add as snack** — turns "we\'re out of oreos" into a suggestion.',
            'Anything Amazon files under a non-food department is refused; the Official Snack Buyer can override it with **Add anyway**.',
            '',
            '**Deciding**',
            '👍 **Vote** on a snack card to back it. Click again to take it back.',
            '**Remove** deletes it, but only if you added it.',
            '`/snack list` — the week so far, ranked, with the budget line drawn in.',
            '',
            '**Ordering**',
            `\`/snack digest\` — what fits ${usd(budget)}, and what rolls over.`,
            '**Mark as ordered** on the digest — for the Official Snack Buyer to click once the order is placed.',
            '`/snack repeat` — copy last week\'s order into this week.',
            '',
            '**When the order does not go to plan**',
            '`/snack unavailable item:oreos` — out of stock. Recorded, and the requester is told.',
            '`/snack substitute item:oreos url:<link>` — bought something else. The substitute is what gets rated.',
            'Neither comes back next week on its own — add it again if it is still wanted.',
            '',
            '**Afterwards**',
            '`/snack rate` — say whether last week\'s snacks were worth it. Private.',
            'Verdicts show up next time someone adds that snack, and nudge its ranking.',
            '',
            '**Other**',
            '`/snack flag item:oreos allergens:peanuts` — 🚩 warns everyone.',
            '`/snack budget` — see the weekly cap. The Official Snack Buyer can change it.',
            '',
            `_Items below the budget line roll into next week with their votes, so popular things that just missed win the next round. ${known} snack${known === 1 ? '' : 's'} known so far._`,
          ].join('\n'),
          color: COLOR.card,
          footer: { text: 'The bot never handles payment — a person always places the order.' },
        },
      ],
    };
  };
}
