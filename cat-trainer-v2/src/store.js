// Synced data layer. All reads are realtime (onSnapshot) so both devices update
// with no refresh; all writes are Firestore transactions/batches so simultaneous
// actions from phone + tablet can't double-count or lose updates.

import { initFirebase, db, dbSdk } from './firebase.js?v=ec69d8c2';
import { CAT_IDS, CAT_DEFS, freshCatProgress } from './data/cats.js?v=ec69d8c2';
import { seededQuests } from './data/quests.js?v=ec69d8c2';
import { CAFE_ITEMS } from './data/cafe-items.js?v=ec69d8c2';
import {
  CARE_NEEDS, areCareNeedsOkay, careCharges, freshCatNeeds, grantCareCharge,
  needsAt, refillNeed
} from './care.js?v=ec69d8c2';
import {
  QUICK_ACTION_BY_CODE, CUSTOM_POSITIVE_BOND, QUEST_BOND, CAPS,
  clamp, isHeroReady, applyBalanceDelta, recordHeroCareActivity,
  resumeHeroCareActivity
} from './shared/rewards.js?v=ec69d8c2';
import { localDate, localTimeLabel } from './shared/dates.js?v=ec69d8c2';

export const CHILD_ID = 'sirus';

async function fs() {
  await initFirebase();
  return { database: db(), sdk: dbSdk() };
}

// --- Path helpers ------------------------------------------------------------
function paths(sdk, database, fid) {
  const { doc, collection } = sdk;
  const famRoot = ['families', fid];
  return {
    family: () => doc(database, ...famRoot),
    member: (uid) => doc(database, ...famRoot, 'members', uid),
    members: () => collection(database, ...famRoot, 'members'),
    child: () => doc(database, ...famRoot, 'childProfiles', CHILD_ID),
    cat: (catId) => doc(database, ...famRoot, 'childProfiles', CHILD_ID, 'cats', catId),
    cats: () => collection(database, ...famRoot, 'childProfiles', CHILD_ID, 'cats'),
    ownedItem: (id) => doc(database, ...famRoot, 'childProfiles', CHILD_ID, 'ownedCafeItems', id),
    ownedItems: () => collection(database, ...famRoot, 'childProfiles', CHILD_ID, 'ownedCafeItems'),
    quest: (id) => doc(database, ...famRoot, 'quests', id),
    quests: () => collection(database, ...famRoot, 'quests'),
    txns: () => collection(database, ...famRoot, 'pointTransactions'),
    txn: (id) => doc(database, ...famRoot, 'pointTransactions', id),
    completion: (id) => doc(database, ...famRoot, 'questCompletions', id),
    completions: () => collection(database, ...famRoot, 'questCompletions'),
    pairing: (code) => doc(database, 'pairings', code)
  };
}

// --- One-time family setup (parent) ------------------------------------------
// Writes must be ordered so each security-rule check sees already-committed data:
//   1. family        (owner can create their own family)
//   2. parent member (rule reads the now-committed family's ownerUid)
//   3. child + cats + quests (rules' isParent() reads the now-committed member)
// A single batch fails because rules' get()/exists() can't see pending writes
// from the same batch.
export async function setupFamily(parentUid, { familyName = 'Our Family', parentName = 'Mom' } = {}) {
  const { database, sdk } = await fs();
  const { writeBatch, setDoc, serverTimestamp, getDoc } = sdk;
  const p = paths(sdk, database, parentUid);

  // Existence check. On the very first run the owner isn't a member yet, so the
  // family read is denied — treat that as "not set up" rather than an error.
  try {
    const existing = await getDoc(p.family());
    if (existing.exists()) return; // already set up — don't clobber progress
  } catch (_) { /* permission-denied on first run: proceed to create */ }

  await setDoc(p.family(), {
    ownerUid: parentUid,
    name: familyName,
    createdAt: serverTimestamp(),
    settings: { allowNegative: false, dailyCap: null, timezone: 'America/Chicago' }
  });
  await setDoc(p.member(parentUid), { role: 'parent', displayName: parentName });

  const batch = writeBatch(database);
  batch.set(p.child(), {
    name: 'Sirus', activeCatId: 'nova', available: 0, coins: 0,
    childCanSwitchCat: true, careCharges: 0
  });
  CAT_IDS.forEach(catId => batch.set(p.cat(catId), {
    ...freshCatProgress(),
    catNeeds: freshCatNeeds(serverTimestamp())
  }));
  seededQuests().forEach(q => batch.set(p.quest(q.id), q));
  await batch.commit();
}

