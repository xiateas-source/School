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

// --- The client must NOT judge expiry -----------------------------------------
// The whole point of measuring the window from a server timestamp against server
// time is that a wrong device clock can't break pairing. That guarantee is void
// if the client refuses the code first, so the default is "no clock, no verdict".
assert.equal(
  pairingRejection(alive(), 'child'), null,
  'with no clock supplied, expiry is left to the server'
);
assert.equal(
  isPairingUsable(alive(), 'child'), true,
  'a device whose clock runs hours fast must still attempt a server-valid code'
);
{
  // The regression precisely: a code the SERVER considers alive, on a device
  // whose clock is a day ahead. Judging locally would reject it; we must not.
  const skewed = alive();
  const deviceClockADayFast = NOW + 24 * 60 * 60 * 1000;
  assert.equal(
    pairingRejection(skewed, 'child', deviceClockADayFast), 'expired',
    'sanity: with that clock, a local verdict WOULD reject it'
  );
  assert.equal(
    pairingRejection(skewed, 'child'), null,
    'so production must not ask for a local verdict'
  );
}
// Clock-independent failures are still caught before any write, so an obviously
// dead code costs no round trip.
assert.equal(pairingRejection(null, 'child'), 'missing');
assert.equal(pairingRejection({ ...alive(), active: false }, 'child'), 'consumed');
assert.equal(pairingRejection({ ...alive(), consumedAt: NOW }, 'child'), 'consumed');
assert.equal(pairingRejection(alive(), 'parent'), 'wrong-role');

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
{
  // The mutable-field allowlist must be EXACTLY the three lifecycle fields —
  // asserting only that they are *mentioned* would let an extra entry through,
  // and one extra entry (familyId) is the whole cross-family exploit. Everything
  // absent from this list is immutable on the only permitted update, which is
  // what makes familyId / role / createdAt / createdBy unrewritable.
  const hasOnly = pairingsBlock.match(/affectedKeys\(\)\.hasOnly\(\[([^\]]*)\]\)/);
  assert.ok(hasOnly, 'the consume rule must constrain affectedKeys with hasOnly');
  const listed = hasOnly[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(
    listed.slice().sort(), PAIRING_CONSUME_FIELDS.slice().sort(),
    'redemption may touch exactly active/consumedAt/consumedBy — nothing else'
  );
  for (const immutable of ['familyId', 'role', 'createdAt', 'createdBy']) {
    assert.ok(
      !listed.includes(immutable),
      `${immutable} must NOT be writable on an update (that is the cross-family exploit)`
    );
  }
}

// --- Cross-family authorization on UPDATE ------------------------------------
// The vulnerability this guards (found in review of PR #56): the update rule
// used to read
//
//   allow update: if (signedIn() && isParent(resource.data.familyId)) || consumesPairing();
//
// The parent branch authorized on the PRE-write familyId and then constrained
// the POST-write document not at all — and `create`'s field pinning does not
// apply to an update. So a parent of family A could mint a code for A, rewrite
// it to {familyId: B, role: 'child', createdAt: <any>}, and redeem it to join
// victim family B. The fix removes the branch: redemption is the only legal
// update. These assertions prove the branch cannot come back.
assert.match(
  pairingsBlock, /allow update: if consumesPairing\(\);/,
  'redemption must be the ONLY authorized update'
);
{
  // Pull out every `allow update` line and require exactly one, delegating
  // wholly to consumesPairing(). Any `||` branch, or any mention of isParent,
  // would be a second authorization path.
  const updateLines = pairingsBlock.split('\n').filter(l => /allow\s+[^;]*\bupdate\b/.test(l));
  assert.equal(updateLines.length, 1, 'exactly one update rule on /pairings');
  assert.equal(
    updateLines[0].trim(), 'allow update: if consumesPairing();',
    'the update rule must delegate wholly to consumesPairing() — no extra branch'
  );
  assert.doesNotMatch(
    updateLines[0], /isParent/,
    'a parent must never be authorized to update a pairing document'
  );
}
// The member path consumption checks must be derived from the PRE-write
// document, so an attacker cannot point the check at a family of their choosing.
assert.match(
  pairingsBlock, /families\/\$\(before\.familyId\)\/members/,
  'the membership check must use the code\'s own (pre-write) familyId'
);

// A model of the surviving update rule, mirrored from consumesPairing() above.
// The source assertions immediately preceding are what tie this model to the
// real rule; this function makes the consequences legible. (True end-to-end
// proof would need the Firestore emulator, which this no-build repo doesn't run.)
const REQUEST_TIME = NOW + 5000;
function updateAllowed({ before, after, uid, memberAfter }) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const affected = [...keys].filter(k => before[k] !== after[k]);
  const aliveBefore = before.active === true
    && before.consumedAt == null
    && typeof before.createdAt === 'number'
    && before.createdAt + PAIRING_TTL_MS > REQUEST_TIME;
  return Boolean(uid)
    && aliveBefore
    && affected.every(k => ['active', 'consumedAt', 'consumedBy'].includes(k))
    && after.active === false
    && after.consumedAt === REQUEST_TIME
    && after.consumedBy === uid
    && memberAfter != null
    // The membership is looked up under the code's OWN familyId.
    && memberAfter.familyId === before.familyId
    && memberAfter.uid === uid
    && memberAfter.pairingCode === 'code-under-test'
    && memberAfter.role === before.role;
}

const FAMILY_A = 'family-a-owned-by-attacker';
const FAMILY_B = 'family-b-the-victim';
const attacker = 'attacker-uid';
// The attacker's own code, freshly minted for their own family — the strongest
// starting position they can legitimately reach.
const attackerCode = {
  familyId: FAMILY_A, role: 'child', active: true, createdAt: NOW, createdBy: attacker
};
const memberDoc = (familyId, role) => ({
  familyId, uid: attacker, pairingCode: 'code-under-test', role
});

// 1. Repoint a code at the victim's family.
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, familyId: FAMILY_B, active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_B, 'child')
  }),
  false,
  'a parent of family A must not be able to repoint a pairing code at family B'
);
// 2. Escalate the role the code grants.
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, role: 'parent', active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_A, 'parent')
  }),
  false,
  'the granted role must be immutable'
);
// 3. Extend / reset the window.
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, createdAt: NOW + 60 * 60 * 1000, active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_A, 'child')
  }),
  false,
  'createdAt must be immutable — no extending or resetting the window'
);
// 4. Reactivate a spent code.
assert.equal(
  updateAllowed({
    before: { ...attackerCode, active: false, consumedAt: NOW + 1000, consumedBy: 'someone' },
    after: { ...attackerCode, active: true, consumedAt: null, consumedBy: null },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_A, 'child')
  }),
  false,
  'a consumed code must not be revivable'
);
// 5. Burn a code without actually joining (no membership written).
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: null
  }),
  false,
  'a code cannot be spent without the membership it pays for'
);
// 6. Claim a different role than the code grants, while consuming it correctly.
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_A, 'parent')
  }),
  false,
  'the membership must take exactly the role the code grants'
);
// 7. The legitimate redemption still works — the fix must not break pairing.
assert.equal(
  updateAllowed({
    before: attackerCode,
    after: { ...attackerCode, active: false, consumedAt: REQUEST_TIME, consumedBy: attacker },
    uid: attacker,
    memberAfter: memberDoc(FAMILY_A, 'child')
  }),
  true,
  'a genuine join must still be able to burn its own code'
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
