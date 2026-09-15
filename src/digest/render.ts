import { usd } from '../util/money.ts';
import { productUrl } from '../amazon/cart.ts';
import { delivered, unavailable } from '../store/delivered.ts';
import { isNextWeek } from '../store/active.ts';
import { weekLabel } from '../util/week.ts';
import { scoreLabel } from '../store/scores.ts';
import { COLOR } from '../platform/http/components.ts';
import type { Embed } from '../platform/http/rest.ts';
import type { Digest, DigestLine } from './build.ts';
import type { SnackEvent } from '../store/types.ts';

/** Embed descriptions cap at 4096 characters. */
const DESC_CAP = 4000;

const warn = (l: DigestLine) =>
  l.warnings.length ? `  ⚠ ${l.warnings.map((w) => w.text).join('; ')}` : '';

/**
 * The title is the link. Amazon's multi-item add-to-cart URL no longer works
 * for a normal signed-in user, so the digest gives the approver one link per
 * item to open and add — which cannot break.
 */
/** When history moved an item, say so — a silent reorder just confuses people. */
const rank = (l: DigestLine) => {
  if (!l.adjustment) return `**${l.votes}**`;
  const sign = l.adjustment > 0 ? '+' : '';
  return `**${l.effective_votes}** _(${l.votes}${sign}${l.adjustment})_`;
};

const row = (l: DigestLine) =>
  `${rank(l)} · [${l.item.title}](${productUrl(l.item.asin)})` +
  `${l.item.qty > 1 ? ` ×${l.item.qty}` : ''} — ` +
  `${usd(l.line_total_cents)} · <@${l.item.requester_id}>` +
  scoreLabel(l.score) +
  (l.item.allergens.length ? `  🚩 ${l.item.allergens.join(', ')}` : '') +
  warn(l);

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

/**
 * The digest, as an embed.
 *
 * It has to be an embed: Discord only renders masked markdown links inside
 * embeds, and in plain message content `[Open cart](url)` shows up as literal
 * text — which would turn the cart link, the whole point of the project, into
 * visible markdown syntax.
 */
export function renderDigest(d: Digest, week: string): Embed {
  const lines = [
    `**Buying** — ${d.ordering.length} items, ${usd(d.total_cents)} of the ${usd(d.budget_cents)} budget`,
    ...(d.ordering.length ? d.ordering.map(row) : ['_nothing on the list yet_']),
  ];

  if (d.rollover.length) {
    lines.push(
      '',
      `**Not this week** — ${d.rollover.length} items over budget, votes carry to next week`,
      ...d.rollover.map(row),
    );
  }

  if (d.ordering.length) {
    lines.push('', `**Total: ${usd(d.total_cents)}** across ${d.ordering.length} items.`);
  }

  return {
    title: `Snack digest — ${weekLabel(week)}`,
    description: clamp(lines),
    color: COLOR.digest,
    footer: {
      text: d.ordering.length
        ? 'Open each item, add it to your cart, place the order — then hit Mark as ordered.'
        : 'Nothing to order this week.',
    },
  };
}

/**
 * `/snack list`: the week split at the budget line.
 *
 * Both halves are labelled rather than separated by a divider — a bare "budget
 * line" between two lists doesn't say which side is being bought.
 */
export function renderList(d: Digest, week: string): Embed {
  // Once a week is marked ordered, requests move to the next one — so say which
  // week this list is for rather than always claiming it's the current one.
  const ahead = isNextWeek(week);
  const title = `${ahead ? 'Next' : 'This'} week’s snacks — ${weekLabel(week)}`;

  if (!d.ordering.length && !d.rollover.length) {
    return {
      title,
      description: 'Nothing on the list yet. Add one with `/snack add oreos`.',
      color: COLOR.card,
    };
  }

  const lines: string[] = [];

  lines.push(
    `**Making the cut** — ${d.ordering.length} item${d.ordering.length === 1 ? '' : 's'}, ` +
      `${usd(d.total_cents)} of the ${usd(d.budget_cents)} budget`,
  );
  if (d.ordering.length) {
    let running = 0;
    for (const l of d.ordering) {
      running += l.line_total_cents;
      lines.push(`${row(l)}  _(${usd(running)})_`);
    }
  } else {
    lines.push('_nothing fits yet_');
  }

  if (d.rollover.length) {
    lines.push(
      '',
      `**Missing out** — ${d.rollover.length} item${d.rollover.length === 1 ? '' : 's'} ` +
        `over budget, rolling ${ahead ? 'into the week after' : 'into next week'} with their votes`,
      ...d.rollover.map(row),
    );
  }

  return {
    title,
    description: clamp(lines),
    color: COLOR.card,
    footer: {
      text: d.rollover.length
        ? 'Vote 👍 on a card to push something up. Nothing is bought until someone marks it ordered.'
        : 'Nothing is bought until someone marks it ordered.',
    },
  };
}

/**
 * A week that has already been bought.
 *
 * Built from the `ordered` events rather than by recomputing the digest: those
 * are the record of what someone actually confirmed, and votes may have moved
 * since.
 */
export function renderOrdered(events: SnackEvent[], week: string): Embed {
  const ordered = events.filter((e) => e.type === 'ordered');
  const by = ordered[0]?.actor_id;
  // sk is `ts#<iso>#<ulid>`, so the timestamp is the middle segment.
  const at = ordered[0]?.sk.split('#')[1]?.slice(0, 10);

  // The receipt shows what arrived, not what was asked for.
  const got = delivered(events);
  const missed = unavailable(events);
  const total = got.reduce((n, d) => n + d.price_cents * d.qty, 0);

  const lines = got.map(
    (d) =>
      `• ${d.title}${d.qty > 1 ? ` \u00d7${d.qty}` : ''}` +
      (d.substituted_for ? ` — substituted for ${d.substituted_for}` : ''),
  );
  if (missed.length) {
    lines.push('', "**Couldn't buy**");
    for (const m of missed) lines.push(`• ~~${m.title}~~`);
  }

  return {
    title: `Ordered — ${weekLabel(week)}`,
    description:
      `${by ? `<@${by}>` : 'Someone'} marked this ordered${at ? ` on ${at}` : ''} — ` +
      `**${got.length} items, ${usd(total)}**.\n\n` +
      clamp(lines),
    color: COLOR.digest,
    footer: { text: 'Rate these with /snack rate — opens the week after the order.' },
  };
}