// --- Pairing (parent creates code, tablet joins) -----------------------------
export async function createPairingCode(familyId) {
  const { database, sdk } = await fs();
  const { setDoc, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  await setDoc(p.pairing(code), {
    familyId, role: 'child', active: true, createdAt: serverTimestamp()
  });
  return code;
}

export async function joinWithPairingCode(childUid, code, displayName = 'Sirus’s tablet') {
  const { database, sdk } = await fs();
  const { getDoc, setDoc } = sdk;
  const p = paths(sdk, database, code);
  const snap = await getDoc(p.pairing(code));
  const data = snap.exists() ? snap.data() : null;
  if (!data || data.active !== true || (data.role && data.role !== 'child')) {
    throw new Error('That pairing code is not valid. Ask Mom for a new one.');
  }
  const familyId = data.familyId;
  const fp = paths(sdk, database, familyId);
  await setDoc(fp.member(childUid), { role: 'child', displayName, pairingCode: code });
  return familyId;
}

// --- Co-parent (a second parent, e.g. Abba, joins the SAME family) -----------
// A parent generates an invite code; the co-parent redeems it to gain their own
// full 'parent' membership. Same shape as a child pairing code but role
// 'parent', so the rules grant management access rather than the limited child
// role. The co-parent keeps their own email+password account (own identity in
// the ledger); this only adds their membership to the existing family.
export async function createParentInviteCode(familyId) {
  const { database, sdk } = await fs();
  const { setDoc, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  await setDoc(p.pairing(code), {
    familyId, role: 'parent', active: true, createdAt: serverTimestamp()
  });
  return code;
}

export async function joinFamilyAsParent(uid, code, displayName = 'Abba') {
  const { database, sdk } = await fs();
  const { getDoc, setDoc } = sdk;
  const p = paths(sdk, database, code);
  const snap = await getDoc(p.pairing(code));
  const data = snap.exists() ? snap.data() : null;
  if (!data || data.active !== true || data.role !== 'parent') {
    throw new Error('That invite code is not valid. Ask Mom for a new one.');
  }
  const familyId = data.familyId;
  const fp = paths(sdk, database, familyId);
  await setDoc(fp.member(uid), { role: 'parent', displayName, pairingCode: code });
  return familyId;
}

// --- Realtime subscriptions --------------------------------------------------
export async function subscribe(familyId, handlers = {}) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where, orderBy, limit } = sdk;
  const p = paths(sdk, database, familyId);
  const today = localDate();
  const unsubs = [];

  if (handlers.onChild) unsubs.push(onSnapshot(p.child(), s => handlers.onChild(s.data())));
  if (handlers.onCats) unsubs.push(onSnapshot(p.cats(), s => {
    const cats = {}; s.forEach(d => { cats[d.id] = d.data(); }); handlers.onCats(cats);
  }));
  if (handlers.onQuests) unsubs.push(onSnapshot(p.quests(), s => {
    const quests = s.docs.map(d => d.data()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    handlers.onQuests(quests);
  }));
  if (handlers.onOwnedItems) unsubs.push(onSnapshot(p.ownedItems(), s => {
    handlers.onOwnedItems(s.docs.map(d => ({ id: d.id, ...d.data() })));
  }));
  if (handlers.onTodayCompletions) unsubs.push(onSnapshot(
    query(p.completions(), where('localDate', '==', today)),
    // Carry status so the child UI can tell "waiting for Mom" (pending) apart from
    // approved. Legacy docs predate the field, so a missing status reads approved.
    s => handlers.onTodayCompletions(s.docs.map(d => ({ questId: d.data().questId, status: d.data().status || 'approved' })))
  ));
  // Pending approvals across all days (a completion could span local midnight
  // before a parent reviews it). Filter on the status field; sort newest-first in
  // memory so no composite index is needed.
  if (handlers.onPendingApprovals) unsubs.push(onSnapshot(
    query(p.completions(), where('status', '==', 'pending')),
    s => {
      const items = s.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      handlers.onPendingApprovals(items);
    }
  ));
  if (handlers.onRecentTxns) unsubs.push(onSnapshot(
    query(p.txns(), orderBy('createdAt', 'desc'), limit(50)),
    s => handlers.onRecentTxns(s.docs.map(d => ({ id: d.id, ...d.data() })))
  ));

  return () => unsubs.forEach(u => u());
}

// Derived "today" totals for the dashboard, computed from the ledger so there is
// never a reset counter to get out of sync.
export function todayTotals(recentTxns) {
  const today = localDate();
  let earned = 0, spent = 0;
  for (const t of recentTxns) {
    if (t.localDate !== today) continue;
    if (t.amount > 0) earned += t.amount;
    else spent += -t.amount;
  }
  return { earned, spent };
}

// --- Writes ------------------------------------------------------------------

// Parent point adjustment (quick action or custom). Positive changes build Bond
// on the active cat.
export async function adjustPoints(familyId, uid, { amount, reasonCode, reasonLabel, note = '', deviceId = 'phone' }) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);

  const preset = reasonCode ? QUICK_ACTION_BY_CODE[reasonCode] : null;
  const delta = preset ? preset.amount : Number(amount) || 0;
  const label = reasonLabel || (preset ? preset.label : 'Custom adjustment');

  await runTransaction(database, async (tx) => {
    const childSnap = await tx.get(p.child());
    const child = childSnap.data();
    const allowNegative = false;
    const before = child.available || 0;
    const after = applyBalanceDelta(before, delta, { allowNegative });
    const applied = after - before;

    let bond = 0;
    if (applied > 0) {
      bond = preset ? preset.bond : CUSTOM_POSITIVE_BOND;
      const catRef = p.cat(child.activeCatId);
      const catSnap = await tx.get(catRef);
      const cat = catSnap.data();
      tx.update(catRef, { bond: clamp((cat.bond || 0) + bond, 0, CAPS.bond) });
    }
    tx.update(p.child(), { available: after });
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      childId: CHILD_ID, amount: applied, kind: 'adjust',
      reasonCode: reasonCode || 'custom', reasonLabel: label, note: note || '',
      bond, coins: 0, brain: 0, energy: 0, catId: child.activeCatId,
      createdBy: uid, deviceId, createdAt: serverTimestamp(),
      localDate: localDate(), timeLabel: localTimeLabel()
    });
  });
}

