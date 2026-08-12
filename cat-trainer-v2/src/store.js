// Synced data layer. All reads are realtime (onSnapshot) so both devices update
// with no refresh; all writes are Firestore transactions/batches so simultaneous
// actions from phone + tablet can't double-count or lose updates.

import { initFirebase, db, dbSdk } from './firebase.js?v=24175612';
import { CAT_IDS, CAT_DEFS, freshCatProgress } from './data/cats.js?v=24175612';
import { seededQuests } from './data/quests.js?v=24175612';
import { CAFE_ITEMS } from './data/cafe-items.js?v=24175612';
import {
  CARE_NEEDS, areCareNeedsOkay, careCharges, freshCatNeeds, grantCareCharge,
  needsAt, refillNeed
} from './care.js?v=24175612';
import {
  QUICK_ACTION_BY_CODE, CUSTOM_POSITIVE_BOND, QUEST_BOND, CAPS,
  clamp, isHeroReady, recordHeroCareActivity,
  resumeHeroCareActivity
} from './shared/rewards.js?v=24175612';
import {
  SCHEMA_VERSION, CATEGORY, classifyTransaction, amountIntegrity,
  normalizeTransaction, summarizeDay
} from './shared/ledger.js?v=24175612';
import {
  FEEDBACK_TYPE, DELIVERY, recognitionEventId, questReturnedEventId, isClaimable
} from './shared/feedback.js?v=24175612';
import { localDate, localTimeLabel } from './shared/dates.js?v=24175612';
import { presetTargets } from './shared/routines.js?v=24175612';

export const CHILD_ID = 'sirus';

// A stable, unique id for one quest attempt. The completion *document* id is
// reusable (child_quest_day) — Sirus can retry the same quest the same day after
// a rejection — so retry-safe feedback (Slice 2) needs an identity that never
// collides. Recorded on the completion and copied onto the approved ledger row.
function newAttemptId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Resolve the acting parent's display name from their member record so each row
// carries a historical Mom/Abba snapshot instead of trusting a device label
// (§11). Must be called before any transaction write (all reads precede writes).
async function readMemberName(tx, p, uid) {
  try {
    const snap = await tx.get(p.member(uid));
    return (snap.exists() && snap.data().displayName) || 'Parent';
  } catch (_) { return 'Parent'; }
}

const ZERO_REWARD = { bond: 0, brain: 0, energy: 0, coins: 0 };

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
    dayOverride: (id) => doc(database, ...famRoot, 'questDayOverrides', id),
    dayOverrides: () => collection(database, ...famRoot, 'questDayOverrides'),
    feedback: (id) => doc(database, ...famRoot, 'familyFeedback', id),
    feedbacks: () => collection(database, ...famRoot, 'familyFeedback'),
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
  const unsubs = [];

  if (handlers.onChild) unsubs.push(onSnapshot(p.child(), s => handlers.onChild(s.data())));
  // Family members power the Mom/Abba attribution map (legacy rows store only a
  // UID; new rows carry a name snapshot but fall back to this live map).
  if (handlers.onMembers) unsubs.push(onSnapshot(p.members(), s => {
    const members = {}; s.forEach(d => { members[d.id] = d.data(); }); handlers.onMembers(members);
  }));
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
  // Today's completions and today's overrides are DATE-SCOPED and therefore live
  // in subscribeToday (below), re-pointed at local midnight so the day rolls over
  // without a reload. Pending approvals span all days (a completion may await
  // review past local midnight), so it stays here — status-filtered, sorted in
  // memory, no composite index.
  if (handlers.onPendingApprovals) unsubs.push(onSnapshot(
    query(p.completions(), where('status', '==', 'pending')),
    s => {
      const items = s.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      handlers.onPendingApprovals(items);
    }
  ));
  // Compact "recent activity" feed only (dashboard's six rows). It is NO LONGER
  // the source of full history — the day view uses subscribeDay below, which has
  // no 50-row ceiling for a selected day.
  if (handlers.onRecentTxns) unsubs.push(onSnapshot(
    query(p.txns(), orderBy('createdAt', 'desc'), limit(50)),
    s => handlers.onRecentTxns(s.docs.map(d => ({ id: d.id, ...d.data() })))
  ));

  return () => unsubs.forEach(u => u());
}

