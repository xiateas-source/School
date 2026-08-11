import assert from 'node:assert/strict';
import {
  correctionTransactionId,
  correctionAmountIntegrity,
  reversibleRewardEffects,
  permanentDeleteEligibility,
  hasLinkedCorrection,
  findHeroResetTarget,
  isCorrectionTransaction
} from '../src/shared/corrections.js';

// --- Deterministic correction identity --------------------------------------
assert.equal(correctionTransactionId('abc123'), 'corr_abc123');
assert.equal(correctionTransactionId('legacy/odd'), 'corr_legacy%2Fodd');
assert.throws(() => correctionTransactionId(''), /correction-original-required/);

// --- Correction amount integrity -------------------------------------------
// Reversing a deduction restores only the amount that actually hit the balance.
assert.deepEqual(correctionAmountIntegrity(0, -1), {
  requestedAmount: 1, amount: 1, balanceBefore: 0, balanceAfter: 1
});
// Reversing an already-spent +1 keeps the no-debt floor while preserving intent.
assert.deepEqual(correctionAmountIntegrity(0, 1), {
  requestedAmount: -1, amount: 0, balanceBefore: 0, balanceAfter: 0
});
assert.deepEqual(correctionAmountIntegrity(5, 1), {
  requestedAmount: -1, amount: -1, balanceBefore: 5, balanceAfter: 4
});

// --- Reward reversibility ---------------------------------------------------
assert.deepEqual(reversibleRewardEffects({
  rewardApplied: { brain: 1, energy: 2, bond: 0, coins: 3 }
}), { brain: 1, energy: 2, bond: 0, coins: 3, ambiguousCat: false });

const legacy = reversibleRewardEffects({ catId: 'ember', brain: 2, energy: 1, bond: 1, coins: 4 });
assert.deepEqual(legacy, { brain: 0, energy: 0, bond: 0, coins: 4, ambiguousCat: true });
assert.equal(reversibleRewardEffects({ coins: 2 }).ambiguousCat, false);

// --- Permanent-delete guard -------------------------------------------------
const safeV2 = { id: 'v2', kind: 'adjust', rewardApplied: { brain: 0, energy: 0, bond: 1, coins: 0 } };
assert.deepEqual(permanentDeleteEligibility(safeV2), { ok: true, reason: null });
assert.equal(permanentDeleteEligibility({ id: 'c', kind: 'correction' }).reason, 'correction-history');
assert.equal(permanentDeleteEligibility(safeV2, { hasCorrection: true }).reason, 'already-corrected');
assert.equal(permanentDeleteEligibility({ id: 'old', catId: 'nova', bond: 1 }).reason, 'legacy-cat-effects-unknown');

assert.equal(isCorrectionTransaction({ kind: 'correction' }), true);
assert.equal(isCorrectionTransaction({ reversesTransactionId: 'x' }), true);
assert.equal(isCorrectionTransaction({ kind: 'adjust' }), false);
assert.equal(hasLinkedCorrection([{ id: 'c', reversesTransactionId: 'a' }], 'a'), true);
assert.equal(hasLinkedCorrection([], 'a'), false);

// --- Hero's Reset linking ---------------------------------------------------
const day = '2026-08-10';
const rows = [
  { id: 'old', activityDate: day, category: 'room_to_grow', createdAt: { seconds: 10 } },
  { id: 'new', activityDate: day, category: 'room_to_grow', createdAt: { seconds: 30 } },
  { id: 'corr', activityDate: day, category: 'correction', kind: 'correction', reversesTransactionId: 'new', createdAt: { seconds: 40 } }
];
assert.equal(findHeroResetTarget(rows, day), 'old', 'corrected newest moment is skipped');

const linked = [
  { id: 'a', activityDate: day, category: 'room_to_grow', createdAt: { seconds: 20 } },
  { id: 'b', activityDate: day, category: 'room_to_grow', createdAt: { seconds: 10 } },
  { id: 'reset', activityDate: day, category: 'earned', reasonCode: 'hero_reset', relatedTransactionId: 'a', createdAt: { seconds: 30 } }
];
assert.equal(findHeroResetTarget(linked, day), 'b', 'a moment already linked to a Reset is skipped');
assert.equal(findHeroResetTarget(linked, '2026-08-09'), null, 'Reset never links across days');

console.log('Slice 3 correction safety core: all checks passed.');