// Sirus taps a quest complete → this files a PENDING request and immediately
// grants one capped Care Charge. Minutes, coins, and long-term cat stats still
// wait for parent approval (see approveCompletion). One-per-day is enforced by
// the deterministic completion id.
export async function completeQuest(familyId, uid, questId, { deviceId = 'tablet' } = {}) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const today = localDate();
  const completionId = `${CHILD_ID}_${questId}_${today}`;

  return runTransaction(database, async (tx) => {
    const compSnap = await tx.get(p.completion(completionId));
    if (compSnap.exists()) throw new Error('already-completed');

    const questSnap = await tx.get(p.quest(questId));
    if (!questSnap.exists()) throw new Error('quest-missing');
    const quest = questSnap.data();
    if (quest.enabled === false) throw new Error('quest-disabled');

    const childSnap = await tx.get(p.child());
    const child = childSnap.data();
    const charge = grantCareCharge(child.careCharges);

    const points = Math.max(0, Number(quest.points) || 0);
    const brain = Math.max(0, Number(quest.brain) || 0);
    const energy = Math.max(0, Number(quest.energy) || 0);
    const coins = Math.max(0, Number(quest.coins) || 0);

    // The rewards snapshot is for display (Sirus's "waiting for Mom" pile) and a
    // fallback if the quest is later edited/deleted; the real credit is recomputed
    // from the live quest at approval time. activeCatId is snapshotted so approval
    // rewards the cat that was active when the quest was done.
    if (charge.granted) {
      tx.update(p.child(), {
        careCharges: charge.after,
        lastCareCompletionId: completionId
      });
    }
    tx.set(p.completion(completionId), {
      childId: CHILD_ID, questId, questTitle: quest.title || 'Quest',
      localDate: today, status: 'pending', activeCatId: child.activeCatId,
      rewards: { points, brain, energy, coins, bond: QUEST_BOND },
      careChargeGranted: charge.granted,
      createdBy: uid, createdAt: serverTimestamp()
    });
    return { careChargeGranted: charge.granted, careCharges: charge.after };
  });
}

