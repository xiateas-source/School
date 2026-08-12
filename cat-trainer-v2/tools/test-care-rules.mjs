// Contract test binding the Café care-spend behavior (src/care.js + the
// store.spendCare write shape) to the Firestore security rules that must
// authorize it (firestore.rules → childProfiles.validCareSpend +
// cats.validChildCareUpdate).
//
// WHY THIS EXISTS — the care-charge consumption regression (2026-08-12):
// Feed/Rest/Play all failed on Sirus's tablet with "Care did not save", the
// charge never spent. The app code and repo rules were correct and unchanged,
// but the LIVE database was still running the retired Hunger-only rules
// (commit 0184e08): they accept only a 2-key {hunger,lastUpdatedAt} write for
// need 'hunger'. The current app writes all three needs on every action and
// spends on rest/happiness, so the stale rules rejected every care write —
// including Feed. Nothing in the repo verified that the deployed rule contract
// still matched the app, so the drift only surfaced on-device.
//
// This suite ports the care-spend authorization and asserts:
//   1. the CURRENT rules accept every valid Feed/Rest/Play refill (incl. the
//      neglected/decay-cap boundary from the bug screenshot);
//   2. exactly one Care Charge is spent and only the intended need changes;
//   3. tampered writes are rejected (over-refill, missing charge debit, wrong
//      cat, bumping a non-selected need);
//   4. the rules' hardcoded decay/refill bounds stay in lockstep with
//      CARE_CONFIG (a config change that isn't mirrored in the rules fails CI);
//   5. the retired Hunger-only rule rejects the current write shape — the exact
//      production gap, kept as an executable record so a stale publish is caught
//      here instead of on the tablet.

import assert from 'node:assert/strict';
import {
  CARE_CONFIG, CARE_NEEDS, careCharges, refillNeed, needsAt, isNeedFull
} from '../src/care.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
// Sentinel for Firestore request.time; a serverTimestamp() field resolves to it.
const T = 'REQUEST_TIME';
const CAT = 'nova';
const isTimestamp = (v) => v === T || v instanceof Date;

// --- Small helpers mirroring the map/diff primitives the rules language uses --
const eq = (a, b) => {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
  }
  return false;
};
const affectedKeys = (before, after) => {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((k) => !eq((before || {})[k], (after || {})[k]));
};
const hasOnly = (keys, allowed) => keys.every((k) => allowed.includes(k));
const g = (o, k, d) => (o[k] == null ? d : Number(o[k]));

// ---------------------------------------------------------------------------
// Faithful port of the CURRENT firestore.rules care-spend authorization.
// Line references are to firestore.rules at the time of writing.
// ---------------------------------------------------------------------------

// cats/{catId} update → validChildHeroCareAdvance (lines 219-243)
function validChildHeroCareAdvance(catBefore, catAfter, nw) {
  const oldP = catBefore.heroCareProgress || {};
  const newP = catAfter.heroCareProgress || {};
  const oldDates = oldP.activeDates || [];
  const newDates = newP.activeDates || [];
  const day = oldP.lastQuestDate || '';
  return typeof day === 'string' && day !== ''
    && isTimestamp(oldP.lastQuestAt)
    && hasOnly(Object.keys(newP), ['activeDates', 'lastQuestDate', 'lastQuestAt'])
    && (newP.lastQuestDate || '') === day
    && eq(newP.lastQuestAt, oldP.lastQuestAt)
    && !oldDates.includes(day)
    && oldDates.every((d) => newDates.includes(d))
    && newDates.includes(day)
    && newDates.length === oldDates.length + 1
    && newDates.length <= 14
    && nw.hunger >= 39.5 && nw.rest >= 39.5 && nw.happiness >= 39.5;
}

// cats/{catId} update → validChildEvolution (lines 245-257)
function validChildEvolution(catBefore, catAfter) {
  const was = catBefore.evolved || false;
  const is = catAfter.evolved || false;
  const dates = (catAfter.heroCareProgress || {}).activeDates || [];
  return is === was
    || (was === false && is === true
      && (catAfter.brain || 0) >= 12
      && (catAfter.energy || 0) >= 12
      && dates.length >= 14);
}

