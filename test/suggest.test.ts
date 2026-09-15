import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTerm } from '../src/commands/suggest.ts';

test('a product is pulled out of the way people actually phrase it', () => {
  const cases: [string, string][] = [
    ["we're out of sparkling water", 'sparkling water'],
    ['We are all out of Oreos!', 'Oreos'],
    ['can we get some kind bars please', 'some kind bars'],
    ['we need more cold brew coffee', 'more cold brew coffee'],
    ['someone should order goldfish crackers', 'goldfish crackers'],
    ['ran out of pretzels again', 'pretzels'],
    ['no more sparkling water :(', 'sparkling water'],
  ];
  for (const [msg, want] of cases) assert.equal(extractTerm(msg), want, msg);
});

test('mentions, links and punctuation are stripped', () => {
  assert.equal(
    extractTerm("<@1234> we're out of oreos https://example.com/x"),
    'oreos',
  );
});

test('a sentence with no product yields something short or nothing', () => {
  assert.equal(extractTerm(''), null);
  assert.equal(extractTerm('<@1234>'), null);
  // Never returns a whole paragraph.
  const long = extractTerm('we need ' + 'word '.repeat(20));
  assert.ok(long && long.split(' ').length <= 5);
});

test('only the first sentence is considered', () => {
  assert.equal(extractTerm("we're out of oreos. also the sink is broken"), 'oreos');
});
