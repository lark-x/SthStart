import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCalendarDate, leadingBlanks, shiftCalendarMonth, toDateKey } from './calendar-state.js';

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

test('calendar date labels use the local calendar day instead of UTC parsing', () => {
  assert.equal(formatCalendarDate('2026-11-14'), '11 月 14 日 周六');
  assert.equal(formatCalendarDate('2026-11-14', { short: true }), '11 月 14 日');
  assert.equal(formatCalendarDate('2026-11-30'), '11 月 30 日 周一');
  assert.equal(formatCalendarDate('not-a-date'), 'not-a-date');
});
