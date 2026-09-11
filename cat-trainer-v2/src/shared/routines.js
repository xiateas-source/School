// Pure routine / time-of-day logic for the child Quest view (Quest Slice 1).
//
// READ-TIME ONLY. Legacy quests carry `section` + `order` but none of the
// QUEST-TAB-SPEC §18 routine fields (`timeWindow`, `isDailyEssential`,
// `dependsOnQuestIds`, …). Every accessor here DEFAULTS from the legacy shape
// without mutating or writing anything — the migration stays reversible until
// the new routine organization is device-tested (decision: read-time defaults,
// no backfill write in Slice 1).
//
// Keeping this pure (no DOM, no Firebase) means the Now/Next/Later organization,
// dependency eligibility, and "minutes available to earn" math are unit-testable
// without an emulator, and the child screen and any later parent view can never
// disagree about them.

import { FAMILY_TIMEZONE, weekday } from './dates.js?v=a6cb40f2';

// Day-phase windows, in chronological order. 'anytime' is intentionally NOT a
// day phase — it's a flexible bucket shown alongside Now/Next/Later (§6).
export const DAY_PHASES = ['morning', 'school', 'evening', 'night'];
export const TIME_WINDOWS = [...DAY_PHASES, 'anytime'];

export const WINDOW_LABEL = {
  morning: 'Morning', school: 'School', evening: 'Evening', night: 'Night', anytime: 'Anytime'
};
export const WINDOW_GLYPH = {
  morning: '☀', school: '🧠', evening: '🌆', night: '☾', anytime: '⭐'
};

// Legacy section → default time window (read-time default for §18 `timeWindow`).
const SECTION_WINDOW = {
  Morning: 'morning', Brain: 'school', Move: 'anytime',
  Tidy: 'anytime', Night: 'night', General: 'anytime'
};

// Sections whose quests are Daily Essentials by default (read-time default for
// §18 `isDailyEssential`). Move + General default to optional; Brain keeps the
// required-reading path as essential (b-read split — required reading stays a
// Quest, the optional "read something you choose" version becomes an Activity).
const ESSENTIAL_SECTIONS = new Set(['Morning', 'Tidy', 'Night', 'Brain']);

// Legacy items explicitly classified for eventual Activities migration
// (§18.1 + family decision). They stay LIVE as optional, non-essential Quests
// until Activities Slice 1 provides their replacement — do not disable/delete a
// current earning path early — but they must never be treated as routine
// responsibilities and must not be forgotten during Activities implementation.
// This is a read-time label, NOT persisted schema yet.
const ACTIVITIES_PENDING_IDS = new Set(['v-move']);

// 'quest' → a real responsibility that stays in Quest.
// 'activities_pending' → classified to move to Activities later (§18.1); kept
// live and non-essential for now so it isn't forgotten.
export function migrationDisposition(quest) {
  const explicit = quest && quest.migrationDisposition;
  if (explicit === 'quest' || explicit === 'activities_pending') return explicit;
  return quest && ACTIVITIES_PENDING_IDS.has(quest.id) ? 'activities_pending' : 'quest';
}

export function questTimeWindow(quest) {
  if (quest && TIME_WINDOWS.includes(quest.timeWindow)) return quest.timeWindow;
  return SECTION_WINDOW[quest && quest.section] || 'anytime';
}

export function questIsDailyEssential(quest) {
  if (quest && typeof quest.isDailyEssential === 'boolean') return quest.isDailyEssential;
  // Items pending Activities migration are never routine responsibilities.
  if (migrationDisposition(quest) === 'activities_pending') return false;
  return !!(quest && ESSENTIAL_SECTIONS.has(quest.section));
}

// Archive is a lifecycle state of its own. It must never be inferred from
// `enabled`: a paused quest is still part of the reusable routine, while an
// archived quest is retained only for recovery/history and is excluded from
// every daily plan. Legacy quests have no field and remain unarchived.
export function questIsArchived(quest) {
  return !!(quest && quest.archived === true);
}

export function questIsAvailable(quest) {
  return !!quest && quest.enabled !== false && !questIsArchived(quest);
}

export function questDependsOn(quest) {
  return quest && Array.isArray(quest.dependsOnQuestIds) ? quest.dependsOnQuestIds : [];
}

// --- Recurrence (Slice 2) ----------------------------------------------------
// Legacy quests carry no recurrence and default to everyday, preserving the
// accepted Slice 1 behavior (every enabled quest shows every day). Explicit
// recurrence is written on edit/create (write-on-edit, no bulk backfill).
export const RECURRENCE_TYPES = ['everyday', 'weekdays', 'weekends', 'selected_days', 'one_time'];
// Index-aligned with dates.weekday() (0 = Sunday … 6 = Saturday).
export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function questRecurrence(quest) {
  const r = quest && quest.recurrence;
  if (r && RECURRENCE_TYPES.includes(r.type)) return r;
  return { type: 'everyday' };
}