// Parent approves a pending completion → NOW the reward lands: cat progress +
// minutes + coins + a ledger row, atomically. Points/brain/energy/coins are
// recomputed from the live quest (source of truth, so a tampered pending doc
// can't inflate the payout), falling back to the snapshot if the quest was since
// deleted. Idempotent: a completion already resolved is a no-op.
export async function approveCompletion(familyId, uid, completion) {
  if (!completion || !completion.id) return;
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);
  const completionId = completion.id;
  const nowMs = Date.now();
  const approvalDate = localDate(new Date(nowMs));

  await runTransaction(database, async (tx) => {
    const compSnap = await tx.get(p.completion(completionId));
    if (!compSnap.exists()) throw new Error('completion-missing');
    const comp = compSnap.data();
    if (comp.status && comp.status !== 'pending') return; // already resolved

    const snap = comp.rewards || {};
    const questSnap = await tx.get(p.quest(comp.questId));
    const quest = questSnap.exists() ? questSnap.data() : null;
    const title = (quest && quest.title) || comp.questTitle || 'Quest';
    const points = Math.max(0, Number(quest ? quest.points : snap.points) || 0);
    const brain = Math.max(0, Number(quest ? quest.brain : snap.brain) || 0);
    const energy = Math.max(0, Number(quest ? quest.energy : snap.energy) || 0);
    const coins = Math.max(0, Number(quest ? quest.coins : snap.coins) || 0);

    const childSnap = await tx.get(p.child());
    const child = childSnap.data();
    // Pending completions created before Care Charges shipped have no boolean
    // marker. Give those one migration-safe charge at approval; a recorded false
    // means the cap was already full at completion time and is not reconsidered.
    const legacyCharge = typeof comp.careChargeGranted !== 'boolean'
      ? grantCareCharge(child.careCharges)
      : { granted: false, after: careCharges(child.careCharges) };
    const catId = comp.activeCatId || child.activeCatId;
    const catRef = p.cat(catId);
    const catSnap = await tx.get(catRef);
    const cat = catSnap.exists() ? catSnap.data() : { brain: 0, energy: 0, bond: 0, evolved: false };
    const care = needsAt(cat.catNeeds, nowMs);
    const heroCare = recordHeroCareActivity(
      cat.heroCareProgress,
      approvalDate,
      areCareNeedsOkay(care),
      serverTimestamp()
    );

    const nextCat = {
      brain: clamp((cat.brain || 0) + brain, 0, CAPS.brain),
      energy: clamp((cat.energy || 0) + energy, 0, CAPS.energy),
      bond: clamp((cat.bond || 0) + QUEST_BOND, 0, CAPS.bond),
      evolved: cat.evolved || false,
      heroCareProgress: heroCare.progress
    };
    if (!nextCat.evolved && isHeroReady(nextCat)) nextCat.evolved = true;

    tx.update(catRef, nextCat);
    const childUpdate = {
      available: (child.available || 0) + points,
      coins: (child.coins || 0) + coins
    };
    if (legacyCharge.granted) {
      childUpdate.careCharges = legacyCharge.after;
      childUpdate.lastCareCompletionId = completionId;
    }
    tx.update(p.child(), childUpdate);
    tx.update(p.completion(completionId), {
      status: 'approved',
      rewards: { points, brain, energy, coins, bond: QUEST_BOND },
      careChargeGranted: comp.careChargeGranted === true || legacyCharge.granted,
      approvedBy: uid, approvedAt: serverTimestamp()
    });
    // Ledger row is stamped at approval time — the moment the minutes actually
    // become available — so the dashboard's "earned today" reflects real credit.
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      childId: CHILD_ID, amount: points, kind: 'quest', questId: comp.questId,
      reasonCode: 'quest', reasonLabel: `Quest: ${title}`,
      bond: QUEST_BOND, coins, brain, energy, catId,
      createdBy: uid, deviceId: 'phone', createdAt: serverTimestamp(),
      localDate: approvalDate, timeLabel: localTimeLabel(new Date(nowMs))
    });
  });
}