// The two DATE-SCOPED live reads: today's completions and today's overrides. Kept
// separate from subscribe() so the caller can re-point them at local midnight —
// otherwise a query built for one calendar day keeps returning that day's docs
// after the date rolls over, and yesterday's completions/exceptions would go on
// shaping "today" until a reload. `date` is 'YYYY-MM-DD' (the current local day).
export async function subscribeToday(familyId, date, handlers = {}) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  const unsubs = [];

  if (handlers.onTodayCompletions) unsubs.push(onSnapshot(
    query(p.completions(), where('localDate', '==', date)),
    // Carry status so the child UI can tell "waiting for Mom" (pending) apart from
    // approved. Legacy docs predate the field, so a missing status reads approved.
    // approvedBy lets the child's approval toast name the actual approving parent
    // instead of a hard-coded "Mom" (§7.1). questTitle + createdAt (`at`) are
    // carried so the parent Quest Log can render a titled, time-ordered history
    // even if the quest was later edited/deleted; the child UI ignores the extras.
    s => handlers.onTodayCompletions(s.docs.map(d => {
      const data = d.data();
      return {
        questId: data.questId,
        status: data.status || 'approved',
        approvedBy: data.approvedBy || null,
        questTitle: data.questTitle || null,
        at: data.createdAt || null
      };
    }))
  ));
  // Today's quest overrides (§17.5/§17.6). Single-field equality on `date` (auto
  // indexed); the map (questId → { action, window }) feeds planDay for BOTH the
  // child and the parent Today view, so a one-day exception applies everywhere and
  // auto-returns tomorrow because tomorrow's query simply won't match these docs.
  if (handlers.onDayOverrides) unsubs.push(onSnapshot(
    query(p.dayOverrides(), where('date', '==', date)),
    s => {
      const map = {};
      s.forEach(d => {
        const data = d.data();
        if (data.questId && data.action) map[data.questId] = { action: data.action, window: data.window || null };
      });
      handlers.onDayOverrides(map);
    }
  ));

  return () => unsubs.forEach(u => u());
}

// Live history for ONE activity date, with no row ceiling. Legacy rows carry
// only `localDate`, so we union an activityDate query with a localDate query and
// let the caller place each row by its normalized activity date — a new quest
// approved the next day matches localDate for the approval day but still belongs
// under its completion day. Both are single-field equality queries (auto
// indexed); rows are merged by id and the caller sorts, so no composite index is
// needed. Returns an unsubscribe that tears down BOTH listeners (§12).
export async function subscribeDay(familyId, date, cb) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  let byActivity = null, byLocal = null;
  const toRows = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const emit = () => {
    if (byActivity === null || byLocal === null) return; // wait for both first snapshots
    const merged = new Map();
    for (const d of byActivity) merged.set(d.id, d);
    for (const d of byLocal) if (!merged.has(d.id)) merged.set(d.id, d);
    cb([...merged.values()]);
  };
  const uA = onSnapshot(query(p.txns(), where('activityDate', '==', date)), s => { byActivity = toRows(s); emit(); });
  const uL = onSnapshot(query(p.txns(), where('localDate', '==', date)), s => { byLocal = toRows(s); emit(); });
  return () => { uA(); uL(); };
}

// Which dates in a visible range contain activity, for the calendar/strip dots.
// Same activityDate ∪ localDate union so legacy rows still light up their day.
export async function subscribeRangeActivity(familyId, dates, cb) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  if (!dates.length) { cb(new Set()); return () => {}; }
  let a = null, l = null;
  const emit = () => {
    if (a === null || l === null) return;
    const marked = new Set();
    for (const d of [...a, ...l]) {
      const day = d.activityDate || d.localDate;
      if (day && dates.includes(day)) marked.add(day);
    }
    cb(marked);
  };
  const toRows = s => s.docs.map(d => d.data());
  const uA = onSnapshot(query(p.txns(), where('activityDate', 'in', dates)), s => { a = toRows(s); emit(); });
  const uL = onSnapshot(query(p.txns(), where('localDate', 'in', dates)), s => { l = toRows(s); emit(); });
  return () => { uA(); uL(); };
}

