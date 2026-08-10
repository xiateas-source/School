import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CATEGORY, SCHEMA_VERSION, BEHAVIOR_REASON_CODES,
  classifyTransaction, inferRequestedAmount, normalizeTransaction,
  summarizeDay, amountIntegrity, correctedOriginalIds, isStoredCategory
} from '../src/shared/ledger.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Classification order (§5) ----------------------------------------------
assert.equal(classifyTransaction({ kind: 'quest', reasonCode: 'quest' }), CATEGORY.EARNED);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'good_choice' }), CATEGORY.EARNED);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'hero_reset' }), CATEGORY.EARNED);
assert.equal(classifyTransaction({ kind: 'redeem', reasonCode: 'screen_time' }), CATEGORY.USED);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'rebuttal' }), CATEGORY.ROOM_TO_GROW);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'body_not_words' }), CATEGORY.ROOM_TO_GROW);
assert.equal(classifyTransaction({ kind: 'correction', reasonCode: 'undo' }), CATEGORY.CORRECTION);

// A correction is ALWAYS a correction, even if it looks like screen time or a
// behavior deduction underneath.
assert.equal(classifyTransaction({ kind: 'redeem', reversesTransactionId: 'x' }), CATEGORY.CORRECTION);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'rebuttal', reversesTransactionId: 'x' }), CATEGORY.CORRECTION);

// Custom signed adjustments classify by sign.
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'custom', requestedAmount: 5 }), CATEGORY.EARNED);
assert.equal(classifyTransaction({ kind: 'adjust', reasonCode: 'custom', requestedAmount: -3 }), CATEGORY.ROOM_TO_GROW);

// Unknown legacy never disappears — it becomes Other activity.
assert.equal(classifyTransaction({ kind: 'mystery', reasonCode: 'zzz', amount: 0 }), CATEGORY.OTHER);

assert.ok(BEHAVIOR_REASON_CODES.has('rebuttal'));
assert.ok(BEHAVIOR_REASON_CODES.has('refused_breaths'));
assert.ok(!BEHAVIOR_REASON_CODES.has('good_choice'));
assert.equal(SCHEMA_VERSION, 2);
assert.equal(isStoredCategory(CATEGORY.OTHER), false);
assert.equal(isStoredCategory(CATEGORY.EARNED), true);

// --- requestedAmount inference (§13.2, §13.3) -------------------------------
// A known behavior deduction is the full -2 rule even when the stored floored
// amount was -1 or 0.
assert.equal(inferRequestedAmount({ reasonCode: 'rebuttal', amount: -1 }), -2);
assert.equal(inferRequestedAmount({ reasonCode: 'refused_breaths', amount: 0 }), -2);
// A row that already carries requestedAmount keeps it.
assert.equal(inferRequestedAmount({ reasonCode: 'rebuttal', requestedAmount: -2, amount: 0 }), -2);
// Positive/unknown rows fall back to the stored amount.
assert.equal(inferRequestedAmount({ reasonCode: 'quest', amount: 1 }), 1);
assert.equal(inferRequestedAmount({ reasonCode: 'custom', amount: 3 }), 3);

// --- Amount integrity + zero floor (§10.1, §10.2) ---------------------------
// From 5 available, a -2 leaves 3 and applies the full -2.
assert.deepEqual(amountIntegrity(5, -2), { requestedAmount: -2, amount: -2, balanceBefore: 5, balanceAfter: 3 });
// From 1 available, a -2 leaves 0 but only -1 could be applied.
assert.deepEqual(amountIntegrity(1, -2), { requestedAmount: -2, amount: -1, balanceBefore: 1, balanceAfter: 0 });
// From 0 available, a -2 leaves 0 and applies 0 — never +0 stored as the rule.
assert.deepEqual(amountIntegrity(0, -2), { requestedAmount: -2, amount: 0, balanceBefore: 0, balanceAfter: 0 });
// A +1 credits cleanly.
assert.deepEqual(amountIntegrity(12, 1), { requestedAmount: 1, amount: 1, balanceBefore: 12, balanceAfter: 13 });
// allowNegative lets the balance go below zero when a family opts in.
assert.deepEqual(amountIntegrity(1, -2, { allowNegative: true }), { requestedAmount: -2, amount: -2, balanceBefore: 1, balanceAfter: -1 });