// Parent marks a quest done ON Sirus's behalf from the dashboard → completes AND
// approves in one step, so the reward (cat progress + minutes + coins + ledger
// row) lands immediately with no separate approval. Works whether the quest is
// untouched today (creates the completion already-approved) or already pending
// from Sirus (approves it). Idempotent: an already-approved quest is a no-op.
// Rewards come from the live quest (source of truth), falling back to the pending
// doc's snapshot if the quest was since deleted.
export async function parentCompleteQuest(familyId, uid, questId) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);
  const nowMs = Date.now();
  const today = localDate(new Date(nowMs));
  const completionId = `${CHILD_ID}_${questId}_${today}`;

  await runTransaction(database, async (tx) => {
    const compSnap = await tx.get(p.completion(completionId));
    const existing = compSnap.exists() ? compSnap.data() : null;
    if (existing && existing.status === 'approved') return; // already done today

    const questSnap = await tx.get(p.quest(questId));
    const quest = questSnap.exists() ? questSnap.data() : null;
    const snap = (existing && existing.rewards) || {};
    const title = (quest && quest.title) || (existing && existing.questTitle) || 'Quest';
    const points = Math.max(0, Number(quest ? quest.points : snap.points) || 0);
    const brain = Math.max(0, Number(quest ? quest.brain : snap.brain) || 0);
    const energy = Math.max(0, Number(quest ? quest.energy : snap.energy) || 0);
    const coins = Math.max(0, Number(quest ? quest.coins : snap.coins) || 0);

    const childSnap = await tx.get(p.child());
    const child = childSnap.data();
    const shouldGrantCare = !existing || typeof existing.careChargeGranted !== 'boolean';
    const charge = shouldGrantCare
      ? grantCareCharge(child.careCharges)
      : { granted: false, after: careCharges(child.careCharges) };
    const catId = (existing && existing.activeCatId) || child.activeCatId;
    const catRef = p.cat(catId);
    const catSnap = await tx.get(catRef);
    const cat = catSnap.exists() ? catSnap.data() : { brain: 0, energy: 0, bond: 0, evolved: false };
    const care = needsAt(cat.catNeeds, nowMs);
    const heroCare = recordHeroCareActivity(
      cat.heroCareProgress,
      today,
      areCareNeedsOkay(care),
      serverTimestamp()
    );

    const nextCat = {
      brain: clamp((cat.brain || 0) + brain, 0, CAPS.brain),
      energy: clamp((cat.energy || 0) + energy, 0, CAPS.energy),
      bond: clamp((cat.bond || 0) + QUEST_BOND, 0, CAPS.bond),
      evolved: cat.evolved || false,
      heroCareProgress: heroCare.progress
    };
    if (!nextCat.evolved && isHeroReady(nextCat)) nextCat.evolved = true;

    tx.update(catRef, nextCat);
    const childUpdate = {
      available: (child.available || 0) + points,
      coins: (child.coins || 0) + coins
    };
    if (charge.granted) {
      childUpdate.careCharges = charge.after;
      childUpdate.lastCareCompletionId = completionId;
    }
    tx.update(p.child(), childUpdate);

    const rewards = { points, brain, energy, coins, bond: QUEST_BOND };
    if (existing) {
      tx.update(p.completion(completionId), {
        status: 'approved', rewards,
        careChargeGranted: existing.careChargeGranted === true || charge.granted,
        approvedBy: uid, approvedAt: serverTimestamp()
      });
    } else {
      tx.set(p.completion(completionId), {
        childId: CHILD_ID, questId, questTitle: title,
        localDate: today, status: 'approved', activeCatId: catId, rewards,
        careChargeGranted: charge.granted,
        createdBy: uid, createdAt: serverTimestamp(),
        approvedBy: uid, approvedAt: serverTimestamp()
      });
    }

    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      childId: CHILD_ID, amount: points, kind: 'quest', questId,
      reasonCode: 'quest', reasonLabel: `Quest: ${title}`,
      bond: QUEST_BOND, coins, brain, energy, catId,
      createdBy: uid, deviceId: 'phone', createdAt: serverTimestamp(),
      localDate: today, timeLabel: localTimeLabel()
    });
  });
}

