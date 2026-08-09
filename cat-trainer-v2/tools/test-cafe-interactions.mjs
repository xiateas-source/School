import assert from 'node:assert/strict';
import { CAFE_ITEMS } from '../src/data/cafe-items.js';
import {
  CAFE_ACTIONS, cafeActionFor, catDestinationForObject, catWalkDuration
} from '../src/cafe-interactions.js';

const roles = Object.values(CAFE_ITEMS).reduce((counts, item) => {
  counts[item.role] = (counts[item.role] || 0) + 1;
  return counts;
}, {});

assert.deepEqual(roles, { play: 4, rest: 5, decor: 6, food: 2 });
assert.equal(cafeActionFor(CAFE_ITEMS.foodBowl), CAFE_ACTIONS.food);
assert.equal(cafeActionFor(CAFE_ITEMS.bed), CAFE_ACTIONS.rest);
assert.equal(cafeActionFor(CAFE_ITEMS.rug), CAFE_ACTIONS.play);
assert.equal(cafeActionFor(CAFE_ITEMS.plant), null);

assert.deepEqual(
  catDestinationForObject({ role: 'food', itemLeft: 40, itemTop: 50, itemWidth: 26 }),
  { x: 41, y: 37 }
);
assert.deepEqual(
  catDestinationForObject({ role: 'rest', itemLeft: 40, itemTop: 50, itemWidth: 26 }),
  { x: 33, y: 45 }
);
assert.deepEqual(
  catDestinationForObject({ role: 'play', itemLeft: 0, itemTop: 0, itemWidth: 26 }),
  { x: 2, y: 12 }
);
assert.deepEqual(
  catDestinationForObject({ role: 'play', itemLeft: 90, itemTop: 90, itemWidth: 26 }),
  { x: 58, y: 68 }
);

assert.equal(catWalkDuration({ x: 20, y: 20 }, { x: 20, y: 20 }), 0);
assert.equal(catWalkDuration({ x: 2, y: 12 }, { x: 58, y: 68 }), 1450);
assert.equal(catWalkDuration({ x: 2, y: 12 }, { x: 58, y: 68 }, true), 0);

console.log('Café interaction helpers: all checks passed.');