// --- Legacy normalization (§13) ---------------------------------------------
const members = { 'uid-mom': { displayName: 'Mom', role: 'parent' } };
// Legacy row: no activityDate, floored behavior amount, UID actor.
const legacy = normalizeTransaction(
  { id: 't1', kind: 'adjust', reasonCode: 'rebuttal', amount: -1, localDate: '2026-08-08', createdBy: 'uid-mom' },
  { members }
);
assert.equal(legacy.activityDate, '2026-08-08', 'activityDate falls back to localDate');
assert.equal(legacy.requestedAmount, -2, 'legacy behavior amount infers the full -2 rule');
assert.equal(legacy.category, CATEGORY.ROOM_TO_GROW);
assert.equal(legacy.actorName, 'Mom', 'UID resolves through the member map, never a raw UID');

// An unresolved actor becomes a friendly "Parent", never a raw UID.
const orphan = normalizeTransaction({ id: 't2', kind: 'adjust', reasonCode: 'good_choice', amount: 1, createdBy: 'uid-gone' }, { members });
assert.equal(orphan.actorName, 'Parent');

// A v2 row keeps its stored snapshot name and stored category.
const v2 = normalizeTransaction({ id: 't3', schemaVersion: 2, category: 'earned', createdBy: 'uid-mom', createdByName: 'Abba', kind: 'adjust', reasonCode: 'good_choice', requestedAmount: 1, amount: 1, activityDate: '2026-08-09' });
assert.equal(v2.actorName, 'Abba', 'the historical snapshot wins over the live map');
assert.equal(v2.category, CATEGORY.EARNED);

// --- Day summary (§6.3, §8.2) -----------------------------------------------
const day = [
  { id: 'e1', category: CATEGORY.EARNED, requestedAmount: 1, amount: 1 },
  { id: 'e2', category: CATEGORY.EARNED, requestedAmount: 1, amount: 1 },
  { id: 'q1', category: CATEGORY.EARNED, requestedAmount: 1, amount: 1 },
  { id: 'r1', category: CATEGORY.ROOM_TO_GROW, requestedAmount: -2, amount: -1 },
  { id: 'r2', category: CATEGORY.ROOM_TO_GROW, requestedAmount: -2, amount: 0 },
  { id: 'u1', category: CATEGORY.USED, requestedAmount: -8, amount: -8 }
].map(t => normalizeTransaction(t));
const s = summarizeDay(day);
assert.equal(s.earnedCount, 3);
assert.equal(s.earnedPoints, 3, 'earned uses the full rule amount');
assert.equal(s.usedMinutes, 8, 'used counts only screen time actually deducted');
assert.equal(s.roomToGrowCount, 2);
assert.equal(s.roomToGrowPoints, -4, 'room-to-grow shows the full -2 rule even when floored');
assert.equal(s.corrections, 0);

// A correction and its corrected original both drop out of the three growth
// totals but the correction is counted.
const withCorrection = [
  { id: 'orig', category: CATEGORY.EARNED, requestedAmount: 1, amount: 1 },
  { id: 'corr', category: CATEGORY.CORRECTION, requestedAmount: -1, amount: -1, reversesTransactionId: 'orig' }
].map(t => normalizeTransaction(t));
assert.deepEqual([...correctedOriginalIds(withCorrection)], ['orig']);
const cs = summarizeDay(withCorrection);
assert.equal(cs.earnedCount, 0, 'a corrected original does not count');
assert.equal(cs.earnedPoints, 0);
assert.equal(cs.corrections, 1);

// --- Static integration checks (no emulator needed) -------------------------
const store = readFileSync(join(ROOT, 'src/store.js'), 'utf8');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');

assert.match(store, /schemaVersion: SCHEMA_VERSION/, 'writes stamp schema version 2');
assert.match(store, /amountIntegrity\(/, 'writes use the shared amount-integrity builder');
assert.match(store, /createdByName/, 'writes snapshot the member display name');
assert.match(store, /rewardRequested/, 'reward rows record configured effects');
assert.match(store, /rewardApplied/, 'reward rows record actually applied effects');
assert.match(store, /activityDate/, 'writes carry an activity date');
assert.match(store, /over-limit|screen-time-over-limit|exceeds-available/, 'redeem blocks over-limit instead of clamping');

assert.match(rules, /schemaVersion == 2/, 'rules validate the new schema version on create');
assert.match(rules, /allow update: if false/, 'point transactions remain immutable');

assert.match(app, /My Progress/, 'child screen is titled My Progress');
assert.match(app, /summarizeDay\(/, 'the day view uses the shared summary');
assert.match(app, /normalizeTransaction\(/, 'rows are normalized before display');

console.log('Ledger classification, integrity, and day summary: all checks passed.');