// Parent rejects a pending completion → discard it so the quest reappears for
// Sirus. An immediate Care Charge is deliberately not clawed back; the care plan
// treats already-given care as safe even when a completion is later rejected.
export async function rejectCompletion(familyId, completionId) {
  if (!completionId) return;
  const { database, sdk } = await fs();
  const { deleteDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await deleteDoc(p.completion(completionId));
}

// Parent records screen time used — draws down the available balance.
export async function redeemScreenTime(familyId, uid, minutes, { deviceId = 'phone', note = '' } = {}) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);
  const use = Math.max(0, Number(minutes) || 0);

  await runTransaction(database, async (tx) => {
    const childSnap = await tx.get(p.child());
    const before = childSnap.data().available || 0;
    const after = Math.max(0, before - use);
    const applied = after - before; // negative
    tx.update(p.child(), { available: after });
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      childId: CHILD_ID, amount: applied, kind: 'redeem',
      reasonCode: 'screen_time', reasonLabel: 'Screen time used', note: note || '',
      bond: 0, coins: 0, brain: 0, energy: 0,
      createdBy: uid, deviceId, createdAt: serverTimestamp(),
      localDate: localDate(), timeLabel: localTimeLabel()
    });
  });
}

// Read the child (and, if the entry touched a cat, that cat) up front, then
// reverse the entry's effects. Firestore transactions require ALL reads before
// ANY writes — the previous version read the cat after writing the child, which
// threw and made undo silently fail.
async function reverseEntry(tx, p, familyId, sdk, txn) {
  const childSnap = await tx.get(p.child());
  const child = childSnap.data();
  let catRef = null, catSnap = null;
  if (txn.catId && (txn.brain || txn.energy || txn.bond)) {
    catRef = p.cat(txn.catId);
    catSnap = await tx.get(catRef);
  }
  // ---- writes ----
  const childUpdate = { available: Math.max(0, (child.available || 0) - Number(txn.amount || 0)) };
  if (txn.coins) childUpdate.coins = Math.max(0, (child.coins || 0) - Number(txn.coins));
  tx.update(p.child(), childUpdate);
  if (catSnap) {
    const cat = catSnap.data();
    const next = {
      brain: clamp((cat.brain || 0) - Number(txn.brain || 0), 0, CAPS.brain),
      energy: clamp((cat.energy || 0) - Number(txn.energy || 0), 0, CAPS.energy),
      bond: clamp((cat.bond || 0) - Number(txn.bond || 0), 0, CAPS.bond)
    };
    next.evolved = cat.evolved || isHeroReady({ ...cat, ...next });
    tx.update(catRef, next);
  }
  // If reversing a quest, clear its completion so it can be earned again today.
  if (txn.kind === 'quest' && txn.questId) {
    tx.delete(p.completion(`${CHILD_ID}_${txn.questId}_${txn.localDate}`));
  }
}

