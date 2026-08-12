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

import { FAMILY_TIMEZONE, weekday } from './dates.js?v=2fa8bc91';

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

// --- Time of day ------------------------------------------------------------
// The active day phase for a local hour (0-23). Bedtime/night wraps past
// midnight so a late-evening or after-midnight view still reads 'night'.
export function phaseForHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h) || h < 5 || h >= 20) return 'night';
  if (h < 11) return 'morning';
  if (h < 15) return 'school';
  return 'evening';
}

// DOM convenience: current phase in the family timezone. Kept here so the render
// layer never has to repeat the Intl dance or import the timezone itself.
export function phaseNow(date = new Date(), timeZone = FAMILY_TIMEZONE) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date));
  return phaseForHour(hour % 24); // some engines format midnight as "24"
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
