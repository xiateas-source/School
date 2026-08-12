import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATEGORY, normalizeTransaction, summarizeWeek } from '../src/shared/ledger.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const rows = [
  { id: 'e1', category: CATEGORY.EARNED, reasonCode: 'good_choice', reasonLabel: 'Good choice', requestedAmount: 1, amount: 1 },
  { id: 'e2', category: CATEGORY.EARNED, reasonCode: 'quest', reasonLabel: 'Quest', requestedAmount: 1, amount: 1 },
  { id: 'reset', category: CATEGORY.EARNED, reasonCode: 'hero_reset', reasonLabel: 'Hero’s Reset', requestedAmount: 1, amount: 1, relatedTransactionId: 'r1' },
  { id: 'r1', category: CATEGORY.ROOM_TO_GROW, reasonCode: 'rebuttal', reasonLabel: 'Rebuttal', requestedAmount: -2, amount: -2 },
  { id: 'r2', category: CATEGORY.ROOM_TO_GROW, reasonCode: 'rebuttal', reasonLabel: 'Rebuttal', requestedAmount: -2, amount: -1 },
  { id: 'r3', category: CATEGORY.ROOM_TO_GROW, reasonCode: 'refused_breaths', reasonLabel: 'Refused breaths', requestedAmount: -2, amount: 0 },
  { id: 'screen', category: CATEGORY.USED, reasonCode: 'screen_time', requestedAmount: -8, amount: -8 },
  { id: 'junk', category: CATEGORY.EARNED, reasonCode: 'good_choice', reasonLabel: 'Good choice', requestedAmount: 1, amount: 1 },
  { id: 'corr', category: CATEGORY.CORRECTION, reasonCode: 'correction', requestedAmount: -1, amount: -1, reversesTransactionId: 'junk' }
].map(t => normalizeTransaction(t));

const week = summarizeWeek(rows);
assert.equal(week.earnedCount, 3, 'corrected positive is excluded from weekly wins');
assert.equal(week.earnedPoints, 3);
assert.equal(week.usedMinutes, 8, 'weekly Used remains screen time only');
assert.equal(week.roomToGrowCount, 3);
assert.equal(week.roomToGrowPoints, -6, 'weekly Room to Grow preserves full intended -2 impact');
assert.equal(week.heroResets, 1);
assert.equal(week.linkedRecoveries, 1);
assert.deepEqual(week.behaviors, [
  { label: 'Rebuttal', count: 2 },
  { label: 'Refused breaths', count: 1 }
]);

const app = read('src/app.js');
const store = read('src/store.js');
const css = read('styles/base.css');
assert.match(app, /historyMode: 'day'/, 'Day remains the default view');
assert.match(app, /data-history-mode="week"/, 'Week view is explicitly selectable');
assert.match(app, /summarizeWeek\(normalizedWeek\(\)\)/, 'both screens use shared weekly math');
assert.match(app, /Room to Grow patterns/, 'week view names behavior patterns neutrally');
assert.match(store, /subscribeRangeTransactions/, 'week range has a live transaction query');
assert.match(css, /Weekly reflection \(Slice 4\)/, 'weekly reflection styles are present');

const weeklyUiStart = app.indexOf('function weekSummaryHtml');
const weeklyUiEnd = app.indexOf('// The full date navigator', weeklyUiStart);
const weeklyUi = app.slice(weeklyUiStart, weeklyUiEnd).toLowerCase();
for (const banned of ['best day', 'worst day', 'positive percentage', 'leaderboard', 'compared to']) {
  assert.equal(weeklyUi.includes(banned), false, `weekly UI must not include ${banned}`);
}

console.log('Slice 4 weekly reflection: all checks passed.');
