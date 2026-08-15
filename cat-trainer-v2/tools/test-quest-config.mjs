import assert from 'node:assert/strict';
import {
  bulkQuestPatch, duplicateQuestData, normalizeQuestRecurrence,
  questManagementGroups, recurrenceLabel, reorderQuestUpdates
} from '../src/shared/quest-management.js';

const quests = [
  { id: 'm1', title: 'First morning', section: 'Morning', order: 0, enabled: true },
  { id: 'school', title: 'School', section: 'Brain', order: 1, enabled: true },
  { id: 'm2', title: 'Second morning', section: 'Morning', order: 2, enabled: false },
  { id: 'tidy', title: 'Tidy', section: 'Tidy', order: 3, enabled: true },
  { id: 'old', title: 'Old quest', section: 'Night', order: 4, enabled: true, archived: true, archivedAt: 123 }
];

const grouped = questManagementGroups(quests);
assert.deepEqual(grouped.groups.map(group => group.window), ['morning', 'school', 'anytime']);
assert.deepEqual(grouped.groups[0].quests.map(q => q.id), ['m1', 'm2']);
assert.deepEqual(grouped.groups[0].essentialQuests.map(q => q.id), ['m1', 'm2']);
assert.deepEqual(grouped.groups[0].bonusQuests, []);
assert.deepEqual(grouped.archived.map(q => q.id), ['old']);
assert.equal(grouped.groups.find(g => g.window === 'anytime').quests[0].id, 'tidy',
  'Tidy stays in Anytime while its essential status remains independent');

assert.deepEqual(normalizeQuestRecurrence({ type: 'selected_days', days: ['FR', 'MO', 'FR'] }),
  { type: 'selected_days', days: ['MO', 'FR'] });
assert.deepEqual(normalizeQuestRecurrence({ type: 'one_time', date: '2026-08-20' }),
  { type: 'one_time', date: '2026-08-20' });
assert.throws(() => normalizeQuestRecurrence({ type: 'selected_days', days: [] }), /recurrence-days-required/);
assert.throws(() => normalizeQuestRecurrence({ type: 'one_time', date: '' }), /recurrence-date-required/);
assert.equal(recurrenceLabel({ recurrence: { type: 'weekdays' } }), 'Weekdays');

assert.deepEqual(bulkQuestPatch('pause'), { enabled: false });
assert.deepEqual(bulkQuestPatch('resume'), { enabled: true });
assert.deepEqual(bulkQuestPatch('archive'), { archived: true });
assert.deepEqual(bulkQuestPatch('restore'), { archived: false });
assert.deepEqual(bulkQuestPatch('daypart', 'anytime'), { timeWindow: 'anytime', routineId: 'anytime' });
assert.deepEqual(bulkQuestPatch('essential', true), { isDailyEssential: true });
assert.deepEqual(bulkQuestPatch('essential', false), { isDailyEssential: false });
assert.deepEqual(bulkQuestPatch('recurrence', { type: 'weekends' }), { recurrence: { type: 'weekends' } });
assert.throws(() => bulkQuestPatch('daypart', 'optional'), /bad-time-window/,
  'Anytime is timing; no optional timing value may be introduced');

const duplicate = duplicateQuestData({
  ...quests[0],
  archived: true,
  archivedAt: 123,
  mastery: { streak: 10 },
  dependsOnQuestIds: ['wake']
}, { id: 'copy', order: 9 });
assert.equal(duplicate.id, 'copy');
assert.equal(duplicate.title, 'First morning copy');
assert.equal(duplicate.enabled, false, 'a copy starts paused for parent review');
assert.equal(duplicate.archived, false, 'a copy is not trapped in the archive');
assert.equal(duplicate.archivedAt, undefined);
assert.equal(duplicate.mastery, undefined);
assert.deepEqual(duplicate.dependsOnQuestIds, ['wake'], 'valid scheduling configuration is retained');
assert.equal(duplicate.isDailyEssential, true);

const down = reorderQuestUpdates(quests, 'm1', 'down');
const downMap = new Map(down.map(change => [change.id, change.order]));
assert.ok(downMap.get('m1') > downMap.get('m2'), 'Down moves only to the next Morning peer');
const up = reorderQuestUpdates(quests, 'm2', 'up');
const upMap = new Map(up.map(change => [change.id, change.order]));
assert.ok(upMap.get('m2') < upMap.get('m1'));
assert.deepEqual(reorderQuestUpdates(quests, 'm1', 'up'), [], 'top peer cannot move farther up');
assert.deepEqual(reorderQuestUpdates(quests, 'old', 'up'), [], 'archived quests are not reorderable');
const mixed = [
  { id: 'essential', section: 'Morning', order: 0 },
  { id: 'bonus', section: 'Morning', isDailyEssential: false, order: 1 }
];
assert.deepEqual(reorderQuestUpdates(mixed, 'essential', 'down'), [],
  'one-row reorder does not cross the visible Essential/Bonus boundary');

console.log('Quest Slice 3 parent configuration helpers: all checks passed.');