// Live raw transactions for a seven-day reflection range. Like subscribeDay,
// union activityDate + legacy localDate queries and let the caller normalize
// placement. Seven dates stay safely under Firestore's `in` query limit.
export async function subscribeRangeTransactions(familyId, dates, cb) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  if (!dates.length) { cb([]); return () => {}; }
  let a = null, l = null;
  const toRows = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const emit = () => {
    if (a === null || l === null) return;
    const merged = new Map();
    for (const d of a) merged.set(d.id, d);
    for (const d of l) if (!merged.has(d.id)) merged.set(d.id, d);
    cb([...merged.values()]);
  };
  const uA = onSnapshot(query(p.txns(), where('activityDate', 'in', dates)), s => { a = toRows(s); emit(); });
  const uL = onSnapshot(query(p.txns(), where('localDate', 'in', dates)), s => { l = toRows(s); emit(); });
  return () => { uA(); uL(); };
}

// Derived "today" totals for the dashboard, computed from the ledger so there is
// never a reset counter to get out of sync. "Used" now means SCREEN TIME ONLY —
// behavior deductions and corrections are excluded (§8.2). Rows are placed by
// activity date to match the day view.
export function todayTotals(recentTxns) {
  const today = localDate();
  const day = recentTxns
    .map(t => normalizeTransaction(t))
    .filter(t => t.activityDate === today);
  const s = summarizeDay(day);
  return {
    earned: s.earnedPoints,
    used: s.usedMinutes,
    roomToGrow: s.roomToGrowPoints,
    corrections: s.corrections
  };
}

// --- Writes ------------------------------------------------------------------

