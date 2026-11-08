import test from 'node:test';
import assert from 'node:assert/strict';
import { leadingBlanks, shiftCalendarMonth, toDateKey } from './calendar-state.js';

test('calendar month navigation keeps the selected day inside the visible month', () => {
  assert.deepEqual(shiftCalendarMonth(2026, 1, 1, '2026-01-31'), {
    year: 2026,
    month: 2,
    selectedDate: '2026-02-28',
  });
  assert.deepEqual(shiftCalendarMonth(2028, 1, 1, '2028-01-31'), {
    year: 2028,
    month: 2,
    selectedDate: '2028-02-29',
  });
});

test('calendar weekday grid starts on Monday', () => {
  assert.equal(leadingBlanks(2026, 3), 6);
  assert.equal(toDateKey(2026, 3, 14), '2026-03-14');
});