// Undo = a compensating "correction" transaction that reverses the last entry's
// effects, preserving history (leaves an audit note, never a silent delete).
export async function undoLast(familyId, uid, lastTxn) {
  if (!lastTxn) return;
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);

  await runTransaction(database, async (tx) => {
    await reverseEntry(tx, p, familyId, sdk, lastTxn);
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      childId: CHILD_ID, amount: -Number(lastTxn.amount || 0), kind: 'correction',
      reasonCode: 'undo', reasonLabel: `Undo: ${lastTxn.reasonLabel || 'last action'}`,
      bond: -Number(lastTxn.bond || 0), coins: -Number(lastTxn.coins || 0),
      brain: -Number(lastTxn.brain || 0), energy: -Number(lastTxn.energy || 0),
      catId: lastTxn.catId || null, createdBy: uid, deviceId: 'phone',
      createdAt: serverTimestamp(), localDate: localDate(), timeLabel: localTimeLabel()
    });
  });
}

// Delete a specific ledger entry (parent-only): reverses its effect on the
// balance / cat / coins and removes the row entirely.
export async function deleteTransaction(familyId, uid, txn) {
  if (!txn || !txn.id) return;
  const { database, sdk } = await fs();
  const { runTransaction } = sdk;
  const p = paths(sdk, database, familyId);
  await runTransaction(database, async (tx) => {
    await reverseEntry(tx, p, familyId, sdk, txn);
    tx.delete(p.txn(txn.id));
  });
}

// Existing cats predate the care layer. Stamp a healthy baseline on first use so
// elapsed-time decay begins when the family first sees the feature, not at an
// arbitrary deployment date. This is idempotent across devices.
export async function ensureCatCare(familyId, catId) {
  if (!CAT_DEFS[catId]) return { initialized: false };
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const catRef = p.cat(catId);
  const nowMs = Date.now();

  return runTransaction(database, async (tx) => {
    const catSnap = await tx.get(catRef);
    if (!catSnap.exists()) throw new Error('cat-missing');
    const cat = catSnap.data();
    const complete = cat.catNeeds && cat.catNeeds.lastUpdatedAt
      && CARE_NEEDS.every(need => cat.catNeeds[need] != null && Number.isFinite(Number(cat.catNeeds[need])));
    if (complete) return { initialized: false };
    tx.update(catRef, {
      catNeeds: {
        ...needsAt(cat.catNeeds, nowMs),
        lastUpdatedAt: serverTimestamp()
      }
    });
    return { initialized: true };
  });
}

// Spend one flexible Care Charge on one known need. The transaction recomputes
// all three decayed values and the charge count from stored data; callers choose
// only Hunger/Rest/Happiness and never submit a refill amount. This prevents
// repeated taps or two devices from double-spending.
export async function spendCare(familyId, catId, need) {
  if (!CAT_DEFS[catId]) throw new Error('cat-missing');
  if (!CARE_NEEDS.includes(need)) throw new Error('unknown-care-need');
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const catRef = p.cat(catId);
  const nowMs = Date.now();

  return runTransaction(database, async (tx) => {
    const childSnap = await tx.get(p.child());
    const catSnap = await tx.get(catRef);
    if (!childSnap.exists() || !catSnap.exists()) throw new Error('care-state-missing');
    const child = childSnap.data();
    const cat = catSnap.data();
    const result = refillNeed(cat.catNeeds, need, child.careCharges, nowMs);
    if (!result.ok) throw new Error(result.reason);
    const today = localDate(new Date(nowMs));
    const heroCare = resumeHeroCareActivity(
      cat.heroCareProgress,
      today,
      areCareNeedsOkay(result.needsAfter)
    );

    tx.update(p.child(), {
      careCharges: result.chargesAfter,
      lastCareSpend: { catId, need, at: serverTimestamp() }
    });
    const catUpdate = {
      catNeeds: {
        ...result.needsAfter,
        lastUpdatedAt: serverTimestamp()
      }
    };
    if (heroCare.advanced) {
      catUpdate.heroCareProgress = heroCare.progress;
      if (!cat.evolved && isHeroReady({ ...cat, heroCareProgress: heroCare.progress })) {
        catUpdate.evolved = true;
      }
    }
    tx.update(catRef, catUpdate);
    return result;
  });
}

