import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PAIRING_TTL_MINUTES, PAIRING_TTL_MS, PAIRING_FIELDS, PAIRING_CONSUME_FIELDS,
  generatePairingCode, isPairingCodeShape, timestampMs, pairingExpiresAtMs,
  pairingRejection, isPairingUsable, pairingErrorMessage
} from '../src/shared/pairing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Code shape ---------------------------------------------------------------
// Six digits, no leading zero, so the tablet keypad always takes exactly six.
for (const r of [0, 0.5, 0.999999, 0.123456, 0.7]) {
  const code = generatePairingCode(() => r);
  assert.equal(code.length, 6, `code from rand=${r} must be 6 chars`);
  assert.ok(isPairingCodeShape(code), `code from rand=${r} must match the shape`);
}
assert.equal(generatePairingCode(() => 0), '100000', 'lowest code');
assert.equal(generatePairingCode(() => 0.9999999), '999999', 'highest code');

assert.equal(isPairingCodeShape('012345'), false, 'leading zero is not a code we mint');
assert.equal(isPairingCodeShape('12345'), false, 'too short');
assert.equal(isPairingCodeShape('1234567'), false, 'too long');
assert.equal(isPairingCodeShape('12345a'), false, 'digits only');
assert.equal(isPairingCodeShape(123456), false, 'must be a string');
assert.equal(isPairingCodeShape(null), false);
assert.equal(isPairingCodeShape(''), false);

// --- Timestamp coercion -------------------------------------------------------
assert.equal(timestampMs(1000), 1000);
assert.equal(timestampMs(new Date(1000)), 1000);
assert.equal(timestampMs({ toMillis: () => 1000 }), 1000, 'Firestore Timestamp');
assert.equal(timestampMs({ seconds: 2, nanoseconds: 0 }), 2000, 'raw timestamp shape');
assert.equal(timestampMs(null), null);
assert.equal(timestampMs(undefined), null);
assert.equal(timestampMs({}), null, 'an unresolved serverTimestamp sentinel reads as null');
assert.equal(timestampMs(NaN), null);

// --- The usability predicate (mirrors the rules' validPairing) ----------------
const NOW = 1_700_000_000_000;
const alive = () => ({
  familyId: 'fam-1', role: 'child', active: true, createdAt: NOW, createdBy: 'mom'
});

assert.equal(pairingRejection(alive(), 'child', NOW), null, 'a fresh child code is usable');
assert.equal(isPairingUsable(alive(), 'child', NOW), true);

// Missing / malformed.
assert.equal(pairingRejection(null, 'child', NOW), 'missing');
assert.equal(pairingRejection(undefined, 'child', NOW), 'missing');
assert.equal(pairingRejection({ ...alive(), familyId: '' }, 'child', NOW), 'missing');
assert.equal(pairingRejection({ ...alive(), familyId: 42 }, 'child', NOW), 'missing');

// Single use: an already-redeemed code is dead, by either marker.
assert.equal(pairingRejection({ ...alive(), active: false }, 'child', NOW), 'consumed');
assert.equal(pairingRejection({ ...alive(), consumedAt: NOW }, 'child', NOW), 'consumed');
assert.equal(
  pairingRejection({ ...alive(), active: true, consumedAt: NOW }, 'child', NOW), 'consumed',
  'a consumedAt stamp kills the code even if active was left true'
);

// Role confinement: a child code can never grant the parent role, or vice versa.
assert.equal(pairingRejection(alive(), 'parent', NOW), 'wrong-role');
assert.equal(pairingRejection({ ...alive(), role: 'parent' }, 'child', NOW), 'wrong-role');
assert.equal(pairingRejection({ ...alive(), role: 'admin' }, 'child', NOW), 'wrong-role');
assert.equal(pairingRejection({ ...alive(), role: undefined }, 'child', NOW), 'wrong-role');

// Expiry, at the boundary.
assert.equal(PAIRING_TTL_MS, PAIRING_TTL_MINUTES * 60 * 1000);
assert.equal(pairingExpiresAtMs(alive()), NOW + PAIRING_TTL_MS);
assert.equal(pairingExpiresAtMs({ createdAt: null }), null);
assert.equal(
  pairingRejection(alive(), 'child', NOW + PAIRING_TTL_MS - 1), null,
  'usable up to the last millisecond'
);
assert.equal(
  pairingRejection(alive(), 'child', NOW + PAIRING_TTL_MS), 'expired',
  'dead exactly at the window edge'
);
assert.equal(pairingRejection(alive(), 'child', NOW + PAIRING_TTL_MS + 60_000), 'expired');