// Parent point adjustment (quick action or custom). Positive changes build Bond
// on the active cat.
export async function adjustPoints(familyId, uid, { amount, reasonCode, reasonLabel, note = '', deviceId = 'phone', activityDate: activityDateInput } = {}) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);

  const code = reasonCode || 'custom';
  const preset = reasonCode ? QUICK_ACTION_BY_CODE[reasonCode] : null;
  // requestedDelta is the FULL rule amount. The applied delta may be smaller
  // when the zero floor absorbs part of a deduction — but the row still records
  // the full rule so the growth record never shows -1/+0 for a -2 event.
  const requestedDelta = preset ? preset.amount : Number(amount) || 0;
  const label = reasonLabel || (preset ? preset.label : 'Custom adjustment');
  // An immediate parent point uses the selected activity date, defaulting to
  // today (§9.1); posted time is always now.
  const activityDate = activityDateInput || localDate();
  // Generate the transaction id up front so the linked recognition event has a
  // stable, source-derived id even if the transaction retries internally — a
  // retry can never mint a second event (§11).
  const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));

  await runTransaction(database, async (tx) => {
    const createdByName = await readMemberName(tx, p, uid);
    const childSnap = await tx.get(p.child());
    const child = childSnap.data();
    const integrity = amountIntegrity(child.available || 0, requestedDelta, { allowNegative: false });

    // Positive recognition builds Bond on the active cat; record configured vs
    // actually-applied so a future correction can reverse only the real delta.
    let catId = null, bondRequested = 0, bondApplied = 0;
    if (integrity.amount > 0) {
      catId = child.activeCatId;
      bondRequested = preset ? preset.bond : CUSTOM_POSITIVE_BOND;
      const catRef = p.cat(catId);
      const catSnap = await tx.get(catRef);
      const cat = catSnap.data();
      const bondBefore = cat.bond || 0;
      const bondAfter = clamp(bondBefore + bondRequested, 0, CAPS.bond);
      bondApplied = bondAfter - bondBefore;
      tx.update(catRef, { bond: bondAfter });
    }
    tx.update(p.child(), { available: integrity.balanceAfter });

    const rewardRequested = { ...ZERO_REWARD, bond: bondRequested };
    const rewardApplied = { ...ZERO_REWARD, bond: bondApplied };
    tx.set(txnRef, {
      schemaVersion: SCHEMA_VERSION,
      childId: CHILD_ID,
      kind: 'adjust',
      category: classifyTransaction({ kind: 'adjust', reasonCode: code, requestedAmount: requestedDelta }),
      reasonCode: code, reasonLabel: label, note: note || '',
      requestedAmount: integrity.requestedAmount,
      amount: integrity.amount,
      balanceBefore: integrity.balanceBefore,
      balanceAfter: integrity.balanceAfter,
      activityDate,
      createdBy: uid, createdByName, deviceId,
      createdAt: serverTimestamp(),
      localDate: localDate(), timeLabel: localTimeLabel(),
      questCompletionId: null, questAttemptId: null,
      relatedTransactionId: null, reversesTransactionId: null,
      catId,
      rewardRequested, rewardApplied,
      // Legacy scalar mirrors so any un-migrated reader still balances. These are
      // the actually-applied values, never the pre-cap request.
      bond: bondApplied, coins: 0, brain: 0, energy: 0
    });

    // An immediate POSITIVE recognition (Good Choice, Yes ma'am/sir, a custom
    // +1, Hero's Reset) atomically creates one durable "You were noticed!" event
    // linked to this transaction (§7.1). Behavior deductions, screen time, and
    // corrections never do. The point is already credited above — this event is
    // only the celebration's delivery record, keyed to the transaction so a
    // retry can't duplicate it.
    if (requestedDelta > 0) {
      tx.set(p.feedback(recognitionEventId(txnRef.id)), {
        recipientChildId: CHILD_ID,
        type: FEEDBACK_TYPE.RECOGNITION,
        sourceTransactionId: txnRef.id,
        sourceQuestCompletionId: null,
        sourceQuestAttemptId: null,
        actorId: uid,
        actorName: createdByName,
        amount: requestedDelta,
        reasonLabel: label,
        parentNote: note || '',
        activityDate,
        createdAt: serverTimestamp(),
        deliveryStatus: DELIVERY.PENDING,
        claimedByClientId: null,
        claimedAt: null,
        seenAt: null
      });
    }
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
      // Unique per attempt (the document id is reusable on retry). Approval
      // copies this onto the ledger row so returned-quest feedback (Slice 2)
      // can never collide with a later retry.
      attemptId: newAttemptId(),
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

    const createdByName = await readMemberName(tx, p, uid);
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
    const availableBefore = child.available || 0;
    const availableAfter = availableBefore + points;
    const childUpdate = {
      available: availableAfter,
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
    // become available — but filed under the quest's ACTIVITY date (its
    // completion day), even when approved after midnight (§9.3). rewardApplied
    // records the true capped deltas so a future correction never subtracts cat
    // progress that a cap prevented from ever landing.
    const rewardRequested = { bond: QUEST_BOND, brain, energy, coins };
    const rewardApplied = {
      bond: nextCat.bond - (cat.bond || 0),
      brain: nextCat.brain - (cat.brain || 0),
      energy: nextCat.energy - (cat.energy || 0),
      coins
    };
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      schemaVersion: SCHEMA_VERSION,
      childId: CHILD_ID,
      kind: 'quest',
      category: CATEGORY.EARNED,
      questId: comp.questId,
      reasonCode: 'quest', reasonLabel: `Quest: ${title}`, note: '',
      requestedAmount: points,
      amount: points,
      balanceBefore: availableBefore,
      balanceAfter: availableAfter,
      activityDate: comp.localDate || approvalDate,
      createdBy: uid, createdByName, deviceId: 'phone',
      createdAt: serverTimestamp(),
      localDate: approvalDate, timeLabel: localTimeLabel(new Date(nowMs)),
      questCompletionId: completionId,
      questAttemptId: comp.attemptId || null,
      relatedTransactionId: null, reversesTransactionId: null,
      catId,
      rewardRequested, rewardApplied,
      // Legacy scalar mirrors (actually-applied values).
      bond: rewardApplied.bond, coins, brain: rewardApplied.brain, energy: rewardApplied.energy
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

    const createdByName = await readMemberName(tx, p, uid);
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
    const availableBefore = child.available || 0;
    const availableAfter = availableBefore + points;
    const childUpdate = {
      available: availableAfter,
      coins: (child.coins || 0) + coins
    };
    if (charge.granted) {
      childUpdate.careCharges = charge.after;
      childUpdate.lastCareCompletionId = completionId;
    }
    tx.update(p.child(), childUpdate);

    // Reuse the pending attempt's id when Sirus already tapped; otherwise this
    // parent-initiated completion mints its own attempt identity.
    const attemptId = (existing && existing.attemptId) || newAttemptId();
    const rewards = { points, brain, energy, coins, bond: QUEST_BOND };
    if (existing) {
      tx.update(p.completion(completionId), {
        status: 'approved', rewards, attemptId,
        careChargeGranted: existing.careChargeGranted === true || charge.granted,
        approvedBy: uid, approvedAt: serverTimestamp()
      });
    } else {
      tx.set(p.completion(completionId), {
        childId: CHILD_ID, questId, questTitle: title,
        localDate: today, status: 'approved', activeCatId: catId, rewards,
        careChargeGranted: charge.granted, attemptId,
        createdBy: uid, createdAt: serverTimestamp(),
        approvedBy: uid, approvedAt: serverTimestamp()
      });
    }

    const rewardRequested = { bond: QUEST_BOND, brain, energy, coins };
    const rewardApplied = {
      bond: nextCat.bond - (cat.bond || 0),
      brain: nextCat.brain - (cat.brain || 0),
      energy: nextCat.energy - (cat.energy || 0),
      coins
    };
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      schemaVersion: SCHEMA_VERSION,
      childId: CHILD_ID,
      kind: 'quest',
      category: CATEGORY.EARNED,
      questId,
      reasonCode: 'quest', reasonLabel: `Quest: ${title}`, note: '',
      requestedAmount: points,
      amount: points,
      balanceBefore: availableBefore,
      balanceAfter: availableAfter,
      activityDate: today,
      createdBy: uid, createdByName, deviceId: 'phone',
      createdAt: serverTimestamp(),
      localDate: today, timeLabel: localTimeLabel(),
      questCompletionId: completionId,
      questAttemptId: attemptId,
      relatedTransactionId: null, reversesTransactionId: null,
      catId,
      rewardRequested, rewardApplied,
      bond: rewardApplied.bond, coins, brain: rewardApplied.brain, energy: rewardApplied.energy
    });
  });
}