// Is this quest scheduled on the given calendar date ('YYYY-MM-DD')?
export function isScheduledOn(quest, ymd, wd = weekday(ymd)) {
  const r = questRecurrence(quest);
  switch (r.type) {
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekends': return wd === 0 || wd === 6;
    case 'selected_days': return Array.isArray(r.days) && r.days.includes(WEEKDAY_CODES[wd]);
    case 'one_time': return r.date === ymd;
    case 'everyday':
    default: return true;
  }
}

// --- Effective day plan (recurrence + today-only overrides) -------------------
// The single place the child view and the parent Today view agree on "what is on
// for this exact day". Pure: `overrides` is a map questId → { action, window? }
// supplied by the caller (Slice 2c persists them as questDayOverrides). Returns
// shallow copies when a window is overridden so organizeDay sees the effective
// window without mutating the stored quest. Legacy quests with no recurrence and
// no overrides pass through unchanged, so accepted Slice 1 UX is preserved.
export function planDay(quests, { ymd, overrides = {} } = {}) {
  const wd = ymd ? weekday(ymd) : null;
  const out = [];
  for (const q of quests) {
    if (ymd && !isScheduledOn(q, ymd, wd)) continue;      // recurrence filter
    const ov = overrides[q.id];
    if (ov && ov.action === 'skip') continue;             // hidden for today only
    if (ov && ov.action === 'move' && ov.window) { out.push({ ...q, timeWindow: ov.window, movedToday: true }); continue; }
    if (ov && ov.action === 'next') { out.push({ ...q, nextToday: true }); continue; }
    out.push(q);
  }
  // "Make next": stable-bump flagged quests to the front so they lead their
  // window in organizeDay (modern engines' Array.sort is stable).
  out.sort((a, b) => (b.nextToday ? 1 : 0) - (a.nextToday ? 1 : 0));
  return out;
}

// --- Today-only exception helpers (Slice 2c) ---------------------------------
// The window a "Move to later" (§17.5) sends a quest to on the current day:
// strictly later than BOTH the quest's own window and the current daypart, so a
// deferral can never land in a slot that has already passed. 'anytime' is the
// flexible fallback once there is no later daypart; null means there is no
// genuinely-later slot (an 'anytime' quest is already the most flexible), so the
// caller can omit the action instead of writing a misleading no-op.
export function laterWindowFor(currentWindow, phase) {
  const winIdx = DAY_PHASES.indexOf(currentWindow); // -1 for 'anytime'
  if (winIdx === -1) return null;
  const refIdx = Math.max(winIdx, DAY_PHASES.indexOf(phase));
  return refIdx < DAY_PHASES.length - 1 ? DAY_PHASES[refIdx + 1] : 'anytime';
}

// "Today Is Different" presets (§17.6). Which of `quests` a one-day preset applies
// to on `ymd`. Pure, so the store's batch write and the tests agree on one rule.
// Only quests actually SCHEDULED for `ymd` are eligible — recurrence (weekday /
// weekend / one-time) never leaks a not-due quest into a one-day exception.
// 'custom' and any unknown preset target nothing (the parent uses per-quest
// controls); the store validates the preset name separately.
export const TODAY_PRESETS = ['sick', 'out', 'school_off', 'easy_morning', 'custom'];
export function presetTargets(quests, preset, ymd) {
  const scheduled = (quests || []).filter(q => questIsAvailable(q) && isScheduledOn(q, ymd));
  switch (preset) {
    case 'sick':
    case 'out':          return scheduled;
    case 'school_off':   return scheduled.filter(q => questTimeWindow(q) === 'school');
    case 'easy_morning': return scheduled.filter(q => questTimeWindow(q) === 'morning' && !questIsDailyEssential(q));
    default:             return [];
  }
}

// --- Time of day ------------------------------------------------------------
// The active day phase for a local hour (0-23). Bedtime/night wraps past
// midnight so a late-evening or after-midnight view still reads 'night'.
// Boundaries follow Sirus's actual weekday schedule (Journal repo,
// current/weekday-schedule.md), not generic guesses: family start at 5:00,
// school opening 7:30 with the first academic block at 8:45, and formal
// dismissal at 3:30 p.m. after which routine academics never resume.
//
// The previous 11:00 start meant the whole 8:45-11:00 stretch of real
// schoolwork — Math C and Language Arts D — showed as 'Next' rather than
// 'Now', and the 15:00 end dropped unfinished lessons out of the board half an
// hour before he is actually dismissed. School is expressed in half hours, so
// this returns on minutes rather than whole hours.
export function phaseForHour(hour, minute = 0) {
  const h = Number(hour);
  const m = Number.isFinite(Number(minute)) ? Number(minute) : 0;
  if (!Number.isFinite(h) || h < 5 || h >= 20) return 'night';
  if (h < 8) return 'morning';
  if (h < 15 || (h === 15 && m < 30)) return 'school';
  return 'evening';
}

// DOM convenience: current phase in the family timezone. Kept here so the render
// layer never has to repeat the Intl dance or import the timezone itself.
export function phaseNow(date = new Date(), timeZone = FAMILY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(date);
  const get = type => Number(parts.find(x => x.type === type)?.value);
  const hour = get('hour');
  return phaseForHour(hour % 24, get('minute') || 0); // some engines format midnight as "24"
}

