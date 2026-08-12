// The ONE place ledger classification and day-based math live, so the child
// "My Progress" screen and the parent "Point Ledger" can never disagree about
// what a transaction *means* (see MYPROGRESSPOINTLEDGERSPEC2 §5, §6.3, §13).
//
// Two ideas run through this module:
//   • requestedAmount vs amount — the full family rule (e.g. a Rebuttal is -2)
//     is recorded separately from the delta that Available Minutes could
//     actually absorb after the zero floor (which may be -1 or 0). The record
//     of growth must show the full -2 even when the balance can't pay it.
//   • activity date vs posted time — a quest done Aug 8 but approved Aug 9
//     belongs under Aug 8 in the day view; posted time only drives audit order.

import { QUICK_ACTION_BY_CODE } from './rewards.js?v=a604b175';

export const SCHEMA_VERSION = 2;

// Exactly one primary category per effective transaction (§5).
export const CATEGORY = {
  EARNED: 'earned',
  USED: 'used',
  ROOM_TO_GROW: 'room_to_grow',
  CORRECTION: 'correction',
  // Not a stored category: only an unknown legacy row normalizes to this so it
  // never silently disappears from the parent ledger (§5.5).
  OTHER: 'other'
};

const STORED_CATEGORIES = new Set([
  CATEGORY.EARNED, CATEGORY.USED, CATEGORY.ROOM_TO_GROW, CATEGORY.CORRECTION
]);

export function isStoredCategory(value) {
  return STORED_CATEGORIES.has(value);
}

// Reason codes whose family rule is a negative behavior deduction. Derived from
// the shared reward table (the single source of the -2 rule) so this list can
// never drift from the presets Mom actually taps.
export const BEHAVIOR_REASON_CODES = new Set(
  Object.values(QUICK_ACTION_BY_CODE)
    .filter(a => a.tone === 'negative')
    .map(a => a.code)
);

// Screen-time redemption reason codes (legacy + current).
export const REDEEM_REASON_CODES = new Set(['screen_time', 'redeem']);

// Correction/undo reason codes.
export const CORRECTION_REASON_CODES = new Set(['undo', 'correction']);

// The full signed rule amount for a known preset, or null if not a preset.
export function ruleAmount(reasonCode) {
  const preset = reasonCode ? QUICK_ACTION_BY_CODE[reasonCode] : null;
  return preset ? preset.amount : null;
}

// The full intended amount for a row. New rows carry requestedAmount directly;
// legacy rows infer it from the shared preset rule — a known behavior deduction
// is always the full -2 even when the stored (floored) amount is -1 or 0
// (§13.2). Only rows with no preset rule fall back to the stored amount, when
// the intent can't otherwise be inferred (§13.3).
export function inferRequestedAmount(txn) {
  if (typeof txn.requestedAmount === 'number') return txn.requestedAmount;
  const rule = ruleAmount(txn.reasonCode);
  if (rule != null) return rule;
  return Number(txn.amount) || 0;
}

function isCorrection(txn) {
  return txn.kind === 'correction'
    || CORRECTION_REASON_CODES.has(txn.reasonCode)
    || !!txn.reversesTransactionId;
}

// Normalize any transaction (v2 or legacy) into exactly one category, in the
// order the spec fixes so the result is deterministic (§5):
//   1 correction  2 screen-time  3 known negative behavior  4 active positive
//   5 otherwise Other activity (unknown legacy — never dropped).
export function classifyTransaction(txn) {
  if (isCorrection(txn)) return CATEGORY.CORRECTION;
  if (txn.kind === 'redeem' || REDEEM_REASON_CODES.has(txn.reasonCode)) return CATEGORY.USED;
  if (BEHAVIOR_REASON_CODES.has(txn.reasonCode)) return CATEGORY.ROOM_TO_GROW;
  if (txn.kind === 'quest') return CATEGORY.EARNED;
  if (txn.kind === 'adjust' || txn.kind == null) {
    const amount = inferRequestedAmount(txn);
    if (amount < 0) return CATEGORY.ROOM_TO_GROW; // custom behavior deduction
    if (amount > 0) return CATEGORY.EARNED;
  }
  return CATEGORY.OTHER;
}

