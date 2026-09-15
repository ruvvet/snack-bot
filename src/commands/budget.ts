import { getBudget, setBudget } from '../store/settings.ts';
import type { D1Like } from '../store/d1-store.ts';
import { usd } from '../util/money.ts';
import type { Handler } from '../platform/http/types.ts';
import { canBuy, buyerOnly } from '../buyer.ts';

/** `/snack budget` reads it; `/snack budget amount:75` changes it. */
export function budgetCommand(db: D1Like): Handler {
  return async (i) => {
    const raw = (i.options['amount'] ?? '').trim();

    if (!raw) {
      const current = await getBudget(db);
      return {
        kind: 'ephemeral',
        text: `Weekly budget is **${usd(current)}**. Change it with \`/snack budget amount:75\`.`,
      };
    }

    // Reading is open to everyone; changing what the buyer spends is not.
    if (!canBuy(i)) return buyerOnly('change the budget');

    const dollars = Number(raw.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 10000) {
      return { kind: 'ephemeral', text: `“${raw}” isn't a budget. Give dollars, like \`75\` or \`120.50\`.` };
    }

    const cents = Math.round(dollars * 100);
    const previous = await getBudget(db);
    await setBudget(db, cents, i.actorId);

    return {
      kind: 'ephemeral',
      text:
        `Weekly budget is now **${usd(cents)}** (was ${usd(previous)}).\n` +
        `It applies from the next \`/snack list\` or digest — run \`/snack list\` to see where the line falls.`,
    };
  };
}
