import assert from 'node:assert/strict';
import {
  addDays, weekday, startOfWeek, weekDates, isAfterDate, sameWeek,
  dayOfMonth
} from '../src/shared/dates.js';

// Basic shifting.
assert.equal(addDays('2026-08-09', 1), '2026-08-10');
assert.equal(addDays('2026-08-09', -1), '2026-08-08');
// Across a month boundary.
assert.equal(addDays('2026-08-31', 1), '2026-09-01');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
// Across a leap day.
assert.equal(addDays('2024-02-28', 1), '2024-02-29');
// Across a US "spring forward" DST boundary (2026-03-08) — must not lose a day.
assert.equal(addDays('2026-03-07', 1), '2026-03-08');
assert.equal(addDays('2026-03-08', 1), '2026-03-09');

// August 9 2026 is a Sunday.
assert.equal(weekday('2026-08-09'), 0);
assert.equal(weekday('2026-08-10'), 1);
assert.equal(startOfWeek('2026-08-12'), '2026-08-09', 'week starts on the Sunday on/before');
assert.equal(startOfWeek('2026-08-09'), '2026-08-09');

assert.deepEqual(weekDates('2026-08-09'), [
  '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'
]);
assert.equal(weekDates('2026-08-12').length, 7);
assert.equal(weekDates('2026-08-12')[0], '2026-08-09', 'weekDates normalizes any mid-week date to its Sunday');

assert.equal(isAfterDate('2026-08-11', '2026-08-10'), true);
assert.equal(isAfterDate('2026-08-10', '2026-08-10'), false);
assert.equal(isAfterDate('2026-08-09', '2026-08-10'), false);

assert.equal(sameWeek('2026-08-09', '2026-08-15'), true);
assert.equal(sameWeek('2026-08-09', '2026-08-16'), false);

assert.equal(dayOfMonth('2026-08-09'), 9);

console.log('Date navigation helpers: all checks passed.');