// A read-time view that fills the new fields for legacy rows without mutating
// the stored document (§13). A trusted stored category is kept; otherwise the
// row is classified. Actor name resolves from the historical snapshot, then the
// live member map, and never exposes a raw UID (§13.8).
export function normalizeTransaction(txn, { members = {} } = {}) {
  const activityDate = txn.activityDate || txn.localDate || null;
  const requestedAmount = inferRequestedAmount(txn);
  const category = isStoredCategory(txn.category)
    ? txn.category
    : classifyTransaction({ ...txn, requestedAmount });
  const member = txn.createdBy ? members[txn.createdBy] : null;
  const actorName = txn.createdByName || (member && member.displayName) || 'Parent';
  return { ...txn, activityDate, requestedAmount, category, actorName };
}

// Set of original ids that a same-set correction reverses, so a corrected
// original and its correction can both be excluded from category totals.
export function correctedOriginalIds(normalizedTxns) {
  const ids = new Set();
  for (const t of normalizedTxns) {
    if (t.reversesTransactionId) ids.add(t.reversesTransactionId);
  }
  return ids;
}

// Independent daily totals for a set of transactions already normalized and
// filtered to one activity date. Earned/Room-to-Grow use the full rule amount
// (requestedAmount); Used counts the minutes actually deducted. Corrections and
// any corrected original are excluded from the three growth totals (§6.3, §8.2,
// acceptance "Corrected entries do not affect daily category totals").
export function summarizeDay(normalizedTxns) {
  const corrected = correctedOriginalIds(normalizedTxns);
  let earnedCount = 0, earnedPoints = 0;
  let usedMinutes = 0;
  let roomToGrowCount = 0, roomToGrowPoints = 0;
  let corrections = 0;
  for (const t of normalizedTxns) {
    if (t.category === CATEGORY.CORRECTION) { corrections++; continue; }
    if (corrected.has(t.id)) continue;
    if (t.category === CATEGORY.EARNED) {
      earnedCount++; earnedPoints += t.requestedAmount;
    } else if (t.category === CATEGORY.USED) {
      usedMinutes += Math.abs(Number(t.amount) || 0);
    } else if (t.category === CATEGORY.ROOM_TO_GROW) {
      roomToGrowCount++; roomToGrowPoints += t.requestedAmount;
    }
  }
  return {
    earnedCount, earnedPoints,
    usedMinutes,
    roomToGrowCount, roomToGrowPoints,
    corrections
  };
}

// Weekly reflection uses the same correction-aware math as the day view, then
// adds only the pattern fields named by §14. It never calculates a grade,
// positive percentage, best/worst day, streak, or comparison score.
export function summarizeWeek(normalizedTxns) {
  const totals = summarizeDay(normalizedTxns);
  const corrected = correctedOriginalIds(normalizedTxns);
  let heroResets = 0;
  let linkedRecoveries = 0;
  const behaviorCounts = new Map();

  for (const t of normalizedTxns) {
    if (t.category === CATEGORY.CORRECTION || corrected.has(t.id)) continue;
    if (t.category === CATEGORY.EARNED && t.reasonCode === 'hero_reset') {
      heroResets++;
      if (t.relatedTransactionId) linkedRecoveries++;
    }
    if (t.category === CATEGORY.ROOM_TO_GROW) {
      const label = t.reasonLabel || QUICK_ACTION_BY_CODE[t.reasonCode]?.label || 'Other Room to Grow';
      behaviorCounts.set(label, (behaviorCounts.get(label) || 0) + 1);
    }
  }

  const behaviors = [...behaviorCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { ...totals, heroResets, linkedRecoveries, behaviors };
}

// Amount-integrity fields for a new write. Given the balance before and the
// full intended signed delta, compute the delta Available Minutes can actually
// absorb under the zero floor (unless negative balances are allowed). This is
// what keeps a -2 rule from ever being *stored* as -1 or +0 (§10.1, §10.2).
export function amountIntegrity(before, requestedDelta, { allowNegative = false } = {}) {
  const raw = before + requestedDelta;
  const after = allowNegative ? raw : Math.max(0, raw);
  return {
    requestedAmount: requestedDelta,
    amount: after - before,
    balanceBefore: before,
    balanceAfter: after
  };
}
