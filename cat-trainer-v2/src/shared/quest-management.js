// Pure parent Quest-management helpers (reduced Quest Slice 3).
//
// Firestore timestamps and writes stay in store.js. This module owns only the
// transformations so duplicate/bulk/reorder behavior is deterministic and can
// be tested without a browser or emulator.

import {
  RECURRENCE_TYPES, TIME_WINDOWS, WEEKDAY_CODES, WINDOW_LABEL,
  questIsArchived, questIsDailyEssential, questRecurrence, questTimeWindow
} from './routines.js?v=fe73a54f';

const byOrder = (a, b) => {
  const ao = Number.isFinite(Number(a && a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
  const bo = Number.isFinite(Number(b && b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
  return ao - bo || String(a && a.id || '').localeCompare(String(b && b.id || ''));
};

export function normalizeQuestRecurrence(value) {
  const input = value && typeof value === 'object' ? value : { type: value };
  const type = input.type;
  if (!RECURRENCE_TYPES.includes(type)) throw new Error('bad-recurrence');
  if (type === 'selected_days') {
    const selected = new Set(Array.isArray(input.days) ? input.days : []);
    const days = WEEKDAY_CODES.filter(day => selected.has(day));
    if (!days.length) throw new Error('recurrence-days-required');
    return { type, days };
  }
  if (type === 'one_time') {
    const date = String(input.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('recurrence-date-required');
    return { type, date };
  }
  return { type };
}

export function recurrenceLabel(quest) {
  const recurrence = questRecurrence(quest);
  if (recurrence.type === 'weekdays') return 'Weekdays';
  if (recurrence.type === 'weekends') return 'Weekends';
  if (recurrence.type === 'selected_days') return (recurrence.days || []).join(' · ') || 'Chosen days';
  if (recurrence.type === 'one_time') return recurrence.date ? `Once · ${recurrence.date}` : 'Once';
  return 'Every day';
}

export function questManagementGroups(quests) {
  const ordered = (quests || []).slice().sort(byOrder);
  const active = ordered.filter(q => !questIsArchived(q));
  const groups = TIME_WINDOWS.map(window => {
    const inWindow = active.filter(q => questTimeWindow(q) === window);
    return {
      window,
      label: WINDOW_LABEL[window] || window,
      quests: inWindow,
      essentialQuests: inWindow.filter(questIsDailyEssential),
      bonusQuests: inWindow.filter(q => !questIsDailyEssential(q))
    };
  }).filter(group => group.quests.length);
  return { groups, archived: ordered.filter(questIsArchived) };
}

// A duplicate starts paused: copying an active responsibility must not make a
// second earning path appear on Sirus's tablet before Mom has reviewed its name
// and schedule. Archive/history/mastery identity never carries to the copy.
export function duplicateQuestData(source, { id, order } = {}) {
  if (!source || !source.id || !id) throw new Error('duplicate-source-required');
  const copy = { ...source };
  for (const key of [
    'id', 'archived', 'archivedAt', 'archivedBy', 'restoredAt', 'restoredBy',
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
    'mastered', 'masteredAt', 'mastery', 'history'
  ]) delete copy[key];
  const recurrence = normalizeQuestRecurrence(questRecurrence(source));
  const window = questTimeWindow(source);
  return {
    ...copy,
    id,
    title: `${source.title || 'Quest'} copy`,
    enabled: false,
    archived: false,
    order: Number.isFinite(Number(order)) ? Number(order) : 0,
    timeWindow: window,
    routineId: window,
    isDailyEssential: questIsDailyEssential(source),
    recurrence,
    duplicatedFromQuestId: source.id
  };
}

export function bulkQuestPatch(action, value) {
  switch (action) {
    case 'pause': return { enabled: false };
    case 'resume': return { enabled: true };
    case 'archive': return { archived: true };
    case 'restore': return { archived: false };
    case 'daypart': {
      if (!TIME_WINDOWS.includes(value)) throw new Error('bad-time-window');
      return { timeWindow: value, routineId: value };
    }
    case 'recurrence': return { recurrence: normalizeQuestRecurrence(value) };
    case 'essential': return { isDailyEssential: !!value };
    default: throw new Error('bad-bulk-action');
  }
}

// Move one quest by one position among peers in the same effective daypart and
// requirement group. Essential and Bonus are deliberately separate parent
// lists, so an arrow must never appear to do nothing by crossing that boundary.
// Re-indexing the full ordered list keeps `order` unique even when different
// dayparts were interleaved in the legacy global order. This is a single-row
// action, not the deliberately-deferred bulk reorder feature.
export function reorderQuestUpdates(quests, questId, direction) {
  if (direction !== 'up' && direction !== 'down') throw new Error('bad-reorder-direction');
  const ordered = (quests || []).slice().sort(byOrder);
  const target = ordered.find(q => q.id === questId);
  if (!target || questIsArchived(target)) return [];
  const peers = ordered.filter(q => !questIsArchived(q)
    && questTimeWindow(q) === questTimeWindow(target)
    && questIsDailyEssential(q) === questIsDailyEssential(target));
  const index = peers.findIndex(q => q.id === questId);
  const neighbor = peers[index + (direction === 'up' ? -1 : 1)];
  if (!neighbor) return [];

  const rearranged = ordered.filter(q => q.id !== questId);
  const neighborIndex = rearranged.findIndex(q => q.id === neighbor.id);
  rearranged.splice(direction === 'up' ? neighborIndex : neighborIndex + 1, 0, target);
  return rearranged
    .map((q, nextOrder) => ({ id: q.id, order: nextOrder, before: q.order }))
    .filter(change => Number(change.before) !== change.order)
    .map(({ id: changeId, order: nextOrder }) => ({ id: changeId, order: nextOrder }));
}
