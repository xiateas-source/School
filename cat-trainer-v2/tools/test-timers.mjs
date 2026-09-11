import assert from 'node:assert/strict';
import {
  TIMER_MODES, BRUSH_SECONDS, MIN_TIMER_SECONDS, MAX_TIMER_SECONDS,
  questTimerMode, questTimerSeconds, raceSafetyBlock, canRace,
  effectiveTimerMode, hasTimer, formatDuration, timerStartLabel,
  timerState, fixedDurationSatisfied
} from '../src/shared/timers.js';

// --- Read-time defaults: a quest with no timer fields has no timer -----------
assert.equal(questTimerMode({}), 'none');
assert.equal(questTimerMode({ timerMode: 'nonsense' }), 'none', 'unknown mode → none, never throws');
assert.equal(questTimerMode({ timerMode: 'fixed_duration' }), 'fixed_duration');
assert.equal(hasTimer({}), false, 'existing quests are untouched by this feature');
assert.equal(hasTimer({ timerMode: 'fixed_duration' }), true);

// Seconds are clamped, so a mistyped form value can never produce a 9-hour
// timer or a zero-second one.
assert.equal(questTimerSeconds({}), BRUSH_SECONDS, 'default is the 2:00 brush timer');
assert.equal(questTimerSeconds({ timerSeconds: 'abc' }), BRUSH_SECONDS);
assert.equal(questTimerSeconds({ timerSeconds: 1 }), MIN_TIMER_SECONDS);
assert.equal(questTimerSeconds({ timerSeconds: 999999 }), MAX_TIMER_SECONDS);
assert.equal(questTimerSeconds({ timerSeconds: 90.4 }), 90, 'rounded, not truncated oddly');

// --- Racing safety (§11.2). These are the rules, not suggestions -------------
// School work is accuracy work. Sirus's whole course list sits in this window.
assert.ok(raceSafetyBlock({ title: 'Math C', timeWindow: 'school' }));
assert.equal(canRace({ title: 'Math C', timeWindow: 'school' }), false,
  'racing a maths lesson trades correctness for speed');

// The spec's named examples, wherever they are filed.
for (const title of ['Brush teeth', 'Night teeth and pajamas', 'Eat breakfast and wash bowl', 'Cut with a knife']) {
  assert.equal(canRace({ title, timeWindow: 'morning' }), false, `${title} must not be raceable`);
}

// The explicit parent override always wins.
assert.equal(canRace({ title: 'Tidy toys', unsafeToRush: true }), false);

// And a genuinely safe task still races — the feature is not neutered.
assert.equal(canRace({ title: 'Tidy toys', timeWindow: 'evening' }), true);
assert.equal(canRace({ title: 'Put laundry in the hamper', timeWindow: 'anytime' }), true);
assert.equal(raceSafetyBlock({ title: 'Tidy toys' }), null);

// A stored race on an unsafe quest DEGRADES to fixed duration rather than
// vanishing: the parent wanted a timer, and the safe kind still helps.
assert.equal(
  effectiveTimerMode({ title: 'Brush teeth', timerMode: 'optional_race' }),
  'fixed_duration',
  'an unsafe race becomes a plain timer, it does not silently disappear'
);
assert.equal(
  effectiveTimerMode({ title: 'Tidy toys', timeWindow: 'evening', timerMode: 'optional_race' }),
  'optional_race'
);
// Fixed duration is never blocked by safety — a 2:00 brush timer is the
// opposite of rushing.
assert.equal(
  effectiveTimerMode({ title: 'Brush teeth', timerMode: 'fixed_duration' }),
  'fixed_duration'
);

// --- Display -----------------------------------------------------------------
assert.equal(formatDuration(120), '2:00');
assert.equal(formatDuration(0), '0:00');
assert.equal(formatDuration(9), '0:09');
assert.equal(formatDuration(61), '1:01');
assert.equal(formatDuration(-5), '0:00', 'never renders a negative clock');
assert.equal(formatDuration('nope'), '0:00');

assert.equal(timerStartLabel({ timerMode: 'fixed_duration', timerSeconds: 120 }), 'Start 2:00');
assert.equal(timerStartLabel({ title: 'Tidy toys', timerMode: 'optional_race', timerSeconds: 90 }), 'Race 1:30');
assert.equal(timerStartLabel({ timerMode: 'count_up' }), 'Start timing');
assert.equal(timerStartLabel({}), '', 'no timer, no control');
// A race that degraded for safety must not still advertise itself as a race.
assert.equal(
  timerStartLabel({ title: 'Brush teeth', timerMode: 'optional_race', timerSeconds: 120 }),
  'Start 2:00'
);

// --- Ticking is derived from wall clock, not counted ticks -------------------
const brush = { title: 'Brush teeth', timerMode: 'fixed_duration', timerSeconds: 120 };
const t0 = 1_000_000;
assert.equal(timerState(brush, t0, t0).display, '2:00');
assert.equal(timerState(brush, t0, t0 + 30_000).display, '1:30');
assert.equal(timerState(brush, t0, t0 + 119_000).display, '0:01');
assert.equal(timerState(brush, t0, t0 + 120_000).finished, true);

// The reason it is wall-clock: a phone that sleeps for ten minutes mid-brush
// resumes finished, rather than a timer that silently paused and now lies.
const slept = timerState(brush, t0, t0 + 600_000);
assert.equal(slept.finished, true);
assert.equal(slept.display, '0:00', 'never counts past zero into negatives');

// Count-up has no deadline and never reports finished.
const countUp = { timerMode: 'count_up' };
assert.equal(timerState(countUp, t0, t0 + 65_000).display, '1:05');
assert.equal(timerState(countUp, t0, t0 + 65_000).finished, false);
assert.equal(timerState(countUp, t0, t0 + 3_600_000).finished, false, 'a stopwatch is never "late"');

// --- A timer NEVER gates a reward -------------------------------------------
// fixedDurationSatisfied is a UI cue only. Asserting it here pins the contract
// so a later change cannot quietly turn it into a gate on earning.
assert.equal(fixedDurationSatisfied(brush, t0, t0 + 10_000), false, 'cue says not yet');
assert.equal(fixedDurationSatisfied(brush, t0, t0 + 120_000), true);
assert.equal(fixedDurationSatisfied({}, t0, t0), true, 'a quest with no timer is always satisfied');
assert.equal(
  fixedDurationSatisfied({ title: 'Tidy toys', timerMode: 'optional_race', timerSeconds: 60 }, t0, t0),
  true,
  'an optional race is never unsatisfied — the quest completes with or without it'
);

assert.deepEqual(TIMER_MODES, ['none', 'fixed_duration', 'optional_race', 'count_up']);

console.log('Quest timers: all checks passed.');
