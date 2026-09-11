// Slice 3 ledger actions kept separate from the main Café/store controller.
// Ordinary mistakes become immutable linked corrections. Permanent deletion is
// an intentionally rare parent cleanup path for test/junk/duplicate data only.

import { initFirebase, db, dbSdk } from './firebase.js?v=e33698b7';
import { QUICK_ACTION_BY_CODE, CAPS, clamp } from './shared/rewards.js?v=e33698b7';
import { amountIntegrity, normalizeTransaction } from './shared/ledger.js?v=e33698b7';
import { FEEDBACK_TYPE, DELIVERY, recognitionEventId } from './shared/feedback.js?v=e33698b7';
import { localDate, localTimeLabel } from './shared/dates.js?v=e33698b7';
import {
  correctionTransactionId, correctionAmountIntegrity, reversibleRewardEffects,
  permanentDeleteEligibility, permanentDeletePlanEligibility,
  findHeroResetTarget, isCorrectionTransaction
} from './shared/corrections.js?v=e33698b7';

const CHILD_ID = 'sirus';
const ZERO_REWARD = { bond: 0, brain: 0, energy: 0, coins: 0 };

async function fs() {
  await initFirebase();
  return { database: db(), sdk: dbSdk() };
}

function paths(sdk, database, fid) {
  const { doc, collection } = sdk;
  const root = ['families', fid];
  return {
    member: uid => doc(database, ...root, 'members', uid),
    child: () => doc(database, ...root, 'childProfiles', CHILD_ID),
    cat: id => doc(database, ...root, 'childProfiles', CHILD_ID, 'cats', id),
    txn: id => doc(database, ...root, 'pointTransactions', id),
    txns: () => collection(database, ...root, 'pointTransactions'),
    completion: id => doc(database, ...root, 'questCompletions', id),
    careAward: id => doc(database, ...root, 'questCareAwards', id),
    feedback: id => doc(database, ...root, 'familyFeedback', id)
  };
}

function completionIdFor(original) {
  if (!original || original.kind !== 'quest' || !original.questId) return null;
  return original.questCompletionId
    || `${CHILD_ID}_${original.questId}_${original.activityDate || original.localDate}`;
}

async function memberName(tx, p, uid) {
  const snap = await tx.get(p.member(uid));
  return (snap.exists() && snap.data().displayName) || 'Parent';
}

