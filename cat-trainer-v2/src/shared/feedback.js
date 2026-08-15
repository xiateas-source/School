// The ONE shared family-feedback delivery contract (§7.0, §11). Merged 6cc2e0d
// shipped no durable feedback queue, so My Progress Slice 2 creates the app's
// first — and only — shared family-feedback system.
//
// This module is PURE: it decides event identity, eligibility under the claim
// lease, and how waiting recognitions bundle. The store performs the atomic
// Firestore writes; the child shell drives presentation. Keeping the rules here
// means the two never disagree and they can be unit-tested without an emulator.

export const FEEDBACK_TYPE = {
  RECOGNITION: 'point_recognition',
  QUEST_RETURNED: 'quest_returned'
};

export const DELIVERY = { PENDING: 'pending', CLAIMED: 'claimed', SEEN: 'seen' };

// Fast, gentle parent return choices. Codes are stable data; labels are child-
// facing copy and may be polished later without changing stored meaning.
export const QUEST_RETURN_PRESETS = Object.freeze([
  Object.freeze({ code: 'try_again', parentLabel: 'Try again', childLabel: 'Try it one more time.' }),
  Object.freeze({ code: 'fix_one', parentLabel: 'Almost — fix one thing', childLabel: 'Almost! Fix one thing and try again.' }),
  Object.freeze({ code: 'come_see_me', parentLabel: 'Come see me', childLabel: 'Come see me and we’ll work out the next step.' })
]);

export function questReturnPreset(code) {
  return QUEST_RETURN_PRESETS.find(preset => preset.code === code) || QUEST_RETURN_PRESETS[0];
}

// Once a device claims an event for display, other devices leave it alone — but
// if that device crashes before marking it seen, the claim goes stale after the
// lease and the event becomes eligible again, so a message is never permanently
// lost (§7.0). Kept short: it only needs to outlast one card's render.
export const CLAIM_LEASE_MS = 45000;

// Source-derived, deterministic event ids so retrying the originating write can
// never create a duplicate: one event per point transaction, one per quest
// attempt. The completion document id is reusable when Sirus retries the same
// quest the same day, which is exactly why the return event keys on the unique
// attempt id instead (§11, D-18).
export function recognitionEventId(transactionId) {
  return `pt_${transactionId}`;
}
export function questReturnedEventId(attemptId) {
  return `qr_${attemptId}`;
}

// Firestore Timestamp | {seconds} | ms-number → milliseconds.
export function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

// An event is claimable by this client when it has not been seen and is either
// unclaimed, already claimed by this same client, or claimed by another client
// whose lease has expired (crash recovery) (§7.0).
export function isClaimable(ev, clientId, nowMs) {
  if (!ev || ev.deliveryStatus === DELIVERY.SEEN) return false;
  if (ev.deliveryStatus === DELIVERY.PENDING) return true;
  if (ev.deliveryStatus === DELIVERY.CLAIMED) {
    if (ev.claimedByClientId === clientId) return true;
    return nowMs - toMillis(ev.claimedAt) > CLAIM_LEASE_MS; // stale claim
  }
  return false;
}

// Split the claimable events into the positive-recognition set (which bundles)
// and the returned-quest set (which is delivered separately and never mixed into
// a positive bundle) (§7.0, §7.3). Both are ordered oldest-first so the card
// reads in the order the moments happened.
export function partitionFeedback(events, clientId, nowMs) {
  const claimable = (events || []).filter(ev => isClaimable(ev, clientId, nowMs));
  const byTime = (a, b) => toMillis(a.createdAt) - toMillis(b.createdAt);
  return {
    recognitions: claimable.filter(ev => ev.type === FEEDBACK_TYPE.RECOGNITION).sort(byTime),
    returns: claimable.filter(ev => ev.type === FEEDBACK_TYPE.QUEST_RETURNED).sort(byTime)
  };
}

// Build the card model for one or more waiting recognitions. One → a detailed
// single card; several → one bundled card ("You were noticed 3 times!"), never a
// forced sequence of full-screen cards (§7.3).
export function bundleRecognitions(recognitions) {
  const list = recognitions || [];
  const lines = list.map(e => ({
    actorName: e.actorName || 'A parent',
    reasonLabel: e.reasonLabel || '',
    parentNote: e.parentNote || '',
    amount: Number(e.amount) || 0
  }));
  return {
    count: list.length,
    totalAmount: lines.reduce((s, l) => s + l.amount, 0),
    bundled: list.length > 1,
    lines,
    ids: list.map(e => e.id)
  };
}

export function returnedQuestLine(event) {
  const preset = questReturnPreset(event && event.returnReasonCode);
  return {
    questTitle: (event && (event.questTitle || event.reasonLabel)) || 'Quest',
    message: (event && event.returnReasonLabel) || preset.childLabel,
    parentNote: (event && event.parentNote) || ''
  };
}