// A legacy code (written before this change, so no readable createdAt) fails
// CLOSED rather than living forever. This is what retires every code that
// existed while the collection was enumerable.
assert.equal(pairingRejection({ familyId: 'f', role: 'child', active: true }, 'child', NOW), 'expired');
assert.equal(pairingRejection({ ...alive(), createdAt: {} }, 'child', NOW), 'expired');

// --- The error message is not an oracle --------------------------------------
// Every failure mode must produce the SAME text, or the pairing screen becomes a
// way to confirm which codes exist.
const childMsg = pairingErrorMessage('child');
const parentMsg = pairingErrorMessage('parent');
assert.ok(childMsg.includes('15 minutes') && childMsg.includes('once'), 'message sets expectations');
assert.ok(parentMsg.includes('15 minutes') && parentMsg.includes('once'));
assert.equal(pairingErrorMessage('anything-else'), childMsg, 'one message for every child-side failure');

// --- Security invariants of firestore.rules ----------------------------------
// This repo has no build step and no Firestore emulator, so these assert on the
// rules SOURCE. They are narrow on purpose: each one guards a specific way the
// original vulnerability could come back.
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const pairingsBlock = (() => {
  const start = rules.indexOf('match /pairings/{code}');
  assert.ok(start > -1, 'the /pairings rule block must exist');
  // Walk braces from the block's opening { to its matching close. That brace is
  // the LAST one on the match line, so the `{code}` wildcard isn't mistaken for it.
  let depth = 0;
  const open = rules.lastIndexOf('{', rules.indexOf('\n', start));
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === '{') depth++;
    else if (rules[i] === '}' && --depth === 0) return rules.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in the /pairings block');
})();

// THE bug: `allow read` covers get AND list, so it let any signed-in user (and
// anonymous sign-in is open to the world) enumerate every code in the project.
assert.doesNotMatch(
  pairingsBlock, /allow\s+[^;]*\bread\b/,
  '/pairings must never grant `read` — that includes `list`, which is enumeration'
);
assert.match(
  pairingsBlock, /allow\s+list:\s*if\s+false\s*;/,
  '/pairings must deny `list` explicitly'
);
assert.match(
  pairingsBlock, /allow\s+get:\s*if\s+signedIn\(\)\s*&&\s*pairingAlive\(resource\.data\)\s*;/,
  '/pairings `get` must be limited to codes that are still alive'
);
// Creation is pinned to a parent of the named family, a server clock, and the
// exact field set — no client-chosen expiry, no smuggled fields.
assert.match(pairingsBlock, /allow create:[\s\S]*isParent\(request\.resource\.data\.familyId\)/);
assert.match(pairingsBlock, /allow create:[\s\S]*createdAt == request\.time/);
assert.match(pairingsBlock, /allow create:[\s\S]*createdBy == request\.auth\.uid/);
for (const field of PAIRING_FIELDS) {
  assert.ok(
    new RegExp(`'${field}'`).test(pairingsBlock),
    `the create rule must pin the '${field}' field`
  );
}
// Consumption is only legal as half of a join.
assert.match(pairingsBlock, /existsAfter\(memberPath\)/, 'burning a code requires the membership');
assert.match(pairingsBlock, /getAfter\(memberPath\)\.data\.pairingCode == code/, 'and it must name THIS code');
assert.match(pairingsBlock, /getAfter\(memberPath\)\.data\.role == before\.role/, 'and take only the granted role');
assert.match(pairingsBlock, /consumedAt == request\.time/, 'the consumed stamp is server time');
assert.ok(
  PAIRING_CONSUME_FIELDS.every(f => new RegExp(`'${f}'`).test(pairingsBlock)),
  'the consume rule must pin exactly the consume fields'
);

// The TTL the rules enforce must be the TTL the client and its copy promise.
const ttlMatch = rules.match(/duration\.value\((\d+),\s*'m'\)/);
assert.ok(ttlMatch, 'the rules must express the pairing TTL as a duration');
assert.equal(
  Number(ttlMatch[1]), PAIRING_TTL_MINUTES,
  'firestore.rules and src/shared/pairing.js must agree on the window'
);

// validPairing (which gates joining a family) must itself require a live code —
// otherwise an expired or consumed code could still mint a membership.
assert.match(
  rules, /function validPairing\([\s\S]*?pairingAlive\(pairing\(code\)\)/,
  'validPairing must require the code to be alive'
);
assert.match(
  rules, /function pairingAlive\([\s\S]*?consumedAt[\s\S]*?createdAt \+ pairingTtl\(\) > request\.time/,
  'pairingAlive must check both single-use and the server-measured window'
);

console.log('Pairing codes: all checks passed.');