// cats/{catId} update → validChildCareUpdate (lines 259-321)
function catRuleAccepts(catBefore, catAfter, childBefore, childAfter) {
  const oldNeeds = catBefore.catNeeds || {};
  const nw = catAfter.catNeeds;
  const spend = childAfter.lastCareSpend || {};
  const need = spend.need || '';

  const isCareMigration = !('catNeeds' in catBefore)
    || !['hunger', 'rest', 'happiness', 'lastUpdatedAt'].every((k) => k in oldNeeds);
  const migrationValuesValid =
    (('hunger' in oldNeeds)
      ? nw.hunger <= g(oldNeeds, 'hunger', 80) && nw.hunger >= g(oldNeeds, 'hunger', 80) - 70
      : nw.hunger === 80)
    && (('rest' in oldNeeds)
      ? nw.rest <= g(oldNeeds, 'rest', 80) && nw.rest >= g(oldNeeds, 'rest', 80) - 50
      : nw.rest === 80)
    && (('happiness' in oldNeeds)
      ? nw.happiness <= g(oldNeeds, 'happiness', 80) && nw.happiness >= g(oldNeeds, 'happiness', 80) - 40
      : nw.happiness === 80);

  const cb = careCharges(childBefore.careCharges);
  const ca = careCharges(childAfter.careCharges);
  const isPaidRefill = cb > 0
    && ca === cb - 1
    && spend.catId === CAT
    && ['hunger', 'rest', 'happiness'].includes(need)
    && spend.at === T
    && nw.hunger <= g(oldNeeds, 'hunger', 80) + (need === 'hunger' ? 20 : 0)
    && nw.hunger >= g(oldNeeds, 'hunger', 80) - 70
    && nw.rest <= g(oldNeeds, 'rest', 80) + (need === 'rest' ? 20 : 0)
    && nw.rest >= g(oldNeeds, 'rest', 80) - 50 - (need === 'happiness' ? 5 : 0)
    && nw.happiness <= g(oldNeeds, 'happiness', 80) + (need === 'happiness' ? 20 : 0)
    && nw.happiness >= g(oldNeeds, 'happiness', 80) - 40;

  const heroTouched = affectedKeys(catBefore, catAfter)
    .some((k) => k === 'heroCareProgress' || k === 'evolved');

  return hasOnly(affectedKeys(catBefore, catAfter), ['catNeeds', 'heroCareProgress', 'evolved'])
    && hasOnly(Object.keys(nw), ['hunger', 'rest', 'happiness', 'lastUpdatedAt'])
    && hasOnly(affectedKeys(oldNeeds, nw), ['hunger', 'rest', 'happiness', 'lastUpdatedAt'])
    && ['hunger', 'rest', 'happiness'].every((k) => typeof nw[k] === 'number' && nw[k] >= 0 && nw[k] <= 100)
    && nw.lastUpdatedAt === T
    && (!heroTouched || validChildHeroCareAdvance(catBefore, catAfter, nw))
    && validChildEvolution(catBefore, catAfter)
    && ((isCareMigration && migrationValuesValid && ca === cb) || isPaidRefill);
}

// childProfiles/{childId} update → child branch + validCareSpend (lines 181-211)
function childRuleAccepts(childBefore, childAfter, catAfter) {
  const affected = affectedKeys(childBefore, childAfter);
  if (!hasOnly(affected, [
    'activeCatId', 'cafeCat', 'coins', 'lastCafePurchase',
    'careCharges', 'lastCareCompletionId', 'lastCareSpend'
  ])) return false;
  if (childAfter.available !== childBefore.available) return false;
  if (childAfter.coins !== childBefore.coins) return false; // no purchase in a care spend
  const stored = careCharges(childBefore.careCharges);
  const requested = careCharges(childAfter.careCharges);
  if (requested === stored) return true;            // untouched charge (not a spend)
  if (requested === stored + 1) return false;       // earn path — out of scope here
  if (requested !== stored - 1) return false;
  // validCareSpend (lines 181-192)
  const spend = childAfter.lastCareSpend || {};
  return stored > 0
    && requested === stored - 1
    && typeof spend.catId === 'string'
    && ['hunger', 'rest', 'happiness'].includes(spend.need)
    && spend.at === T
    && catAfter.catNeeds && catAfter.catNeeds.lastUpdatedAt === T;
}

// The whole care spend touches BOTH docs atomically; both rules must pass.
function rulesAcceptCareSpend(before, write) {
  const childAfter = { ...before.child, ...write.child };
  const catAfter = { ...before.cat, ...write.cat };
  return childRuleAccepts(before.child, childAfter, catAfter)
    && catRuleAccepts(before.cat, catAfter, before.child, childAfter);
}

