/**
 * Is this plausibly something you'd eat at work?
 *
 * A blocklist rather than an allowlist, deliberately. An office snack run
 * legitimately includes paper plates, coffee filters and a kettle, so listing
 * what's allowed would reject real requests. Listing what obviously isn't food
 * catches the actual failure — someone pasting a laptop — and lets everything
 * ambiguous through.
 *
 * Two signals, because neither is reliable alone. `data-category` is a slug
 * that appears on nearly every page, but its vocabulary is Amazon's internal
 * one: computer parts are `pc`, and a bag of gummy bears came back
 * `toys-and-games`. The breadcrumb is readable and usually right, but plenty of
 * pages have none. So the readable department decides first when it says food,
 * and the slug is the catch-all after that.
 */

/** Slug and department fragments that settle it as edible. */
const FOOD_SLUGS = new Set(['grocery', 'wine', 'beer-wine-spirits', 'gourmet-food', 'candy']);
const FOOD_DEPARTMENTS = [/grocery/i, /gourmet food/i, /candy/i, /snack/i, /beverage/i, /coffee/i];

/**
 * Amazon's own slugs, as observed on real product pages. `pc` is the one that
 * matters most and is the least guessable — it's what a $500 RAM kit reports.
 */
const NOT_FOOD_SLUGS = new Set([
  'pc',
  'computers',
  'electronics',
  'apple-devices',
  'wireless',
  'mobile',
  'photo',
  'software',
  'videogames',
  'videogames-consoles',
  'instant-video',
  'digital-music',
  'music',
  'books',
  'movies-tv',
  'audible',
  'fashion',
  'shoes',
  'jewelry',
  'watches',
  'luggage',
  'beauty',
  'tools',
  'hi',
  'automotive',
  'industrial',
  'lawngarden',
  'sporting',
  'outdoor',
  'furniture',
  'appliances',
  'mobile-apps',
  'gift-cards',
  'musical-instruments',
]);

/**
 * Read from the breadcrumb, so these are Amazon's display names. Toys and pets
 * sit here rather than in the slug list because candy is sometimes filed under
 * toys — the food check above rescues those, and a page whose *breadcrumb* says
 * Toys & Games really is a toy.
 */
const NOT_FOOD_DEPARTMENTS = [
  /electronics/i,
  /computers?\b/i,
  /cell phones/i,
  /video games/i,
  /software/i,
  /clothing/i,
  /shoes/i,
  /jewelry/i,
  /watches/i,
  /handbags/i,
  /beauty/i,
  /tools & home/i,
  /automotive/i,
  /industrial & scientific/i,
  /musical instruments/i,
  /books/i,
  /movies & tv/i,
  /appliances/i,
  /furniture/i,
  /sports & outdoors/i,
  /toys & games/i,
  /video games/i,
  /pet supplies/i,
  /baby/i,
  /gift cards/i,
];

export type Verdict = 'food' | 'not_food' | 'unknown';

export function classify(category: string | undefined, department?: string): Verdict {
  const slug = category?.trim().toLowerCase() ?? '';
  const dept = department?.trim() ?? '';

  // A food department outranks the slug: gummy bears report `toys-and-games`.
  if (slug && FOOD_SLUGS.has(slug)) return 'food';
  if (dept && FOOD_DEPARTMENTS.some((re) => re.test(dept))) return 'food';

  if (slug && NOT_FOOD_SLUGS.has(slug)) return 'not_food';
  if (dept && NOT_FOOD_DEPARTMENTS.some((re) => re.test(dept))) return 'not_food';

  return 'unknown';
}

/** "Apple Devices" out of a slug, for a message a person can act on. */
export function departmentName(category: string | undefined, department?: string): string {
  if (department) return department;
  if (!category) return 'an unknown department';
  return category
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
