import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEEDBACK_TYPE, DELIVERY, CLAIM_LEASE_MS,
  recognitionEventId, questReturnedEventId, toMillis,
  isClaimable, partitionFeedback, bundleRecognitions
} from '../src/shared/feedback.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = 'client-A';
const NOW = 1_000_000_000_000;

// --- Source-derived identity (§11) ------------------------------------------
assert.equal(recognitionEventId('txn123'), 'pt_txn123');
assert.equal(questReturnedEventId('att999'), 'qr_att999');
// Same source → same id, so a retried write can't duplicate the event.
assert.equal(recognitionEventId('txn123'), recognitionEventId('txn123'));

// --- Timestamp coercion -----------------------------------------------------
assert.equal(toMillis(1234), 1234);
assert.equal(toMillis({ seconds: 2 }), 2000);
assert.equal(toMillis({ toMillis: () => 5000 }), 5000);
assert.equal(toMillis(null), 0);

// --- Claim lease / eligibility (§7.0) ---------------------------------------
const pending = { deliveryStatus: DELIVERY.PENDING };
assert.equal(isClaimable(pending, CLIENT, NOW), true, 'pending is claimable');

const seen = { deliveryStatus: DELIVERY.SEEN };
assert.equal(isClaimable(seen, CLIENT, NOW), false, 'seen is never claimable again');

const mine = { deliveryStatus: DELIVERY.CLAIMED, claimedByClientId: CLIENT, claimedAt: NOW };
assert.equal(isClaimable(mine, CLIENT, NOW + 1000), true, 'my own fresh claim stays mine');

const theirsFresh = { deliveryStatus: DELIVERY.CLAIMED, claimedByClientId: 'other', claimedAt: NOW };
assert.equal(isClaimable(theirsFresh, CLIENT, NOW + 1000), false, 'another device holds a fresh claim');

const theirsStale = { deliveryStatus: DELIVERY.CLAIMED, claimedByClientId: 'other', claimedAt: NOW };
assert.equal(isClaimable(theirsStale, CLIENT, NOW + CLAIM_LEASE_MS + 1), true, 'a stale claim recovers');

// --- Partition: recognitions bundle, returns stay separate (§7.3) -----------
const events = [
  { id: 'r1', type: FEEDBACK_TYPE.RECOGNITION, deliveryStatus: DELIVERY.PENDING, createdAt: { seconds: 30 }, amount: 1, actorName: 'Mom', reasonLabel: 'Helped Arlo' },
  { id: 'q1', type: FEEDBACK_TYPE.QUEST_RETURNED, deliveryStatus: DELIVERY.PENDING, createdAt: { seconds: 20 }, reasonLabel: 'Morning routine' },
  { id: 'r2', type: FEEDBACK_TYPE.RECOGNITION, deliveryStatus: DELIVERY.PENDING, createdAt: { seconds: 10 }, amount: 1, actorName: 'Abba', reasonLabel: 'Calm words' },
  { id: 'seen1', type: FEEDBACK_TYPE.RECOGNITION, deliveryStatus: DELIVERY.SEEN, createdAt: { seconds: 5 }, amount: 1 }
];
const { recognitions, returns } = partitionFeedback(events, CLIENT, NOW);
assert.deepEqual(recognitions.map(e => e.id), ['r2', 'r1'], 'recognitions are oldest-first and exclude seen');
assert.deepEqual(returns.map(e => e.id), ['q1'], 'returns are separate from recognitions');

// --- Bundling (§7.3) --------------------------------------------------------
const single = bundleRecognitions([recognitions[0]]);
assert.equal(single.bundled, false);
assert.equal(single.count, 1);
assert.equal(single.totalAmount, 1);
assert.deepEqual(single.ids, ['r2']);

const many = bundleRecognitions(recognitions);
assert.equal(many.bundled, true);
assert.equal(many.count, 2);
assert.equal(many.totalAmount, 2, 'bundle sums the recognized minutes');
assert.equal(many.lines.length, 2);
assert.equal(many.lines[0].actorName, 'Abba');

// --- Static integration checks (no emulator) --------------------------------
const store = readFileSync(join(ROOT, 'src/store.js'), 'utf8');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');

assert.match(store, /familyFeedback/, 'store writes the shared feedback collection');
assert.match(store, /recognitionEventId\(/, 'recognition events use the source-derived id');
assert.match(store, /questReturnedEventId\(/, 'returned-quest events use the attempt id');
assert.match(store, /FEEDBACK_TYPE\.RECOGNITION/, 'store creates recognition events');
assert.match(store, /FEEDBACK_TYPE\.QUEST_RETURNED/, 'store creates returned-quest events');
assert.match(store, /export async function subscribeFeedback/, 'child can subscribe to feedback');
assert.match(store, /export async function claimFeedback/, 'delivery claims events under a lease');
assert.match(store, /export async function markFeedbackSeen/, 'delivery marks events seen');

assert.match(rules, /familyFeedback/, 'rules cover the feedback collection');
assert.match(rules, /hasOnly\(\['deliveryStatus'/, 'child may change only the delivery fields');

assert.match(app, /partitionFeedback\(/, 'the child shell partitions waiting feedback');
assert.match(app, /You were noticed/, 'the recognition card exists');

console.log('Family-feedback delivery: all checks passed.');
