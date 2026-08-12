import assert from 'node:assert/strict';
import {
  DAY_PHASES, TIME_WINDOWS,
  migrationDisposition, questTimeWindow, questIsDailyEssential, questDependsOn,
  phaseForHour, isEligible, nextMissions, minutesAvailable, progressCounts, organizeDay,
  questRecurrence, isScheduledOn, planDay
} from '../src/shared/routines.js';

// --- Read-time defaults from legacy shape (no backfill) ----------------------
// timeWindow defaults from section; an explicit field wins.
assert.equal(questTimeWindow({ section: 'Morning' }), 'morning');
assert.equal(questTimeWindow({ section: 'Brain' }), 'school');
assert.equal(questTimeWindow({ section: 'Move' }), 'anytime');
assert.equal(questTimeWindow({ section: 'Tidy' }), 'anytime');
assert.equal(questTimeWindow({ section: 'Night' }), 'night');
assert.equal(questTimeWindow({ section: 'General' }), 'anytime');
assert.equal(questTimeWindow({ section: 'Morning', timeWindow: 'evening' }), 'evening');
assert.equal(questTimeWindow({ section: 'Nonsense' }), 'anytime', 'unknown section → anytime');

// isDailyEssential defaults: Morning/Tidy/Night/Brain essential; Move/General not.
assert.equal(questIsDailyEssential({ id: 'm-teeth', section: 'Morning' }), true);
assert.equal(questIsDailyEssential({ id: 't-space', section: 'Tidy' }), true);
assert.equal(questIsDailyEssential({ id: 'n-room', section: 'Night' }), true);
assert.equal(questIsDailyEssential({ id: 'b-read', section: 'Brain' }), true, 'required reading stays essential');
assert.equal(questIsDailyEssential({ id: 'gen-x', section: 'General' }), false);
assert.equal(questIsDailyEssential({ id: 'x', section: 'Morning', isDailyEssential: false }), false, 'explicit flag wins');

// Migration disposition: v-move is classified activities_pending and therefore
// is NOT a routine responsibility, even though it lives in a section.
assert.equal(migrationDisposition({ id: 'v-move', section: 'Move' }), 'activities_pending');
assert.equal(questIsDailyEssential({ id: 'v-move', section: 'Move' }), false,
  'an activities_pending item is never treated as a Daily Essential');
assert.equal(migrationDisposition({ id: 'm-teeth', section: 'Morning' }), 'quest');
assert.equal(migrationDisposition({ id: 'v-move', migrationDisposition: 'quest' }), 'quest', 'explicit override wins');

assert.deepEqual(questDependsOn({ dependsOnQuestIds: ['a', 'b'] }), ['a', 'b']);
assert.deepEqual(questDependsOn({}), [], 'missing deps default to []');

// --- Phase of day (night wraps midnight) -------------------------------------
assert.equal(phaseForHour(2), 'night');
assert.equal(phaseForHour(5), 'morning');
assert.equal(phaseForHour(10), 'morning');
assert.equal(phaseForHour(11), 'school');
assert.equal(phaseForHour(14), 'school');
assert.equal(phaseForHour(15), 'evening');
assert.equal(phaseForHour(19), 'evening');
assert.equal(phaseForHour(20), 'night');
assert.equal(phaseForHour(23), 'night');
assert.equal(phaseForHour('nope'), 'night', 'bad input → night, never throws');

// --- Eligibility + Routine Mode ("pick your next mission", 2–4) --------------
const morning = [
  { id: 'a', section: 'Morning', points: 1, order: 0 },
  { id: 'b', section: 'Morning', points: 1, order: 1 },
  { id: 'c', section: 'Morning', points: 1, order: 2 },
  { id: 'd', section: 'Morning', points: 1, order: 3 },
  { id: 'e', section: 'Morning', points: 1, order: 4 }
];
// Nothing done → first 4 in order are the offered missions (cap enforced).
assert.deepEqual(nextMissions(morning, [], 4).map(q => q.id), ['a', 'b', 'c', 'd']);
// A finished quest drops out; the next eligible one fills the slot.
assert.deepEqual(nextMissions(morning, ['a'], 4).map(q => q.id), ['b', 'c', 'd', 'e']);

