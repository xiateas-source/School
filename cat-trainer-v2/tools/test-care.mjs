import assert from 'node:assert/strict';
import {
  CARE_CONFIG, careCharges, displayNeedValue, freshCatNeeds, grantCareCharge,
  hungerAt, isNeedFull, lowestCareNeed, needAt, needsAt, refillHunger, refillNeed
} from '../src/care.js';
import { CAFE_ITEMS } from '../src/data/cafe-items.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 9, 18, 0, 0);

assert.deepEqual(freshCatNeeds(), {
  hunger: 80, rest: 80, happiness: 80, lastUpdatedAt: null
});
assert.equal(hungerAt(undefined, NOW), 80, 'legacy cats start healthy and immediately testable');
assert.equal(hungerAt({ hunger: null, lastUpdatedAt: null }, NOW), 80,
  'an incomplete legacy needs map also receives the healthy baseline');
assert.equal(hungerAt({ hunger: 0, lastUpdatedAt: NOW }, NOW), 0, 'zero is preserved');
assert.equal(hungerAt({ hunger: 100, lastUpdatedAt: NOW - 24 * HOUR }, NOW), 65);
assert.equal(hungerAt({ hunger: 100, lastUpdatedAt: NOW - 48 * HOUR }, NOW), 30);
assert.equal(hungerAt({ hunger: 100, lastUpdatedAt: NOW - 96 * HOUR }, NOW), 30,
  'offline decay is capped at 48 hours per return');
assert.equal(hungerAt({ hunger: 70, lastUpdatedAt: { seconds: (NOW - 12 * HOUR) / 1000 } }, NOW), 52.5);
assert.equal(hungerAt({ hunger: 70, lastUpdatedAt: { toMillis: () => NOW + HOUR } }, NOW), 70,
  'future clock skew never increases or decays a need');
assert.equal(needAt({ rest: 100, lastUpdatedAt: NOW - 24 * HOUR }, 'rest', NOW), 75);
assert.equal(needAt({ happiness: 100, lastUpdatedAt: NOW - 24 * HOUR }, 'happiness', NOW), 80);
assert.equal(needAt({ hunger: 65, lastUpdatedAt: NOW - 24 * HOUR }, 'rest', NOW), 80,
  'a newly-added Rest value does not retroactively decay from Hunger\'s timestamp');
assert.deepEqual(needsAt({
  hunger: 100, rest: 100, happiness: 100, lastUpdatedAt: NOW - 48 * HOUR
}, NOW), { hunger: 30, rest: 50, happiness: 60 });
assert.deepEqual(lowestCareNeed({ hunger: 55, rest: 12, happiness: 30 }, 40),
  { need: 'rest', value: 12 });
assert.equal(lowestCareNeed({ hunger: 70, rest: 70, happiness: 70 }, 40), null);

assert.equal(careCharges(-3), 0);
assert.equal(careCharges(3.8), 3);
assert.equal(careCharges(99), CARE_CONFIG.chargeCap);
assert.deepEqual(grantCareCharge(5), { before: 5, after: 6, granted: true });
assert.deepEqual(grantCareCharge(6), { before: 6, after: 6, granted: false });
assert.equal(displayNeedValue(99.9), 100);
assert.equal(isNeedFull(99.9), true, 'a need displayed as 100 is full to care actions');
assert.equal(isNeedFull(99.4), false, 'a need displayed as 99 can receive care');

assert.deepEqual(refillHunger(42, 3), {
  ok: true, reason: null, before: 42, after: 62, refill: 20,
  chargesBefore: 3, chargesAfter: 2
});
assert.deepEqual(refillHunger(95, 1), {
  ok: true, reason: null, before: 95, after: 100, refill: 5,
  chargesBefore: 1, chargesAfter: 0
});
assert.equal(refillHunger(50, 0).reason, 'no-care-charges');
assert.equal(refillHunger(100, 4).reason, 'need-full');
assert.equal(refillHunger(100, 0).reason, 'need-full', 'a full cat never asks for a quest');
assert.equal(refillHunger(100, 4).chargesAfter, 4, 'full Hunger never wastes a charge');
assert.equal(refillHunger(99.9, 0).reason, 'need-full',
  'displayed-full Hunger never asks for a quest after tiny timestamp decay');
assert.equal(refillHunger(99.9, 4).chargesAfter, 4,
  'displayed-full Hunger preserves every available charge');

const restRefill = refillNeed({
  hunger: 100, rest: 50, happiness: 90, lastUpdatedAt: NOW - 24 * HOUR
}, 'rest', 2, NOW);
assert.equal(restRefill.ok, true);
assert.equal(restRefill.need, 'rest');
assert.deepEqual(restRefill.needsBefore, { hunger: 65, rest: 25, happiness: 70 });
assert.deepEqual(restRefill.needsAfter, { hunger: 65, rest: 45, happiness: 70 });
assert.equal(restRefill.chargesAfter, 1);
assert.equal(restRefill.restCost, 0);
const playRefill = refillNeed({
  hunger: 70, rest: 30, happiness: 50, lastUpdatedAt: NOW
}, 'happiness', 2, NOW);
assert.deepEqual(playRefill.needsAfter, { hunger: 70, rest: 25, happiness: 70 });
assert.equal(playRefill.restCost, CARE_CONFIG.playRestCost,
  'a paid play action visibly nudges Rest down');
assert.deepEqual(refillNeed({
  hunger: 100, rest: 100, happiness: 100, lastUpdatedAt: NOW - 48 * HOUR
}, 'happiness', 1, NOW).needsAfter, { hunger: 30, rest: 45, happiness: 80 },
  'the 48-hour decay cap and play Rest cost compose predictably');
assert.equal(refillNeed({ happiness: 100, lastUpdatedAt: NOW }, 'happiness', 3, NOW).reason, 'need-full');
assert.equal(refillNeed({ rest: 20, lastUpdatedAt: NOW }, 'rest', 0, NOW).reason, 'no-care-charges');
assert.throws(() => refillNeed({}, 'hydration', 2, NOW), /unknown-care-need/);

assert.equal(CAFE_ITEMS.foodBowl.need, 'hunger');
assert.equal(CAFE_ITEMS.waterBowl.need, undefined, 'water remains a free neutral interaction');
for (const item of Object.values(CAFE_ITEMS)) {
  if (item.role === 'rest') assert.equal(item.need, 'rest', `${item.id} refills Rest`);
  if (item.role === 'play') assert.equal(item.need, 'happiness', `${item.id} refills Happiness`);
}

console.log('Cafe care rules: all checks passed.');
