import { catalogSize, searchPhrase } from '../store/catalog.ts';
import type { D1Like } from '../store/d1-store.ts';
import { productPicker } from '../platform/http/components.ts';
import type { Handler } from '../platform/http/types.ts';

/**
 * Phrases people actually use when they mean "buy this". Everything before and
 * including the match is dropped, leaving the thing itself.
 */
const LEAD_INS = [
  /\bwe(?:'re| are)\s+(?:all\s+)?out\s+of\b/i,
  /\bwe\s+(?:need|want|should\s+get|should\s+order)\b/i,
  /\b(?:can|could)\s+we\s+(?:get|order|have)\b/i,
  /\b(?:someone|somebody)\s+(?:should\s+)?(?:get|order|buy)\b/i,
  /\bplease\s+(?:get|order|buy)\b/i,
  /\bno\s+more\b/i,
  /\bran\s+out\s+of\b/i,
  /\bi\s+(?:miss|want)\b/i,
];

const TRAILING_NOISE = /\b(please|pls|thanks|thx|again|soon|asap|today|tomorrow)\b/gi;

/** Pull the probable product out of a sentence. Heuristic, deliberately. */
export function extractTerm(text: string): string | null {
  let t = text.replace(/<[@#!&:][^>]+>/g, ' ').replace(/https?:\/\/\S+/g, ' ');

  for (const re of LEAD_INS) {
    const m = t.match(re);
    if (m && m.index !== undefined) {
      t = t.slice(m.index + m[0].length);
      break;
    }
  }

  t = t
    .split(/[.!?\n]/)[0]!
    .replace(TRAILING_NOISE, ' ')
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Two to five words is the useful range; longer is a sentence, not a product.
  const words = t.split(' ').filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, 5).join(' ').slice(0, 80) || null;
}

export function suggestCommand(db: D1Like): Handler {
  return async (i) => {
    const term = extractTerm(i.value);
    if (!term) {
      return {
        kind: 'ephemeral',
        text: "Couldn't pick a product out of that message. Use `/snack add` with an Amazon link instead.",
      };
    }

    const hits = await searchPhrase(db, term, 5);
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(term)}`;

    if (hits.length) {
      return {
        kind: 'ephemeral',
        text:
          `Read that as **${term}** — already in the catalog, pick one to add:\n\n` +
          `_Not it?_ ${searchUrl}`,
        components: [productPicker(hits)],
      };
    }

    // Say what it searched for and how much it searched, so a miss is
    // diagnosable by the person who hit it.
    const known = await catalogSize(db);
    return {
      kind: 'ephemeral',
      text:
        `Read that as **${term}** — no match among ${known} known product${known === 1 ? '' : 's'}.\n\n` +
        `Find it and paste the product URL into \`/snack add\`:\n${searchUrl}`,
    };
  };
}