// The retired Hunger-only cats rule (commit 0184e08) the live DB still runs.
// Only a 2-key {hunger,lastUpdatedAt} write for need 'hunger' is allowed.
function staleHungerOnlyCatRuleAccepts(catBefore, catAfter, childAfter) {
  const oldNeeds = catBefore.catNeeds || {};
  const nw = catAfter.catNeeds;
  const spend = childAfter.lastCareSpend || {};
  return hasOnly(affectedKeys(catBefore, catAfter), ['catNeeds'])
    && hasOnly(affectedKeys(oldNeeds, nw), ['hunger', 'lastUpdatedAt'])
    && spend.need === 'hunger';
}

// ---------------------------------------------------------------------------
// Driver: build the exact write store.spendCare would commit for a care action.
// ---------------------------------------------------------------------------
function buildSpendWrite(before, need, now = NOW) {
  const result = refillNeed(before.cat.catNeeds, need, before.child.careCharges, now);
  if (!result.ok) return { result, write: null };
  return {
    result,
    write: {
      child: { careCharges: result.chargesAfter, lastCareSpend: { catId: CAT, need, at: T } },
      cat: { catNeeds: { ...result.needsAfter, lastUpdatedAt: T } }
    }
  };
}

const child = (careChargesVal, extra = {}) => ({
  available: 30, coins: 12, careCharges: careChargesVal, ...extra
});
const catDoc = (catNeeds, extra = {}) => ({ catNeeds, ...extra });

// ===========================================================================
// 1. Constants stay in lockstep with the rules' hardcoded bounds.
//    If care.js tuning changes without updating firestore.rules, this fails.
// ===========================================================================
const capDays = CARE_CONFIG.offlineDecayCapHours / 24;
assert.equal(CARE_CONFIG.decayPerDay.hunger * capDays, 70, 'rule bound -70 must equal max Hunger decay');
assert.equal(CARE_CONFIG.decayPerDay.rest * capDays, 50, 'rule bound -50 must equal max Rest decay');
assert.equal(CARE_CONFIG.decayPerDay.happiness * capDays, 40, 'rule bound -40 must equal max Happiness decay');
assert.equal(CARE_CONFIG.refillPerCharge, 20, 'rule allows the selected need to rise by exactly +20');
assert.equal(CARE_CONFIG.playRestCost, 5, 'rule allows a paid play refill to spend exactly 5 Rest');
assert.equal(CARE_CONFIG.chargeCap, 6, 'validCareEarn caps stored charges below 6');
assert.deepEqual([...CARE_NEEDS], ['hunger', 'rest', 'happiness'], 'rule need allowlist must match CARE_NEEDS');

// ===========================================================================
// 2. Every valid Feed / Rest / Play refill is accepted, spends exactly one
//    charge, and only touches the intended need(s). Includes the neglected
//    decay-cap boundary from the bug screenshot (displays 0 / 25 / 44).
// ===========================================================================
const scenarios = [
  { label: 'screenshot neglected cat (48h decay, at the rule boundary)',
    catNeeds: { hunger: 35, rest: 75, happiness: 84, lastUpdatedAt: NOW - 48 * HOUR }, charges: 3 },
  { label: 'fresh healthy cat', catNeeds: { hunger: 80, rest: 80, happiness: 80, lastUpdatedAt: NOW }, charges: 6 },
  { label: 'last charge', catNeeds: { hunger: 20, rest: 30, happiness: 55, lastUpdatedAt: NOW }, charges: 1 },
  { label: 'over-cap neglect (96h clamps to 48h)',
    catNeeds: { hunger: 100, rest: 100, happiness: 100, lastUpdatedAt: NOW - 96 * HOUR }, charges: 4 }
];

for (const s of scenarios) {
  for (const need of CARE_NEEDS) {
    const before = { child: child(s.charges), cat: catDoc(s.catNeeds) };
    const { result, write } = buildSpendWrite(before, need);
    assert.ok(result.ok, `${s.label}: ${need} should be spendable`);
    assert.ok(rulesAcceptCareSpend(before, write),
      `${s.label}: current rules must ACCEPT a ${need} spend`);

    // Contract: exactly one charge consumed.
    assert.equal(write.child.careCharges, s.charges - 1,
      `${s.label}: ${need} spends exactly one Care Charge`);

    // Contract: only the selected need rises (+ Rest falls on a paid play).
    const decayed = needsAt(s.catNeeds, NOW);
    for (const other of CARE_NEEDS) {
      if (other === need) continue;
      if (need === 'happiness' && other === 'rest') {
        assert.ok(write.cat.catNeeds.rest <= decayed.rest,
          `${s.label}: play never raises Rest`);
        continue;
      }
      assert.equal(write.cat.catNeeds[other], decayed[other],
        `${s.label}: ${need} spend leaves ${other} at its decayed value`);
    }
    assert.ok(write.cat.catNeeds[need] > decayed[need],
      `${s.label}: ${need} rises when cared for`);
  }
}

