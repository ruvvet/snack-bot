import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReminder, describeSlot, SLOTS, MAX_REMINDERS } from '../src/digest/escalation.ts';

const at = (sent: number, localWeekday: number, localHour: number) =>
  nextReminder({ sent, localWeekday, localHour });

test('pressure rises daily — one Monday, two Tuesday, three Wednesday', () => {
  assert.equal(MAX_REMINDERS, 6);
  const perDay = [1, 2, 3].map((d) => SLOTS.filter((s) => s.weekday === d).length);
  assert.deepEqual(perDay, [1, 2, 3]);
  assert.equal(SLOTS.filter((s) => s.weekday > 3).length, 0, 'nothing past Wednesday');
});

test('Monday holds off until the afternoon', () => {
  assert.equal(at(0, 1, 9).due, false, 'not at the digest itself');
  assert.equal(at(0, 1, 14).due, false);
  assert.equal(at(0, 1, 15).due, true);
  assert.equal(at(0, 1, 15).number, 1);
});

test('Tuesday takes the next two', () => {
  assert.equal(at(1, 2, 9).due, false);
  assert.equal(at(1, 2, 10).due, true);
  assert.equal(at(2, 2, 14).due, false);
  assert.equal(at(2, 2, 15).due, true);
  // The third Tuesday hour is not a slot; the next one is Wednesday.
  assert.equal(at(3, 2, 20).due, false);
});

test('Wednesday takes the last three', () => {
  assert.equal(at(3, 3, 9).due, true);
  assert.equal(at(4, 3, 12).due, true);
  assert.equal(at(5, 3, 16).due, true);
});

test('it stops after the sixth and does not rearm', () => {
  assert.equal(at(6, 3, 17).reason, 'exhausted');
  assert.equal(at(6, 1, 15).reason, 'exhausted', 'not even the following Monday');
});

test('a slot missed while the worker was unreachable is picked up later', () => {
  // Nothing sent and it is already Tuesday: Monday's slot is overdue.
  assert.equal(at(0, 2, 11).due, true);
  assert.equal(at(0, 2, 11).number, 1);
});

test('slots describe themselves for the footer', () => {
  assert.equal(describeSlot(0), 'Mon 3pm');
  assert.equal(describeSlot(1), 'Tue 10am');
  assert.equal(describeSlot(5), 'Wed 4pm');
  assert.equal(describeSlot(6), null);
});
