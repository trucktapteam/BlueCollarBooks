import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDueDate, parseTermsToDays, toISODateString } from '../src/utils/date.ts';

test('parseTermsToDays reads the first number in the terms text', () => {
  assert.equal(parseTermsToDays('Net 30'), 30);
  assert.equal(parseTermsToDays('Net 15'), 15);
  assert.equal(parseTermsToDays('Due on receipt'), 0);
  assert.equal(parseTermsToDays(undefined), 0);
});

test('computeDueDate adds the terms days to the invoice date', () => {
  const due = computeDueDate('2026-04-01', 'Net 30');
  assert.ok(due);
  assert.equal(toISODateString(due), '2026-05-01');
});

test('computeDueDate with no terms falls back to the invoice date itself', () => {
  const due = computeDueDate('2026-04-01', undefined);
  assert.ok(due);
  assert.equal(toISODateString(due), '2026-04-01');
});
