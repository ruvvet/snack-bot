import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asinFromUrl,
  isAmazonUrl,
  isShortened,
  looksLikeUrl,
  packSizeFromTitle,
  titleFromUrl,
} from '../src/amazon/url.ts';

test('an ASIN is pulled from every common Amazon URL shape', () => {
  const cases: [string, string][] = [
    ['https://www.amazon.com/Oreo-Cookies/dp/B0947SQPQ2/ref=sr_1_3?keywords=oreo', 'B0947SQPQ2'],
    ['https://amazon.com/dp/B07GPFDL1K', 'B07GPFDL1K'],
    ['https://www.amazon.com/gp/product/B00E78GRUY?psc=1', 'B00E78GRUY'],
    ['https://www.amazon.com/gp/aw/d/B075H1SCLW', 'B075H1SCLW'],
    ['https://www.amazon.co.uk/some-slug/dp/B01N5RAVWU/', 'B01N5RAVWU'],
    ['https://www.amazon.com/s?asin=B0055Q7L4K', 'B0055Q7L4K'],
  ];
  for (const [url, asin] of cases) assert.equal(asinFromUrl(url), asin, url);
});

test('a URL with no product ID yields null', () => {
  assert.equal(asinFromUrl('https://www.amazon.com/s?k=oreos'), null);
  assert.equal(asinFromUrl('not a url'), null);
});

test('only Amazon hosts and its shorteners are accepted', () => {
  assert.equal(isAmazonUrl('https://www.amazon.com/dp/B07GPFDL1K'), true);
  assert.equal(isAmazonUrl('https://a.co/d/abc123'), true);
  assert.equal(isAmazonUrl('https://www.target.com/p/oreos'), false);
  // Lookalike hosts must not pass — a loose suffix pattern accepts these.
  assert.equal(isAmazonUrl('https://amazon.com.evil.example/dp/B07GPFDL1K'), false);
  assert.equal(isAmazonUrl('https://notamazon.com/dp/B07GPFDL1K'), false);
  assert.equal(isAmazonUrl('https://amazon.co.uk.evil.example/dp/B07GPFDL1K'), false);
  assert.equal(isAmazonUrl('https://smile.amazon.com/dp/B07GPFDL1K'), true);
  assert.equal(isAmazonUrl('https://www.amazon.co.uk/dp/B07GPFDL1K'), true);
});

test('shorteners are detected so the redirect gets followed', () => {
  assert.equal(isShortened('https://a.co/d/abc123'), true);
  assert.equal(isShortened('https://www.amazon.com/dp/B07GPFDL1K'), false);
});

test('a keyword is not mistaken for a link', () => {
  assert.equal(looksLikeUrl('oreos'), false);
  assert.equal(looksLikeUrl('https://amazon.com/dp/B07GPFDL1K'), true);
});

test('the URL slug gives a readable fallback title', () => {
  assert.equal(
    titleFromUrl('https://www.amazon.com/Oreo-Chocolate-Sandwich-Cookies/dp/B0947SQPQ2/ref=x'),
    'Oreo Chocolate Sandwich Cookies',
  );
  assert.equal(titleFromUrl('https://amazon.com/dp/B07GPFDL1K'), null);
});

test('pack size is read out of a title when it is stated', () => {
  assert.equal(packSizeFromTitle('Doritos Nacho Cheese, 28 Count Variety Box'), 28);
  assert.equal(packSizeFromTitle('KIND Bars, Pack of 12'), 12);
  assert.equal(packSizeFromTitle('Goldfish Crackers 45-ct'), 45);
  assert.equal(packSizeFromTitle('Planters Mixed Nuts, 10.3 oz Can'), null);
});

test('a week key resolves to the Monday it starts on', async () => {
  const { mondayOf, weekLabel, isoWeek } = await import('../src/util/week.ts');

  assert.equal(mondayOf('2026-W37')!.toISOString().slice(0, 10), '2026-09-07');
  assert.equal(mondayOf('2026-W01')!.toISOString().slice(0, 10), '2025-12-29');
  assert.equal(weekLabel('2026-W37'), 'week of Sep 7 (2026-W37)');
  assert.equal(weekLabel('nonsense'), 'nonsense');

  // The Monday of a week must belong to that same week.
  for (const w of ['2026-W01', '2026-W37', '2026-W53', '2024-W09']) {
    const d = mondayOf(w);
    if (d) assert.equal(isoWeek(d), w, w);
  }
});

test('9am Eastern lands on a different UTC hour either side of daylight saving', async () => {
  const { hourIn } = await import('../src/util/week.ts');
  const TZ = 'America/New_York';

  // Summer: EDT is UTC-4, so 13:00 UTC is 09:00 local.
  assert.equal(hourIn(TZ, new Date('2026-07-06T13:00:00Z')), 9);
  assert.equal(hourIn(TZ, new Date('2026-07-06T14:00:00Z')), 10);

  // Winter: EST is UTC-5, so the same local hour is an hour later in UTC.
  assert.equal(hourIn(TZ, new Date('2026-01-05T14:00:00Z')), 9);
  assert.equal(hourIn(TZ, new Date('2026-01-05T13:00:00Z')), 8);

  // Which is why the schedule is hourly: on any given Monday, exactly one of
  // the 24 firings is 9am locally, whatever the offset happens to be.
  for (const day of ['2026-07-06', '2026-01-05', '2026-03-09', '2026-11-02']) {
    const hits = Array.from({ length: 24 }, (_, h) =>
      hourIn(TZ, new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`)),
    ).filter((h) => h === 9);
    assert.equal(hits.length, 1, day);
  }
});
