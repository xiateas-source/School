// Per-Quest timers (QUEST-TAB-SPEC §11). Pure logic only — no DOM, no Firebase —
// so the safety rules below are unit-testable rather than living in render code.
//
// A timer is a TOOL attached to one Quest, never a global expectation and never
// a deadline. Nothing here changes a reward: a Quest's points are identical
// whether its timer was used, ignored, or never finished. That is the whole
// design, and it is why none of these functions return anything about earning.

export const TIMER_MODES = ['none', 'fixed_duration', 'optional_race', 'count_up'];

export const TIMER_MODE_LABEL = {
  none: 'No timer',
  fixed_duration: 'Keep going for a set time',
  optional_race: 'Beat the clock (optional)',
  count_up: 'Time how long it takes'
};

// The toothbrush timer is a fixed 2:00 (§11.3, Q-07).
export const BRUSH_SECONDS = 120;
export const DEFAULT_TIMER_SECONDS = BRUSH_SECONDS;
// A sane band for a child-facing timer: long enough to be worth starting,
// short enough that nobody is staring at a phone for an hour.
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 30 * 60;

export function questTimerMode(quest) {
  const m = quest && quest.timerMode;
  return TIMER_MODES.includes(m) ? m : 'none';
}

export function questTimerSeconds(quest) {
  const n = Number(quest && quest.timerSeconds);
  if (!Number.isFinite(n)) return DEFAULT_TIMER_SECONDS;
  return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, Math.round(n)));
}

// --- Racing safety (§11.2) --------------------------------------------------
// "Never reward rushing where speed reduces quality/safety. No beat-the-clock
// for toothbrushing, eating, accuracy schoolwork, hot/sharp/heavy tasks, or
// anything Mom/Abba mark unsafe to rush."
//
// Three of those are decidable from data we already hold, so they are enforced
// here rather than left to whoever fills in the form:
//
//   * School-daypart quests are accuracy schoolwork by definition. Sirus's
//     course list lives in that window, and racing a maths lesson is exactly
//     the harm this rule exists to prevent.
//   * Title matching catches brushing and eating wherever they are filed —
//     these are the named examples, and the morning/night routines are full of
//     them.
//   * An explicit `unsafeToRush` flag is always honoured, which is the
//     "anything Mom/Abba mark" clause.
//
// Everything else stays the parent's call. This never blocks a FIXED-duration
// timer — a 2:00 brush timer is the opposite of rushing.
const NO_RACE_TITLE = /\b(brush|teeth|tooth|eat|eating|breakfast|lunch|dinner|snack|meal|knife|stove|oven|iron)\b/i;

export function raceSafetyBlock(quest) {
  if (!quest) return null;
  if (quest.unsafeToRush === true) {
    return 'This quest is marked unsafe to rush.';
  }
  if ((quest.timeWindow || '') === 'school') {
    return 'School work is accuracy work — racing it trades correctness for speed.';
  }
  if (NO_RACE_TITLE.test(quest.title || '')) {
    return 'Brushing, eating and anything hot or sharp should never be raced.';
  }
  return null;
}

export function canRace(quest) {
  return raceSafetyBlock(quest) === null;
}

// The mode a quest should actually run, after safety. A stored optional_race on
// a quest that must not be raced degrades to a fixed-duration timer rather than
// disappearing: the parent asked for a timer, and the safe kind still helps.
export function effectiveTimerMode(quest) {
  const mode = questTimerMode(quest);
  if (mode === 'optional_race' && !canRace(quest)) return 'fixed_duration';
  return mode;
}

export function hasTimer(quest) {
  return effectiveTimerMode(quest) !== 'none';
}

// --- Display ----------------------------------------------------------------
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// What the child's timer control should say before it is started.
export function timerStartLabel(quest) {
  const mode = effectiveTimerMode(quest);
  if (mode === 'count_up') return 'Start timing';
  if (mode === 'optional_race') return `Race ${formatDuration(questTimerSeconds(quest))}`;
  if (mode === 'fixed_duration') return `Start ${formatDuration(questTimerSeconds(quest))}`;
  return '';
}

// --- Tick -------------------------------------------------------------------
// One pure step, so the running display is derived from wall-clock elapsed time
// rather than counted ticks. A phone that sleeps mid-brush, or a tab that gets
// throttled in the background, then resumes with the correct remaining time
// instead of a timer that silently paused.
//
// Returns { elapsed, remaining, finished, display }.
export function timerState(quest, startedAtMs, nowMs) {
  const mode = effectiveTimerMode(quest);
  const total = questTimerSeconds(quest);
  const elapsed = Math.max(0, (Number(nowMs) - Number(startedAtMs)) / 1000);

  if (mode === 'count_up') {
    return { elapsed, remaining: null, finished: false, display: formatDuration(elapsed) };
  }
  const remaining = Math.max(0, total - elapsed);
  return {
    elapsed,
    remaining,
    finished: remaining <= 0,
    display: formatDuration(remaining)
  };
}

// Did a fixed-duration timer actually run its course? Completion for a
// fixed-duration quest is the FULL duration (§11.3) — but this is a cue for the
// UI, never a gate on the reward. A quest is still completable without it, and
// nothing here may be used to withhold points.
export function fixedDurationSatisfied(quest, startedAtMs, nowMs) {
  if (effectiveTimerMode(quest) !== 'fixed_duration') return true;
  return timerState(quest, startedAtMs, nowMs).finished;
}