// Compatibility alias for the first Hunger-only vertical slice.
export function spendHungerCare(familyId, catId) {
  return spendCare(familyId, catId, 'hunger');
}

// Buy a café item with Cat Coins (never screen-time points).
export async function purchaseCafeItem(familyId, uid, itemId) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const item = CAFE_ITEMS[itemId];
  if (!item) throw new Error('unknown-item');

  await runTransaction(database, async (tx) => {
    const ownedSnap = await tx.get(p.ownedItem(itemId));
    if (ownedSnap.exists()) throw new Error('already-owned');
    const childSnap = await tx.get(p.child());
    const coins = childSnap.data().coins || 0;
    if (coins < item.price) throw new Error('not-enough-coins');
    // The purchase marker lets Firestore Rules prove that this exact coin
    // decrease is paired with this exact catalog item creation. Without that
    // pairing, the old blanket "coins cannot change" child rule denied every
    // legitimate tablet purchase (including a 12-coin tree with 14 coins).
    tx.update(p.child(), {
      coins: coins - item.price,
      lastCafePurchase: { itemId, at: serverTimestamp() }
    });
    tx.set(p.ownedItem(itemId), {
      purchasedAt: serverTimestamp(), price: item.price, placed: true
    });
  });
}

// Rearrange décor: save an item's room position (x/y as % of the room). The
// child may do this on their own items — café items grant no points/coins, so
// this can't be abused for value; the rules keep price + purchasedAt immutable.
export async function moveCafeItem(familyId, itemId, x, y) {
  const { database, sdk } = await fs();
  const { updateDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await updateDoc(p.ownedItem(itemId), { x, y });
}

// Put an owned item away (placed:false → hidden from the room but still owned
// and re-placeable from the shop) or bring it back out (placed:true).
export async function setCafeItemPlaced(familyId, itemId, placed) {
  const { database, sdk } = await fs();
  const { updateDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await updateDoc(p.ownedItem(itemId), { placed });
}

// Save where the café cat is standing in the room (x/y as % of the room). Stored
// on the child profile so the room reopens with the cat where Sirus left it. The
// security rules let the child write this — only `available`/`coins` are frozen
// for a child write — so no reward can be self-credited through it.
export async function moveCafeCat(familyId, x, y) {
  const { database, sdk } = await fs();
  const { updateDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await updateDoc(p.child(), { cafeCat: { x, y } });
}

export async function setActiveCat(familyId, catId) {
  const { database, sdk } = await fs();
  const { updateDoc } = sdk;
  const p = paths(sdk, database, familyId);
  if (!CAT_DEFS[catId]) return;
  await updateDoc(p.child(), { activeCatId: catId });
}

// --- Quest management (parent) ----------------------------------------------
export async function saveQuest(familyId, quest) {
  const { database, sdk } = await fs();
  const { setDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await setDoc(p.quest(quest.id), quest, { merge: true });
}
// Lock/unlock a preset: flip a quest's `enabled` flag. A disabled quest is hidden
// from Sirus's lists and refused server-side, without deleting its definition.
export async function setQuestEnabled(familyId, questId, enabled) {
  const { database, sdk } = await fs();
  const { setDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await setDoc(p.quest(questId), { id: questId, enabled: !!enabled }, { merge: true });
}
export async function deleteQuest(familyId, questId) {
  const { database, sdk } = await fs();
  const { deleteDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await deleteDoc(p.quest(questId));
}
export async function resetQuestCompletion(familyId, questId) {
  const { database, sdk } = await fs();
  const { deleteDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await deleteDoc(p.completion(`${CHILD_ID}_${questId}_${localDate()}`));
}