// Dependencies gate eligibility until the prerequisite is done.
const dep = [
  { id: 'bowl', section: 'Morning', points: 1, order: 0, dependsOnQuestIds: ['breakfast'] },
  { id: 'breakfast', section: 'Morning', points: 1, order: 1 }
];
assert.equal(isEligible(dep[0], []), false, 'wash bowl blocked until breakfast is done');
assert.equal(isEligible(dep[0], ['breakfast']), true);
assert.deepEqual(nextMissions(dep, [], 4).map(q => q.id), ['breakfast'], 'only the unblocked mission is offered');

// --- Progress framed as opportunity, never loss ------------------------------
assert.deepEqual(progressCounts(morning, ['a', 'b']), { total: 5, complete: 2, left: 3 });
assert.equal(minutesAvailable(morning, ['a', 'b']), 3, 'only unfinished points count');
assert.equal(minutesAvailable(morning, ['a', 'b', 'c', 'd', 'e']), 0);

// --- Now / Next / Later / Anytime + Still needs doing ------------------------
const all = [
  { id: 'm1', section: 'Morning', points: 1 },
  { id: 'm2', section: 'Morning', points: 1 },
  { id: 's1', section: 'Brain', points: 1 },   // school
  { id: 'ev1', section: 'Evening', points: 1 },// evening (explicit section not in defaults, but window maps)
  { id: 'n1', section: 'Night', points: 1 },
  { id: 'any1', section: 'General', points: 1 } // anytime
];
// Note: 'Evening' isn't a legacy section; force its window explicitly.
all[3] = { id: 'ev1', section: 'Tidy', timeWindow: 'evening', points: 1 };

// It's the morning phase: Morning is NOW, School is NEXT, evening+night are LATER.
let day = organizeDay(all, { phase: 'morning', completedIds: [] });
assert.equal(day.now.window, 'morning');
assert.deepEqual(day.now.quests.map(q => q.id), ['m1', 'm2']);
assert.equal(day.next.window, 'school');
assert.deepEqual(day.later.map(g => g.window), ['evening', 'night']);
assert.deepEqual(day.anytime.map(q => q.id), ['any1']);
assert.equal(day.stillNeedsDoing.length, 0);

// Later in the day (evening): morning + school are past. Morning has an unfinished
// quest → Still needs doing; school is fully done → not surfaced.
day = organizeDay(all, { phase: 'evening', completedIds: ['m1', 's1'] });
assert.equal(day.now.window, 'evening');
assert.equal(day.next.window, 'night');
const stillWindows = day.stillNeedsDoing.map(g => g.window);
assert.deepEqual(stillWindows, ['morning'], 'only past windows with unfinished work surface');
assert.equal(day.stillNeedsDoing[0].quests.some(q => q.id === 'm2'), true);

// A future window is NOT promoted to Now early: with only a Night quest during
// the morning phase, Now stays empty and Night remains NEXT until its window.
day = organizeDay([{ id: 'n1', section: 'Night', points: 1 }], { phase: 'morning', completedIds: [] });
assert.equal(day.now, null, 'current phase empty → no Now; a future window is not pulled forward');
assert.equal(day.next.window, 'night');
assert.deepEqual(day.later, []);

// The nearest future window is NEXT; the rest stay LATER — none become Now early.
day = organizeDay([
  { id: 's1', section: 'Brain', points: 1 },  // school (future)
  { id: 'n1', section: 'Night', points: 1 }   // night (future)
], { phase: 'morning', completedIds: [] });
assert.equal(day.now, null);
assert.equal(day.next.window, 'school');
assert.deepEqual(day.later.map(g => g.window), ['night']);

// Anytime stays available independently even when Now is empty and work is future.
day = organizeDay([
  { id: 'any1', section: 'General', points: 1 }, // anytime
  { id: 'n1', section: 'Night', points: 1 }      // night (future)
], { phase: 'morning', completedIds: [] });
assert.equal(day.now, null, 'anytime never fills the Now slot');
assert.equal(day.next.window, 'night');
assert.deepEqual(day.anytime.map(q => q.id), ['any1'], 'anytime remains available regardless of phase');