// Parent rejects a pending completion → return it to Sirus. Slice 2 makes this
// atomic: one gentle `quest_returned` feedback event is created BEFORE the
// pending completion is removed, so the "sent back" message can never be lost by
// the delete winning a race (§7.0, D-12). The event keys on the unique attempt
// id (the completion doc id is reusable on same-day retry), so a later retry of
// the same quest can't collide with this return notice. No point/correction row
// is written and the already-granted Care Charge is never clawed back.
export async function rejectCompletion(familyId, uid, completion) {
  const completionId = completion && (completion.id || completion);
  if (!completionId) return;
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);

  await runTransaction(database, async (tx) => {
    const compSnap = await tx.get(p.completion(completionId));
    if (!compSnap.exists()) return; // already gone — nothing to return
    const comp = compSnap.data();
    if (comp.status && comp.status !== 'pending') return; // only a pending attempt is returned
    const createdByName = await readMemberName(tx, p, uid);
    // Fall back to a fresh attempt id only for a legacy completion filed before
    // attempt ids shipped, so the event still has a stable, unique identity.
    const attemptId = comp.attemptId || newAttemptId();

    tx.set(p.feedback(questReturnedEventId(attemptId)), {
      recipientChildId: CHILD_ID,
      type: FEEDBACK_TYPE.QUEST_RETURNED,
      sourceTransactionId: null,
      sourceQuestCompletionId: completionId,
      sourceQuestAttemptId: attemptId,
      actorId: uid || null,
      actorName: createdByName,
      amount: 0,
      reasonLabel: comp.questTitle || 'Quest',
      parentNote: '',
      activityDate: comp.localDate || localDate(),
      createdAt: serverTimestamp(),
      deliveryStatus: DELIVERY.PENDING,
      claimedByClientId: null,
      claimedAt: null,
      seenAt: null
    });
    tx.delete(p.completion(completionId));
  });
}

