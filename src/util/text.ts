/**
 * Amazon serves product titles as HTML, so they arrive carrying entities:
 * `Dot&#39;s Pretzels`, `Peppermint &amp; Spearmint`. Left alone they print
 * literally in Discord and, worse, make the title unmatchable — nobody types
 * `dot&#39;s` when they mean `dot's`.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  trade: '™',
  reg: '®',
  deg: '°',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/**
 * A form suitable for matching what someone typed against a 200-character
 * Amazon title: entities decoded, case dropped, and every run of punctuation
 * flattened to a space so `dots pretzels` finds `Dot's Pretzels`.
 */
export function normalize(s: string): string {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every word someone typed has to appear somewhere in the title, in any order —
 * the same rule catalog keyword search uses, so the two behave alike.
 *
 * Each word is tried against the spaced form and then against the same string
 * with the spaces taken out, because `Dot&#39;s` normalizes to `dot s` and
 * nobody types the apostrophe.
 */
export function matchTitles<T extends { title: string }>(items: T[], needle: string): T[] {
  const words = normalize(needle).split(' ').filter(Boolean);
  if (!words.length) return [];
  const squash = (s: string) => s.replace(/ /g, '');
  return items.filter((it) => {
    const spaced = normalize(it.title);
    const squashed = squash(spaced);
    return words.every((w) => spaced.includes(w) || squashed.includes(squash(w)));
  });
}
