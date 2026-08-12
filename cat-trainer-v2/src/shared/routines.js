// Pure routine / time-of-day logic for the child Quest view (Quest Slice 1).
//
// Legacy quests carry `section` + `order` but none of the QUEST-TAB-SPEC §18
// routine fields. Accessors default from the legacy shape without mutating it;
// Slice 2 persists explicit values only when a parent edits/creates a Quest.

import { FAMILY_TIMEZONE, weekday } from './dates.js?v=ea220299';

export const DAY_PHASES = ['morning', 'school', 'evening', 'night'];
export const TIME_WINDOWS = [...DAY_PHASES, 'anytime'];

export const WINDOW_LABEL = {
  morning: 'Morning', school: 'School', evening: 'Evening', night: 'Night', anytime: 'Anytime'
};
export const WINDOW_GLYPH = {
  morning: '☀', school: '🧠', evening: '🌆', night: '☾', anytime: '⭐'
};

const SECTION_WINDOW = {
  Morning: 'morning', Brain: 'school', Move: 'anytime',
  Tidy: 'anytime', Night: 'night', General: 'anytime'
};
const ESSENTIAL_SECTIONS = new Set(['Morning', 'Tidy', 'Night', 'Brain']);
const ACTIVITIES_PENDING_IDS = new Set(['v-move']);

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
  if (migrationDisposition(quest) === 'activities_pending') return false;
  return !!(quest && ESSENTIAL_SECTIONS.has(quest.section));
}

export function questDependsOn(quest) {
  return quest && Array.isArray(quest.dependsOnQuestIds) ? quest.dependsOnQuestIds : [];
}

// --- Recurrence (Slice 2) ----------------------------------------------------
export const RECURRENCE_TYPES = ['everyday', 'weekdays', 'weekends', 'selected_days', 'one_time'];
export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function questRecurrence(quest) {
  const r = quest && quest.recurrence;
  if (r && RECURRENCE_TYPES.includes(r.type)) return r;
  return { type: 'everyday' };
}

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

// Runtime bridge for Slice 2's independently subscribed day-override stream.
// Explicit overrides supplied by tests/callers always win. The existing child
// renderer currently passes an empty object placeholder; this shared module
// fallback lets the parent-written Firestore override immediately affect that
// same planner without duplicating child rendering logic.
let runtimeDayOverrides = null;
export function setRuntimeDayOverrides(map) {
  runtimeDayOverrides = map && typeof map === 'object' ? map : {};
}

// --- Effective day plan (recurrence + today-only overrides) -------------------
export function planDay(quests, { ymd, overrides = {} } = {}) {
  const explicit = overrides && Object.keys(overrides).length > 0;
  const effectiveOverrides = explicit ? overrides : (runtimeDayOverrides ?? overrides ?? {});
  const wd = ymd ? weekday(ymd) : null;
  const out = [];
  for (const q of quests) {
    if (ymd && !isScheduledOn(q, ymd, wd)) continue;
    const ov = effectiveOverrides[q.id];
    if (ov && ov.action === 'skip') continue;
    if (ov && ov.action === 'move' && ov.window) {
      out.push({ ...q, timeWindow: ov.window, movedToday: true });
      continue;
    }
    if (ov && ov.action === 'next') {
      out.push({ ...q, ...(ov.window ? { timeWindow: ov.window } : {}), nextToday: true });
      continue;
    }
    out.push(q);
  }
  out.sort((a, b) => (b.nextToday ? 1 : 0) - (a.nextToday ? 1 : 0));
  return out;
}

// --- Time of day ------------------------------------------------------------
export function phaseForHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h) || h < 5 || h >= 20) return 'night';
  if (h < 11) return 'morning';
  if (h < 15) return 'school';
  return 'evening';
}

export function phaseNow(date = new Date(), timeZone = FAMILY_TIMEZONE) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date));
  return phaseForHour(hour % 24);
}

// --- Eligibility / Routine Mode ---------------------------------------------
function asSet(ids) {
  return ids instanceof Set ? ids : new Set(ids || []);
}

export function isEligible(quest, completedIds) {
  const done = asSet(completedIds);
  if (done.has(quest.id)) return false;
  return questDependsOn(quest).every(depId => done.has(depId));
}

export function nextMissions(quests, completedIds, limit = 4) {
  const done = asSet(completedIds);
  return quests.filter(q => isEligible(q, done)).slice(0, Math.max(0, limit));
}

// --- Progress framed as opportunity -----------------------------------------
export function minutesAvailable(quests, completedIds) {
  const done = asSet(completedIds);
  return quests.reduce((sum, q) => sum + (done.has(q.id) ? 0 : Math.max(0, Number(q.points) || 0)), 0);
}

export function progressCounts(quests, completedIds) {
  const done = asSet(completedIds);
  const complete = quests.filter(q => done.has(q.id)).length;
  return { total: quests.length, complete, left: quests.length - complete };
}

// --- Now / Next / Later / Anytime organization ------------------------------
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
  // Future windows never get pulled forward merely because the current window
  // is empty. Anytime remains available independently.
  const next = future.length ? future[0] : null;
  const later = future.slice(1);
  const stillNeedsDoing = past.filter(g => g.quests.some(q => !done.has(q.id)));

  return { currentPhase, now, next, later, anytime: byWindow.get('anytime'), stillNeedsDoing };
}