async function linkedCorrections(database, sdk, p, originalId) {
  const { getDocs, query, where } = sdk;
  const snap = await getDocs(query(p.txns(), where('reversesTransactionId', '==', originalId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function readReversalState(tx, p, original) {
  const childSnap = await tx.get(p.child());
  if (!childSnap.exists()) throw new Error('child-missing');
  const child = childSnap.data();
  const effects = reversibleRewardEffects(original);
  let catSnap = null;
  if (original.catId && (effects.brain || effects.energy || effects.bond)) {
    catSnap = await tx.get(p.cat(original.catId));
  }
  const completionId = completionIdFor(original);
  const completionSnap = completionId ? await tx.get(p.completion(completionId)) : null;
  const careAwardSnap = completionId ? await tx.get(p.careAward(completionId)) : null;
  return { child, effects, catSnap, completionId, completionSnap, careAwardSnap };
}

function reversalPlan(original, { child, effects, catSnap }) {
  const balance = correctionAmountIntegrity(child.available || 0, original.amount || 0);

  const coinsBefore = Number(child.coins || 0);
  const coinsAfter = Math.max(0, coinsBefore - effects.coins);
  const requestedReward = {
    brain: -effects.brain,
    energy: -effects.energy,
    bond: -effects.bond,
    coins: -effects.coins
  };
  const appliedReward = {
    brain: 0,
    energy: 0,
    bond: 0,
    coins: coinsAfter - coinsBefore
  };

  let catUpdate = null;
  if (catSnap && catSnap.exists()) {
    const cat = catSnap.data();
    const before = {
      brain: Number(cat.brain || 0),
      energy: Number(cat.energy || 0),
      bond: Number(cat.bond || 0)
    };
    const after = {
      brain: clamp(before.brain - effects.brain, 0, CAPS.brain),
      energy: clamp(before.energy - effects.energy, 0, CAPS.energy),
      bond: clamp(before.bond - effects.bond, 0, CAPS.bond)
    };
    catUpdate = after;
    appliedReward.brain = after.brain - before.brain;
    appliedReward.energy = after.energy - before.energy;
    appliedReward.bond = after.bond - before.bond;
  }

  return {
    balance,
    coinsBefore,
    coinsAfter,
    catUpdate,
    requestedReward,
    appliedReward,
    ambiguousCat: effects.ambiguousCat
  };
}

function applyReversalWrites(tx, p, original, plan, state, { uid, serverTimestamp }) {
  const childUpdate = { available: plan.balance.balanceAfter };
  if (plan.coinsAfter !== plan.coinsBefore) childUpdate.coins = plan.coinsAfter;
  tx.update(p.child(), childUpdate);

  if (plan.catUpdate && original.catId) {
    // Deliberately do not touch evolved, heroCareProgress, needs, or Care Charges.
    tx.update(p.cat(original.catId), plan.catUpdate);
  }

  // Correcting an approved quest makes that quest available again, but never
  // claws back its already-granted/spent Care Charge or any care it enabled.
  if (state.completionId) {
    // Approved completions created before immutable Care markers shipped need
    // a conservative backfill before they are reopened. Use the historical
    // boolean when present; unknown legacy rows record zero, never new Care.
    if (state.careAwardSnap && !state.careAwardSnap.exists()) {
      const completion = state.completionSnap && state.completionSnap.exists()
        ? state.completionSnap.data()
        : {};
      const granted = completion.careChargeGranted === true;
      const date = completion.localDate || original.activityDate || original.localDate
        || state.completionId.slice(-10);
      tx.set(p.careAward(state.completionId), {
        childId: completion.childId || CHILD_ID,
        questId: completion.questId || original.questId,
        localDate: date,
        sourceCompletionId: state.completionId,
        award: granted ? 1 : 0,
        careChargeGranted: granted,
        createdBy: uid,
        createdAt: serverTimestamp()
      });
    }
    tx.delete(p.completion(state.completionId));
  }

  // A corrected/deleted positive recognition must never pop up later. Deleting a
  // nonexistent feedback doc is harmless, and seen feedback needs no migration.
  if (original.id) tx.delete(p.feedback(recognitionEventId(original.id)));
}

export async function getTransaction(familyId, txnId) {
  const { database, sdk } = await fs();
  const { getDoc } = sdk;
  const p = paths(sdk, database, familyId);
  const snap = await getDoc(p.txn(txnId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getLatestCorrectableTransaction(familyId) {
  const { database, sdk } = await fs();
  const { getDocs, query, orderBy, limit } = sdk;
  const p = paths(sdk, database, familyId);
  const snap = await getDocs(query(p.txns(), orderBy('createdAt', 'desc'), limit(50)));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const corrected = new Set(rows.map(t => t.reversesTransactionId).filter(Boolean));
  return rows.find(t => !isCorrectionTransaction(t) && !corrected.has(t.id)) || null;
}

export async function correctTransaction(familyId, uid, txnId, { note = '' } = {}) {
  if (!txnId) throw new Error('entry-missing');
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);

  // Legacy Slice-1/2 corrections used random ids. Detect them before entering the
  // transaction; the deterministic correction ref below closes races for all new
  // Slice-3 corrections across Mom and Abba.
  const legacyLinks = await linkedCorrections(database, sdk, p, txnId);
  if (legacyLinks.length) throw new Error('already-corrected');

  const correctionId = correctionTransactionId(txnId);
  return runTransaction(database, async tx => {
    const actorName = await memberName(tx, p, uid);
    const originalSnap = await tx.get(p.txn(txnId));
    const correctionSnap = await tx.get(p.txn(correctionId));
    if (!originalSnap.exists()) throw new Error('entry-missing');
    if (correctionSnap.exists()) throw new Error('already-corrected');

    const original = { id: originalSnap.id, ...originalSnap.data() };
    if (isCorrectionTransaction(original)) throw new Error('cannot-correct-correction');

    const state = await readReversalState(tx, p, original);
    const plan = reversalPlan(original, state);

    applyReversalWrites(tx, p, original, plan, state, { uid, serverTimestamp });
    tx.set(p.txn(correctionId), {
      schemaVersion: 2,
      childId: CHILD_ID,
      kind: 'correction',
      category: 'correction',
      reasonCode: 'correction',
      reasonLabel: `Correction: ${original.reasonLabel || 'entry'}`,
      note: note || '',
      requestedAmount: plan.balance.requestedAmount,
      amount: plan.balance.amount,
      balanceBefore: plan.balance.balanceBefore,
      balanceAfter: plan.balance.balanceAfter,
      activityDate: original.activityDate || original.localDate || localDate(),
      createdBy: uid,
      createdByName: actorName,
      deviceId: 'phone',
      createdAt: serverTimestamp(),
      localDate: localDate(),
      timeLabel: localTimeLabel(),
      questCompletionId: null,
      questAttemptId: null,
      relatedTransactionId: null,
      reversesTransactionId: original.id,
      catId: original.catId || null,
      rewardRequested: plan.requestedReward,
      rewardApplied: plan.appliedReward,
      bond: plan.appliedReward.bond,
      coins: plan.appliedReward.coins,
      brain: plan.appliedReward.brain,
      energy: plan.appliedReward.energy,
      legacyEffectsPreserved: plan.ambiguousCat === true
    });

    return { correctionId, preservedLegacyCat: plan.ambiguousCat === true };
  });
}

export async function permanentDeleteTransaction(familyId, uid, txnId) {
  if (!txnId) throw new Error('entry-missing');
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const links = await linkedCorrections(database, sdk, p, txnId);
  if (links.length) throw new Error('already-corrected');

  return runTransaction(database, async tx => {
    const originalSnap = await tx.get(p.txn(txnId));
    const correctionSnap = await tx.get(p.txn(correctionTransactionId(txnId)));
    if (!originalSnap.exists()) return { deleted: false };
    const original = { id: originalSnap.id, ...originalSnap.data() };
    const eligibility = permanentDeleteEligibility(original, { hasCorrection: correctionSnap.exists() });
    if (!eligibility.ok) throw new Error(eligibility.reason);

    const state = await readReversalState(tx, p, original);
    // Shape-level eligibility already blocks ambiguous legacy cat effects, but
    // keep the transaction-side check authoritative if the data shape changes.
    if (state.effects.ambiguousCat) throw new Error('legacy-cat-effects-unknown');
    const plan = reversalPlan(original, state);
    // Cleanup deletion has no audit row afterward, so it is allowed only if ALL
    // known effects can actually be removed now. If minutes/coins were spent,
    // use Correct entry instead so the partial no-debt reversal remains visible.
    const planEligibility = permanentDeletePlanEligibility(plan);
    if (!planEligibility.ok) throw new Error(planEligibility.reason);

    applyReversalWrites(tx, p, original, plan, state, { uid, serverTimestamp });
    tx.delete(p.txn(original.id));
    return { deleted: true };
  });
}

async function dayTransactions(familyId, activityDate) {
  const { database, sdk } = await fs();
  const { getDocs, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  const [a, l] = await Promise.all([
    getDocs(query(p.txns(), where('activityDate', '==', activityDate))),
    getDocs(query(p.txns(), where('localDate', '==', activityDate)))
  ]);
  const merged = new Map();
  for (const d of [...a.docs, ...l.docs]) merged.set(d.id, { id: d.id, ...d.data() });
  return [...merged.values()]
    .map(t => normalizeTransaction(t))
    .filter(t => t.activityDate === activityDate);
}

// Hero's Reset is the one quick action Slice 3 needs to create itself so the new
// row can carry relatedTransactionId at creation time (point rows are immutable).
export async function awardHeroReset(familyId, uid, { note = '', activityDate: day = localDate() } = {}) {
  const preset = QUICK_ACTION_BY_CODE.hero_reset;
  const rows = await dayTransactions(familyId, day);
  const relatedTransactionId = findHeroResetTarget(rows, day);

  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);
  const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));

  return runTransaction(database, async tx => {
    const actorName = await memberName(tx, p, uid);
    const childSnap = await tx.get(p.child());
    if (!childSnap.exists()) throw new Error('child-missing');
    const child = childSnap.data();
    const catId = child.activeCatId;
    const catSnap = await tx.get(p.cat(catId));
    if (!catSnap.exists()) throw new Error('cat-missing');
    const cat = catSnap.data();

    const balance = amountIntegrity(child.available || 0, preset.amount);
    const bondBefore = Number(cat.bond || 0);
    const bondAfter = clamp(bondBefore + preset.bond, 0, CAPS.bond);
    const bondApplied = bondAfter - bondBefore;

    tx.update(p.child(), { available: balance.balanceAfter });
    tx.update(p.cat(catId), { bond: bondAfter });

    const rewardRequested = { ...ZERO_REWARD, bond: preset.bond };
    const rewardApplied = { ...ZERO_REWARD, bond: bondApplied };
    tx.set(txnRef, {
      schemaVersion: 2,
      childId: CHILD_ID,
      kind: 'adjust',
      category: 'earned',
      reasonCode: preset.code,
      reasonLabel: preset.label,
      note: note || '',
      requestedAmount: balance.requestedAmount,
      amount: balance.amount,
      balanceBefore: balance.balanceBefore,
      balanceAfter: balance.balanceAfter,
      activityDate: day,
      createdBy: uid,
      createdByName: actorName,
      deviceId: 'phone',
      createdAt: serverTimestamp(),
      localDate: localDate(),
      timeLabel: localTimeLabel(),
      questCompletionId: null,
      questAttemptId: null,
      relatedTransactionId,
      reversesTransactionId: null,
      catId,
      rewardRequested,
      rewardApplied,
      bond: bondApplied,
      coins: 0,
      brain: 0,
      energy: 0
    });

    tx.set(p.feedback(recognitionEventId(txnRef.id)), {
      recipientChildId: CHILD_ID,
      type: FEEDBACK_TYPE.RECOGNITION,
      sourceTransactionId: txnRef.id,
      sourceQuestCompletionId: null,
      sourceQuestAttemptId: null,
      actorId: uid,
      actorName,
      amount: preset.amount,
      reasonLabel: preset.label,
      parentNote: note || '',
      activityDate: day,
      createdAt: serverTimestamp(),
      deliveryStatus: DELIVERY.PENDING,
      claimedByClientId: null,
      claimedAt: null,
      seenAt: null
    });

    return { transactionId: txnRef.id, relatedTransactionId };
  });
}