// --- Family feedback delivery (child) ---------------------------------------
// Child-only subscription to UNSEEN feedback. Filter on deliveryStatus (a single
// `in`, auto-indexed) so the result set stays bounded to what's still to show;
// the recipient filter and ordering happen in memory (one child, small volume),
// so no composite index is needed (§12).
export async function subscribeFeedback(familyId, childId, cb) {
  const { database, sdk } = await fs();
  const { onSnapshot, query, where } = sdk;
  const p = paths(sdk, database, familyId);
  const q = query(p.feedbacks(), where('deliveryStatus', 'in', [DELIVERY.PENDING, DELIVERY.CLAIMED]));
  return onSnapshot(q, s => {
    const events = s.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.recipientChildId === childId);
    cb(events);
  }, () => cb([]));
}

// Atomically claim a set of events for display. Only events still claimable by
// this client (pending, mine, or stale) are taken, so two devices can't show the
// same event; a crashed client's claim goes stale and recovers (§7.0). Returns
// the events actually claimed by this call.
export async function claimFeedback(familyId, eventIds, clientId) {
  if (!eventIds || !eventIds.length) return [];
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const nowMs = Date.now();
  return runTransaction(database, async (tx) => {
    const reads = [];
    for (const id of eventIds) reads.push({ id, snap: await tx.get(p.feedback(id)) });
    const claimed = [];
    for (const { id, snap } of reads) {
      if (!snap.exists()) continue;
      const ev = snap.data();
      if (!isClaimable(ev, clientId, nowMs)) continue;
      tx.update(p.feedback(id), {
        deliveryStatus: DELIVERY.CLAIMED,
        claimedByClientId: clientId,
        claimedAt: serverTimestamp()
      });
      claimed.push({ id, ...ev });
    }
    return claimed;
  });
}

// Mark events seen once their card has actually rendered, so a transaction never
// celebrates again after reload, navigation, or reconnect (§7.3, §12).
export async function markFeedbackSeen(familyId, eventIds) {
  if (!eventIds || !eventIds.length) return;
  const { database, sdk } = await fs();
  const { writeBatch, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const batch = writeBatch(database);
  for (const id of eventIds) {
    batch.update(p.feedback(id), { deliveryStatus: DELIVERY.SEEN, seenAt: serverTimestamp() });
  }
  await batch.commit();
}

// Parent records screen time used — draws down the available balance. An
// over-limit request is BLOCKED, not silently clamped (§10.3): the caller learns
// the current maximum and the row's requested and applied amounts always agree.
// The thrown error carries the available minutes so the UI can show the max.
export async function redeemScreenTime(familyId, uid, minutes, { deviceId = 'phone', note = '' } = {}) {
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);
  const use = Math.max(0, Number(minutes) || 0);

  await runTransaction(database, async (tx) => {
    const createdByName = await readMemberName(tx, p, uid);
    const childSnap = await tx.get(p.child());
    const before = childSnap.data().available || 0;
    if (use > before) {
      const err = new Error('screen-time-over-limit');
      err.available = before;
      throw err;
    }
    const integrity = amountIntegrity(before, -use, { allowNegative: false });
    tx.update(p.child(), { available: integrity.balanceAfter });
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      schemaVersion: SCHEMA_VERSION,
      childId: CHILD_ID,
      kind: 'redeem',
      category: CATEGORY.USED,
      reasonCode: 'screen_time', reasonLabel: 'Screen time used', note: note || '',
      requestedAmount: integrity.requestedAmount,
      amount: integrity.amount,
      balanceBefore: integrity.balanceBefore,
      balanceAfter: integrity.balanceAfter,
      activityDate: localDate(),
      createdBy: uid, createdByName, deviceId,
      createdAt: serverTimestamp(),
      localDate: localDate(), timeLabel: localTimeLabel(),
      questCompletionId: null, questAttemptId: null,
      relatedTransactionId: null, reversesTransactionId: null,
      catId: null,
      rewardRequested: { ...ZERO_REWARD }, rewardApplied: { ...ZERO_REWARD },
      bond: 0, coins: 0, brain: 0, energy: 0
    });
  });
}

