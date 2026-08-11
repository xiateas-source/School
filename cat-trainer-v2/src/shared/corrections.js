// Pure helpers for My Progress Slice 3 corrections.
//
// Ordinary mistakes are append-only: one deterministic correction reverses one
// original entry while the original remains visible. A separate rare parent
// cleanup delete is only for true test/junk/duplicate data and is intentionally
// stricter because deleted history cannot explain any effect left behind.

export const CORRECTION_ID_PREFIX = 'corr_';

// Firestore document ids are already one path segment, so the original id can be
// appended directly. Keeping this identity simple also lets security rules verify
// `corr_<originalId>` and makes a second correction collide deterministically.
export function correctionTransactionId(originalId) {
  if (!originalId) throw new Error('correction-original-required');
  return `${CORRECTION_ID_PREFIX}${String(originalId)}`;
}

export function isCorrectionTransaction(txn) {
  return !!txn && (
    txn.kind === 'correction'
    || txn.category === 'correction'
    || !!txn.reversesTransactionId
  );
}

// New schema-v2 rows record the exact post-cap effects that landed. Legacy rows
// do not: their brain/energy/bond scalars may be configured rewards rather than
// true deltas, so those effects must be preserved rather than guessed. Coins are
// uncapped and remain safely reversible on legacy rows.
export function reversibleRewardEffects(txn = {}) {
  if (txn.rewardApplied && typeof txn.rewardApplied === 'object') {
    return {
      brain: Number(txn.rewardApplied.brain || 0),
      energy: Number(txn.rewardApplied.energy || 0),
      bond: Number(txn.rewardApplied.bond || 0),
      coins: Number(txn.rewardApplied.coins || 0),
      ambiguousCat: false
    };
  }
  return {
    brain: 0,
    energy: 0,
    bond: 0,
    coins: Number(txn.coins || 0),
    ambiguousCat: !!(
      txn.catId
      && (Number(txn.brain || 0) || Number(txn.energy || 0) || Number(txn.bond || 0))
    )
  };
}

// A correction intends to reverse the original APPLIED balance delta, not its
// full family-rule amount. The current balance still floors at zero, so if a
// positive reward was already spent the correction records the intended reverse
// separately from what could actually be removed now.
export function correctionAmountIntegrity(balanceBefore, originalAppliedAmount) {
  const before = Number(balanceBefore || 0);
  const requestedAmount = -Number(originalAppliedAmount || 0);
  const balanceAfter = Math.max(0, before + requestedAmount);
  return {
    requestedAmount,
    amount: balanceAfter - before,
    balanceBefore: before,
    balanceAfter
  };
}

export function hasLinkedCorrection(txns, originalId) {
  return !!originalId && (txns || []).some(t => t && t.reversesTransactionId === originalId);
}

// Permanent delete is intentionally stricter than Correct entry. It is only for
// true cleanup (tests/duplicates/junk), never ordinary family-history editing.
// If a row participates in correction history or carries unprovable legacy cat
// effects, deletion is blocked instead of guessing.
export function permanentDeleteEligibility(txn, { hasCorrection = false } = {}) {
  if (!txn || !txn.id) return { ok: false, reason: 'entry-missing' };
  if (isCorrectionTransaction(txn)) return { ok: false, reason: 'correction-history' };
  if (hasCorrection) return { ok: false, reason: 'already-corrected' };
  if (reversibleRewardEffects(txn).ambiguousCat) {
    return { ok: false, reason: 'legacy-cat-effects-unknown' };
  }
  return { ok: true, reason: null };
}

// Even when every original effect is known, a permanent delete must not erase
// the audit trail if some of that effect can no longer be removed now (for
// example, a +10 test credit whose minutes/coins have already been spent). In
// that case Correct entry remains safe because it preserves the original and
// records the partial no-debt reversal honestly.
export function permanentDeletePlanEligibility(plan = {}) {
  const balance = plan.balance || {};
  if (Number(balance.amount || 0) !== Number(balance.requestedAmount || 0)) {
    return { ok: false, reason: 'effects-no-longer-fully-reversible' };
  }
  const requested = plan.requestedReward || {};
  const applied = plan.appliedReward || {};
  for (const key of ['brain', 'energy', 'bond', 'coins']) {
    if (Number(applied[key] || 0) !== Number(requested[key] || 0)) {
      return { ok: false, reason: 'effects-no-longer-fully-reversible' };
    }
  }
  return { ok: true, reason: null };
}

function postedMillis(txn) {
  const at = txn && txn.createdAt;
  if (!at) return 0;
  if (typeof at.toMillis === 'function') return at.toMillis();
  if (typeof at.seconds === 'number') return at.seconds * 1000 + Number(at.nanoseconds || 0) / 1e6;
  if (typeof at === 'number') return at;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Link a Hero's Reset to the most recent still-active Room-to-Grow moment on the
// same activity day. A moment already corrected or already linked to another
// Reset is skipped. The link is reflective/audit metadata only; it never erases
// or refunds the original -2.
export function findHeroResetTarget(normalizedTxns, activityDate) {
  const rows = (normalizedTxns || []).filter(Boolean);
  const corrected = new Set(
    rows.filter(isCorrectionTransaction).map(t => t.reversesTransactionId).filter(Boolean)
  );
  const alreadyReset = new Set(
    rows
      .filter(t => t.reasonCode === 'hero_reset' && t.relatedTransactionId)
      .map(t => t.relatedTransactionId)
  );

  const candidates = rows.filter(t =>
    t.id
    && t.activityDate === activityDate
    && t.category === 'room_to_grow'
    && !corrected.has(t.id)
    && !alreadyReset.has(t.id)
  );
  candidates.sort((a, b) => postedMillis(b) - postedMillis(a));
  return candidates.length ? candidates[0].id : null;
}
