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
