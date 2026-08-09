import assert from 'node:assert/strict';
import {
  CARE_CONFIG, careCharges, freshCatNeeds, grantCareCharge, hungerAt, refillHunger
} from '../src/care.js';
import { CAFE_ITEMS } from '../src/data/cafe-items.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 9, 18, 0, 0);

assert.deepEqual(freshCatNeeds(), { hunger: 80, lastUpdatedAt: null });
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

assert.equal(careCharges(-3), 0);
assert.equal(careCharges(3.8), 3);
assert.equal(careCharges(99), CARE_CONFIG.chargeCap);
assert.deepEqual(grantCareCharge(5), { before: 5, after: 6, granted: true });
assert.deepEqual(grantCareCharge(6), { before: 6, after: 6, granted: false });

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

assert.equal(CAFE_ITEMS.foodBowl.need, 'hunger');
assert.equal(CAFE_ITEMS.waterBowl.need, undefined, 'water remains a free neutral interaction');

console.log('Cafe care rules: all checks passed.');