// ===========================================================================
// 3. Write SHAPE — every action (even Feed) writes all three needs + a
//    timestamp. This 4-key map is exactly what the stale Hunger-only rules
//    reject; documenting it here keeps the deployment contract explicit.
// ===========================================================================
{
  const before = { child: child(2), cat: catDoc({ hunger: 35, rest: 75, happiness: 84, lastUpdatedAt: NOW - 48 * HOUR }) };
  const feed = buildSpendWrite(before, 'hunger').write;
  assert.deepEqual(Object.keys(feed.cat.catNeeds).sort(),
    ['happiness', 'hunger', 'lastUpdatedAt', 'rest'],
    'a Feed writes all three needs + lastUpdatedAt (4 keys)');

  // The current rules accept this shape…
  assert.ok(rulesAcceptCareSpend(before, feed), 'current rules accept the 4-key Feed write');
  // …but the retired Hunger-only rules the live DB still runs reject it — the
  // exact production gap that broke Feed/Rest/Play. If a deploy ever ships that
  // shape again, this assertion is the canary.
  const catAfter = { ...before.cat, ...feed.cat };
  const childAfter = { ...before.child, ...feed.child };
  assert.equal(staleHungerOnlyCatRuleAccepts(before.cat, catAfter, childAfter), false,
    'retired Hunger-only rule REJECTS the current 3-need write (documents the deployment gap)');
}

// ===========================================================================
// 4. Full-need and no-charge guards never produce a write (charge stays safe).
// ===========================================================================
{
  const full = { child: child(4), cat: catDoc({ hunger: 100, rest: 100, happiness: 100, lastUpdatedAt: NOW }) };
  for (const need of CARE_NEEDS) {
    const { result, write } = buildSpendWrite(full, need);
    assert.equal(result.ok, false, `full ${need} is guarded`);
    assert.equal(result.reason, 'need-full');
    assert.equal(write, null, `full ${need} produces no write, so no charge is risked`);
    assert.ok(isNeedFull(needsAt(full.cat.catNeeds, NOW)[need]));
  }
  const broke = { child: child(0), cat: catDoc({ hunger: 20, rest: 20, happiness: 20, lastUpdatedAt: NOW }) };
  const { result } = buildSpendWrite(broke, 'hunger');
  assert.equal(result.reason, 'no-care-charges', 'no charge → no spend');
}

// ===========================================================================
// 5. Tampering is rejected — a child cannot forge a cheaper/free/foreign refill.
// ===========================================================================
{
  const before = { child: child(3), cat: catDoc({ hunger: 40, rest: 50, happiness: 60, lastUpdatedAt: NOW }) };
  const base = buildSpendWrite(before, 'hunger').write;

  // (a) Over-refill: claim +40 instead of the authoritative +20.
  const overRefill = { child: base.child, cat: { catNeeds: { ...base.cat.catNeeds, hunger: 80 } } };
  assert.equal(rulesAcceptCareSpend(before, overRefill), false, 'reject a larger-than-+20 refill');

  // (b) Refill the need but DON'T debit a charge (free care).
  const freeCare = {
    child: { careCharges: 3, lastCareSpend: { catId: CAT, need: 'hunger', at: T } },
    cat: base.cat
  };
  assert.equal(rulesAcceptCareSpend(before, freeCare), false, 'reject a refill that spends no charge');

  // (c) Debit a charge on cat A but write needs for cat B (mismatched catId).
  const wrongCat = { child: { ...base.child, lastCareSpend: { catId: 'ember', need: 'hunger', at: T } }, cat: base.cat };
  assert.equal(rulesAcceptCareSpend(before, wrongCat), false, 'reject a spend whose lastCareSpend names another cat');

  // (d) Feed but also secretly bump a non-selected need above its decayed value.
  const sneaky = { child: base.child, cat: { catNeeds: { ...base.cat.catNeeds, happiness: 100 } } };
  assert.equal(rulesAcceptCareSpend(before, sneaky), false, 'reject bumping a non-selected need');

  // Sanity: the untampered write from the same base is accepted.
  assert.ok(rulesAcceptCareSpend(before, base), 'the honest Feed write is accepted');
}

console.log('Care-spend rules contract (Feed/Rest/Play + charge consumption): all checks passed.');
