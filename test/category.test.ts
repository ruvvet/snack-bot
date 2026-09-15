import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, departmentName } from '../src/amazon/category.ts';

test('groceries pass, obvious non-food is caught', () => {
  assert.equal(classify('grocery'), 'food');
  assert.equal(classify('electronics'), 'not_food');
  assert.equal(classify('apple-devices'), 'not_food');
  assert.equal(classify('tools'), 'not_food');
  assert.equal(classify('gift-cards'), 'not_food');
});

test('anything ambiguous is let through rather than refused', () => {
  // A real office snack run buys paper plates, coffee filters and a kettle.
  // Blocking anything not on a food list would reject those.
  assert.equal(classify('kitchen'), 'unknown');
  assert.equal(classify('hpc'), 'unknown');
  assert.equal(classify('office-products'), 'unknown');
  assert.equal(classify(undefined), 'unknown', 'a page with no department parses to unknown');
  assert.equal(classify(''), 'unknown');
});

test('classification ignores case and stray whitespace', () => {
  assert.equal(classify('  Electronics '), 'not_food');
  assert.equal(classify('GROCERY'), 'food');
});

test('the department reads as something a person can act on', () => {
  // The breadcrumb wins when the page had one.
  assert.equal(departmentName('grocery', 'Grocery & Gourmet Food'), 'Grocery & Gourmet Food');
  // Otherwise the slug is made presentable.
  assert.equal(departmentName('apple-devices'), 'Apple Devices');
  assert.equal(departmentName('electronics'), 'Electronics');
  assert.equal(departmentName(undefined), 'an unknown department');
});