// The cat-progress deltas a reversal may safely undo. A v2 row records exactly
// what caps let land (rewardApplied), so that is reversed precisely. A legacy
// row has NO proof its stored brain/energy/bond ever landed (a cap may have
// swallowed part of it), so those are preserved, not guessed — only the exact
// minutes and uncapped coins are reversed (§8.4, §13.12). Coins have no cap, so
// the legacy coins field is a reliable applied value.
function reversibleEffects(txn) {
  const applied = txn.rewardApplied;
  if (applied) {
    return {
      brain: Number(applied.brain || 0),
      energy: Number(applied.energy || 0),
      bond: Number(applied.bond || 0),
      coins: Number(applied.coins || 0),
      ambiguousCat: false
    };
  }
  return {
    brain: 0, energy: 0, bond: 0,
    coins: Number(txn.coins || 0),
    // A legacy row that claims cat progress we cannot prove was applied.
    ambiguousCat: !!(txn.catId && (txn.brain || txn.energy || txn.bond))
  };
}

// Read the child (and, if the entry provably touched a cat, that cat) up front,
// then reverse the entry's effects. Firestore transactions require ALL reads
// before ANY writes. Returns the applied balance/coin/cat deltas so a linked
// correction row can record exactly what it reversed.
async function reverseEntry(tx, p, familyId, sdk, txn) {
  const childSnap = await tx.get(p.child());
  const child = childSnap.data();
  const effects = reversibleEffects(txn);
  let catRef = null, catSnap = null;
  if (txn.catId && (effects.brain || effects.energy || effects.bond)) {
    catRef = p.cat(txn.catId);
    catSnap = await tx.get(catRef);
  }
  // ---- writes ----
  const availableBefore = child.available || 0;
  const availableAfter = Math.max(0, availableBefore - Number(txn.amount || 0));
  const childUpdate = { available: availableAfter };
  if (effects.coins) childUpdate.coins = Math.max(0, (child.coins || 0) - effects.coins);
  tx.update(p.child(), childUpdate);
  if (catSnap) {
    const cat = catSnap.data();
    const next = {
      brain: clamp((cat.brain || 0) - effects.brain, 0, CAPS.brain),
      energy: clamp((cat.energy || 0) - effects.energy, 0, CAPS.energy),
      bond: clamp((cat.bond || 0) - effects.bond, 0, CAPS.bond)
    };
    next.evolved = cat.evolved || isHeroReady({ ...cat, ...next });
    tx.update(catRef, next);
  }
  // If reversing a quest, clear its completion so it can be earned again today.
  if (txn.kind === 'quest' && txn.questId) {
    tx.delete(p.completion(txn.questCompletionId || `${CHILD_ID}_${txn.questId}_${txn.activityDate || txn.localDate}`));
  }
  return { availableBefore, availableAfter, effects };
}