// --- Eligibility / Routine Mode ---------------------------------------------
function asSet(ids) {
  return ids instanceof Set ? ids : new Set(ids || []);
}

// A quest is pickable right now when it is unfinished and every dependency is
// already done today (§7.2). Finished = it has any completion (pending counts —
// it's waiting for Mom, not actionable again).
export function isEligible(quest, completedIds) {
  const done = asSet(completedIds);
  if (done.has(quest.id)) return false;
  return questDependsOn(quest).every(depId => done.has(depId));
}

// Up to `limit` eligible missions for "Pick your next mission" (§7). Preserves
// the caller's order (caller pre-sorts by `order`). Default 4 (spec 2-4).
export function nextMissions(quests, completedIds, limit = 4) {
  const done = asSet(completedIds);
  return quests.filter(q => isEligible(q, done)).slice(0, Math.max(0, limit));
}

// --- Progress framed as opportunity (§3, §15) -------------------------------
// Only unfinished quests' points count, and it is described as "available to
// earn", never as lost.
export function minutesAvailable(quests, completedIds) {
  const done = asSet(completedIds);
  return quests.reduce((sum, q) => sum + (done.has(q.id) ? 0 : Math.max(0, Number(q.points) || 0)), 0);
}

export function progressCounts(quests, completedIds) {
  const done = asSet(completedIds);
  const complete = quests.filter(q => done.has(q.id)).length;
  return { total: quests.length, complete, left: quests.length - complete };
}

// --- Now / Next / Later / Anytime organization (§6) -------------------------
// Pure: completion is passed in as `completedIds`; the DOM layer supplies it.
// Returns the current phase group (now), the nearest future group with quests
// (next), remaining future groups (later), the flexible anytime bucket, and any
// past-phase windows still holding unfinished quests (stillNeedsDoing, §10.1).
export function organizeDay(quests, { phase, completedIds } = {}) {
  const done = asSet(completedIds);
  const currentPhase = DAY_PHASES.includes(phase) ? phase : 'morning';
  const currentIdx = DAY_PHASES.indexOf(currentPhase);

  const byWindow = new Map(TIME_WINDOWS.map(w => [w, []]));
  for (const q of quests) byWindow.get(questTimeWindow(q)).push(q);

  const dayGroups = DAY_PHASES
    .map(w => ({ window: w, idx: DAY_PHASES.indexOf(w), quests: byWindow.get(w) }))
    .filter(g => g.quests.length);

  let now = null;
  const future = [];
  const past = [];
  for (const g of dayGroups) {
    if (g.idx === currentIdx) now = g;
    else if (g.idx > currentIdx) future.push(g);
    else past.push(g);
  }
  // A future window is never pulled forward: if the current phase has no quests,
  // Now stays empty and the upcoming work remains NEXT/LATER until its own window
  // actually begins. Anytime is available independently of all of this.
  const next = future.length ? future[0] : null;
  const later = future.slice(1);
  const stillNeedsDoing = past.filter(g => g.quests.some(q => !done.has(q.id)));

  return { currentPhase, now, next, later, anytime: byWindow.get('anytime'), stillNeedsDoing };
}

// Minimal read-only bridge for Activities (§26.1). It deliberately derives from
// the same planDay()/organizeDay() contract as both Quest screens: no second
// recurrence engine, no writes, and no lock. Future routine quests are counted
// but never pulled forward into First/Then before their daypart.
export function routineCue(quests, { ymd, overrides = {}, phase, completedIds = [] } = {}) {
  const done = asSet(completedIds);
  const planned = planDay((quests || []).filter(questIsAvailable), { ymd, overrides });
  const day = organizeDay(planned, { phase, completedIds: done });
  const remainingEssentials = planned.filter(q => questIsDailyEssential(q) && !done.has(q.id));

  // Keep First/Then inside one small routine cohort. Do not jump from an
  // unfinished Morning sequence to an unrelated Anytime tidy in the same cue.
  let candidates = day.now
    ? day.now.quests.filter(q => questIsDailyEssential(q) && !done.has(q.id))
    : [];
  if (!candidates.length) {
    const past = day.stillNeedsDoing
      .map(group => group.quests.filter(q => questIsDailyEssential(q) && !done.has(q.id)))
      .find(group => group.length);
    candidates = past || [];
  }
  if (!candidates.length) {
    candidates = day.anytime.filter(q => questIsDailyEssential(q) && !done.has(q.id));
  }

  const [first, then] = nextMissions(candidates, done, 2);
  const cueWindow = first ? questTimeWindow(first) : day.currentPhase;
  const item = q => q ? { questId: q.id, label: q.title || 'Quest' } : null;
  return {
    routineId: cueWindow,
    routineLabel: WINDOW_LABEL[cueWindow] || cueWindow,
    remainingEssentialCount: remainingEssentials.length,
    first: item(first),
    then: item(then),
    blocking: false
  };
}
