// Local-day logic for the family's timezone. The legacy app used UTC
// (toISOString), which rolled the "day" over at ~6-7pm Chicago. This fixes it to
// a true America/Chicago calendar day so quests reset at local midnight.

export const FAMILY_TIMEZONE = 'America/Chicago';

// Returns the current local calendar date as 'YYYY-MM-DD' in the family timezone.
export function localDate(date = new Date(), timeZone = FAMILY_TIMEZONE) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// Short local time label, e.g. "7:45 AM", for ledger rows.
export function localTimeLabel(date = new Date(), timeZone = FAMILY_TIMEZONE) {
  return new Intl.DateTimeFormat([], {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

// --- Calendar-date arithmetic for the day navigator --------------------------
// A 'YYYY-MM-DD' string is a pure calendar date. We anchor it at UTC noon so
// adding/subtracting days can never be knocked onto the wrong day by a DST jump,
// then read the calendar fields back out in UTC. All of these are timezone-
// independent string→string helpers (the family-timezone "today" comes from
// localDate above and feeds in as the starting string).
function ymdToNoonUTC(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

function ymdFromUTC(ms) {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Shift a calendar date by n days (n may be negative).
export function addDays(ymd, n) {
  return ymdFromUTC(ymdToNoonUTC(ymd) + n * 86400000);
}

// Day of week for a calendar date, 0 = Sunday … 6 = Saturday.
export function weekday(ymd) {
  return new Date(ymdToNoonUTC(ymd)).getUTCDay();
}

// The Sunday on or before a calendar date — the start of its 7-day strip.
export function startOfWeek(ymd) {
  return addDays(ymd, -weekday(ymd));
}

// The seven calendar dates of the week that starts at the given Sunday.
export function weekDates(weekStartYmd) {
  const start = startOfWeek(weekStartYmd);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// True when `ymd` is strictly after `otherYmd` (used to disable future days).
export function isAfterDate(ymd, otherYmd) {
  return ymd > otherYmd; // ISO 'YYYY-MM-DD' sorts lexicographically as dates
}

// Same calendar week (Sunday-based) as another date?
export function sameWeek(ymd, otherYmd) {
  return startOfWeek(ymd) === startOfWeek(otherYmd);
}

// Human labels built from the calendar date (read back in UTC, matching how the
// string was anchored). Locale-driven so month/weekday names localize.
export function longDateLabel(ymd) {
  return new Date(ymdToNoonUTC(ymd)).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

export function shortWeekday(ymd) {
  return new Date(ymdToNoonUTC(ymd)).toLocaleDateString(undefined, {
    weekday: 'short', timeZone: 'UTC'
  });
}

export function dayOfMonth(ymd) {
  return new Date(ymdToNoonUTC(ymd)).getUTCDate();
}