// Undo = a compensating "correction" transaction that reverses the last entry's
// effects, preserving history (never a silent delete). The correction links back
// to the original via reversesTransactionId, copies the original's activity date,
// and records only the effects that were actually reversed — so an ambiguous
// legacy cat reward is preserved rather than over-subtracted.
export async function undoLast(familyId, uid, lastTxn) {
  if (!lastTxn) return;
  const { database, sdk } = await fs();
  const { runTransaction, serverTimestamp, doc, collection } = sdk;
  const p = paths(sdk, database, familyId);

  await runTransaction(database, async (tx) => {
    const createdByName = await readMemberName(tx, p, uid);
    const { availableBefore, availableAfter, effects } = await reverseEntry(tx, p, familyId, sdk, lastTxn);
    const reversed = {
      bond: -effects.bond, brain: -effects.brain,
      energy: -effects.energy, coins: -effects.coins
    };
    const txnRef = doc(collection(database, 'families', familyId, 'pointTransactions'));
    tx.set(txnRef, {
      schemaVersion: SCHEMA_VERSION,
      childId: CHILD_ID,
      kind: 'correction',
      category: CATEGORY.CORRECTION,
      reasonCode: 'undo', reasonLabel: `Undo: ${lastTxn.reasonLabel || 'last action'}`, note: '',
      requestedAmount: availableAfter - availableBefore,
      amount: availableAfter - availableBefore,
      balanceBefore: availableBefore,
      balanceAfter: availableAfter,
      // A correction copies the original's activity date and receives a fresh
      // posted time (§11).
      activityDate: lastTxn.activityDate || lastTxn.localDate || localDate(),
      createdBy: uid, createdByName, deviceId: 'phone',
      createdAt: serverTimestamp(),
      localDate: localDate(), timeLabel: localTimeLabel(),
      questCompletionId: null, questAttemptId: null,
      relatedTransactionId: null,
      reversesTransactionId: lastTxn.id || null,
      catId: lastTxn.catId || null,
      rewardRequested: reversed, rewardApplied: reversed,
      bond: reversed.bond, coins: reversed.coins, brain: reversed.brain, energy: reversed.energy
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

// --- Today-only overrides (§17.5 "For today", §17.6 "Today Is Different") ----
// A one-day exception is a SCHEDULE action, never a point deduction. It is keyed
// by quest + local date, so it applies only to today and auto-returns tomorrow
// (tomorrow's date-scoped subscription simply won't match these docs). The
// going-forward template is never touched — a parent must never rewrite every
// future Tuesday to fix one Monday.
const OVERRIDE_ACTIONS = ['skip', 'move', 'next'];
function dayOverrideId(questId, date) { return `${questId}_${date}`; }

export async function setDayOverride(familyId, uid, questId, action, window = null) {
  if (!OVERRIDE_ACTIONS.includes(action)) throw new Error('bad-override-action');
  const { database, sdk } = await fs();
  const { setDoc, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const date = localDate();
  const data = { questId, date, action, at: serverTimestamp(), by: uid };
  if (action === 'move' && window) data.window = window;
  await setDoc(p.dayOverride(dayOverrideId(questId, date)), data);
}

export async function clearDayOverride(familyId, questId) {
  const { database, sdk } = await fs();
  const { deleteDoc } = sdk;
  const p = paths(sdk, database, familyId);
  await deleteDoc(p.dayOverride(dayOverrideId(questId, localDate())));
}

// "Today Is Different" presets (§17.6). Writes a batch of today-only skip
// overrides over the quests the preset applies to — computed by the pure
// presetTargets() so recurrence can't leak a not-due quest in. `custom` writes
// nothing (the parent uses the per-quest Skip / Move / Next controls directly).
// Auto-return is inherent — these are date-keyed like any single override.
// Presets never disable a quest or deduct points; tomorrow returns to normal.
export async function applyTodayPreset(familyId, uid, preset, quests = []) {
  if (preset === 'custom') return { skipped: 0 }; // per-quest controls; write nothing
  if (!['sick', 'out', 'school_off', 'easy_morning'].includes(preset)) throw new Error('bad-preset');
  const { database, sdk } = await fs();
  const { writeBatch, serverTimestamp } = sdk;
  const p = paths(sdk, database, familyId);
  const date = localDate();
  const targets = presetTargets(quests, preset, date);

  const batch = writeBatch(database);
  for (const q of targets) {
    batch.set(p.dayOverride(dayOverrideId(q.id, date)), {
      questId: q.id, date, action: 'skip', at: serverTimestamp(), by: uid, preset
    });
  }
  await batch.commit();
  return { skipped: targets.length };
}
