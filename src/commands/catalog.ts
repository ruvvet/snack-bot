import { catalogSize, listProducts } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';
import { usd } from '../util/money.ts';
import { COLOR } from '../platform/http/components.ts';
import type { Handler } from '../platform/http/types.ts';

/** Embed descriptions cap at 4096 characters. */
const DESC_CAP = 4000;
const SHOW_LIMIT = 200;

function clamp(lines: string[]): string {
  const out: string[] = [];
  let n = 0;
  for (const l of lines) {
    if (n + l.length + 1 > DESC_CAP) {
      out.push('_…truncated_');
      break;
    }
    out.push(l);
    n += l.length + 1;
  }
  return out.join('\n');
}

export function catalogCommand(db: D1Like): Handler {
  return async () => {
    const [known, products] = await Promise.all([catalogSize(db), listProducts(db, SHOW_LIMIT)]);

    if (!products.length) {
      return {
        kind: 'update',
        embeds: [
          {
            title: 'Snack catalog',
            description: 'Nothing in the catalog yet. Add one with `/snack add <amazon link>`.',
            color: COLOR.card,
          },
        ],
      };
    }

    const lines = products.map(
      (p) => `${p.title}${p.pack_size ? ` · ${p.pack_size} count` : ''} — ${usd(p.price_cents)}`,
    );

    return {
      kind: 'update',
      embeds: [
        {
          title: 'Snack catalog',
          description: clamp(lines),
          color: COLOR.card,
          footer: {
            text:
              known > products.length
                ? `Showing ${products.length} of ${known} known snacks, alphabetically. Narrow it down with /snack add <keyword>.`
                : `${known} snack${known === 1 ? '' : 's'} known.`,
          },
        },
      ],
    };
  };
}
