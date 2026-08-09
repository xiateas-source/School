import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HERO_CARE_REQUIRED_DAYS, applyCatProgress, freshHeroCareProgress,
  heroCareDays, isHeroReady, recordHeroCareActivity, resumeHeroCareActivity
} from '../src/shared/rewards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_ONE = '2026-08-09';
const DAY_TWO = '2026-08-10';

assert.deepEqual(freshHeroCareProgress(), {
  activeDates: [], lastQuestDate: null, lastQuestAt: null
});

const first = recordHeroCareActivity(freshHeroCareProgress(), DAY_ONE, true, 'server-time-1');
assert.equal(first.advanced, true);
assert.deepEqual(first.progress, {
  activeDates: [DAY_ONE], lastQuestDate: DAY_ONE, lastQuestAt: 'server-time-1'
});

const duplicate = recordHeroCareActivity(first.progress, DAY_ONE, true, 'server-time-2');
assert.equal(duplicate.advanced, false, 'a second approval on one day cannot add progress');
assert.deepEqual(duplicate.progress.activeDates, [DAY_ONE]);

const paused = recordHeroCareActivity(freshHeroCareProgress(), DAY_ONE, false, 'server-time-3');
assert.equal(paused.advanced, false, 'low care pauses the day');
assert.deepEqual(paused.progress.activeDates, []);
assert.equal(paused.progress.lastQuestDate, DAY_ONE, 'approval leaves a resumable activity marker');

const resumed = resumeHeroCareActivity(paused.progress, DAY_ONE, true);
assert.equal(resumed.advanced, true, 'restoring all needs to Okay resumes progress the same day');
assert.deepEqual(resumed.progress.activeDates, [DAY_ONE]);
assert.equal(resumed.progress.lastQuestAt, 'server-time-3', 'child care preserves the parent marker');

const tooLate = resumeHeroCareActivity(paused.progress, DAY_TWO, true);
assert.equal(tooLate.advanced, false, 'a prior-day approval cannot be backfilled by later care');
assert.deepEqual(tooLate.progress.activeDates, []);

let progress = freshHeroCareProgress();
for (let day = 1; day <= HERO_CARE_REQUIRED_DAYS + 2; day++) {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  progress = recordHeroCareActivity(progress, date, true, `server-time-${day}`).progress;
}
assert.equal(heroCareDays(progress), HERO_CARE_REQUIRED_DAYS, 'the date set caps at 14');
assert.equal(progress.activeDates.length, HERO_CARE_REQUIRED_DAYS);

const thirteenDays = { activeDates: progress.activeDates.slice(0, -1) };
assert.equal(isHeroReady({ brain: 12, energy: 12, heroCareProgress: thirteenDays }), false);
assert.equal(isHeroReady({ brain: 11, energy: 12, heroCareProgress: progress }), false);
assert.equal(isHeroReady({ brain: 12, energy: 12, heroCareProgress: progress }), true);

const crossing = applyCatProgress({
  brain: 11, energy: 12, bond: 5, evolved: false, heroCareProgress: progress
}, { brain: 1 });
assert.equal(crossing.newlyEvolved, true);
assert.equal(crossing.cat.evolved, true);

const legacyHero = applyCatProgress({
  brain: 12, energy: 12, bond: 20, evolved: true
}, { brain: 0, energy: 0, bond: 0 });
assert.equal(legacyHero.newlyEvolved, false);
assert.equal(legacyHero.cat.evolved, true, 'an existing Hero never devolves without care history');

assert.throws(
  () => recordHeroCareActivity(freshHeroCareProgress(), 'not-a-date', true),
  /invalid-hero-care-date/
);

// Static integration checks protect the two approval paths, the care-resume
// path, and the server-side child append boundary without requiring an emulator.
const store = readFileSync(join(ROOT, 'src/store.js'), 'utf8');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
assert.equal((store.match(/recordHeroCareActivity\(/g) || []).length, 2,
  'both parent approval paths record Hero-care activity');
assert.match(store, /resumeHeroCareActivity\(/);
assert.match(store, /cat\.evolved \|\| isHeroReady\(\{ \.\.\.cat, \.\.\.next \}\)/,
  'undo preserves sticky evolution');
assert.match(rules, /newDates\.size\(\) == oldDates\.size\(\) \+ 1/);
assert.match(rules, /newDates\.hasAll\(oldDates\)/);
assert.match(rules, /newDates\.hasAny\(\[day\]\)/);
assert.match(rules, /newNeeds\.hunger >= 39\.5/);
assert.match(rules, /request\.resource\.data\.get\('brain', 0\) >= 12/);
assert.match(rules, /dates\.size\(\) >= 14/);

console.log('Hero care progression: all checks passed.');