// Anytime-only set: no now/next/later, just the anytime bucket.
day = organizeDay([{ id: 'any1', section: 'General', points: 1 }], { phase: 'morning', completedIds: [] });
assert.equal(day.now, null);
assert.equal(day.next, null);
assert.deepEqual(day.anytime.map(q => q.id), ['any1']);

assert.deepEqual(DAY_PHASES, ['morning', 'school', 'evening', 'night']);
assert.equal(TIME_WINDOWS.length, 5);

// --- Recurrence (Slice 2) ----------------------------------------------------
// 2026-08-09 = Sunday, 08-10 = Monday, 08-15 = Saturday.
assert.deepEqual(questRecurrence({}), { type: 'everyday' }, 'legacy quest defaults to everyday');
assert.deepEqual(questRecurrence({ recurrence: { type: 'bogus' } }), { type: 'everyday' }, 'unknown type → everyday');
assert.equal(isScheduledOn({}, '2026-08-10'), true, 'no recurrence → scheduled every day');
const wk = { recurrence: { type: 'weekdays' } };
assert.equal(isScheduledOn(wk, '2026-08-10'), true, 'weekdays: Monday yes');
assert.equal(isScheduledOn(wk, '2026-08-15'), false, 'weekdays: Saturday no');
assert.equal(isScheduledOn(wk, '2026-08-09'), false, 'weekdays: Sunday no');
const we = { recurrence: { type: 'weekends' } };
assert.equal(isScheduledOn(we, '2026-08-15'), true, 'weekends: Saturday yes');
assert.equal(isScheduledOn(we, '2026-08-10'), false, 'weekends: Monday no');
const sel = { recurrence: { type: 'selected_days', days: ['MO', 'WE', 'FR'] } };
assert.equal(isScheduledOn(sel, '2026-08-10'), true, 'selected: Monday listed');
assert.equal(isScheduledOn(sel, '2026-08-11'), false, 'selected: Tuesday not listed');
const once = { recurrence: { type: 'one_time', date: '2026-08-12' } };
assert.equal(isScheduledOn(once, '2026-08-12'), true);
assert.equal(isScheduledOn(once, '2026-08-13'), false);

// --- planDay: recurrence filter + today-only overrides -----------------------
const pool = [
  { id: 'a', section: 'Morning', points: 1 },                               // everyday
  { id: 'wkday', section: 'Brain', points: 1, recurrence: { type: 'weekdays' } },
  { id: 'wkend', section: 'Tidy', points: 1, recurrence: { type: 'weekends' } }
];
// Monday: everyday + weekday quest present, weekend quest filtered out.
let plan = planDay(pool, { ymd: '2026-08-10' });
assert.deepEqual(plan.map(q => q.id).sort(), ['a', 'wkday']);
// Saturday: everyday + weekend, weekday filtered out.
plan = planDay(pool, { ymd: '2026-08-15' });
assert.deepEqual(plan.map(q => q.id).sort(), ['a', 'wkend']);

// Legacy passthrough: no ymd filter, no overrides → identical set, same objects.
plan = planDay(pool, {});
assert.equal(plan.length, 3);

// Override: skip removes for today only.
plan = planDay(pool, { ymd: '2026-08-10', overrides: { a: { action: 'skip' } } });
assert.deepEqual(plan.map(q => q.id).sort(), ['wkday'], 'skipped quest hidden today');
// Override: move changes the effective window without mutating the source.
plan = planDay(pool, { ymd: '2026-08-10', overrides: { a: { action: 'move', window: 'evening' } } });
const movedA = plan.find(q => q.id === 'a');
assert.equal(movedA.timeWindow, 'evening', 'moved quest shows the override window');
assert.equal(pool[0].timeWindow, undefined, 'source quest is not mutated');
// Override: make next bumps to the front.
plan = planDay(pool, { ymd: '2026-08-10', overrides: { wkday: { action: 'next' } } });
assert.equal(plan[0].id, 'wkday', 'make-next quest leads the plan');

console.log('Routine organization + recurrence/overrides (Quest Slice 1–2): all checks passed.');
