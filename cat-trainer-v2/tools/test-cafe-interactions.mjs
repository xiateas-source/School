import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAFE_ITEMS } from '../src/data/cafe-items.js';
import {
  CAFE_ACTIONS, cafeActionFor, catDestinationForObject, catDestinationForTap,
  firstCafeDecorElement, catWalkDuration
} from '../src/cafe-interactions.js';

const roles = Object.values(CAFE_ITEMS).reduce((counts, item) => {
  counts[item.role] = (counts[item.role] || 0) + 1;
  return counts;
}, {});

assert.deepEqual(roles, { play: 4, rest: 5, decor: 6, food: 1, water: 1 });
assert.equal(cafeActionFor(CAFE_ITEMS.foodBowl), CAFE_ACTIONS.food);
assert.equal(CAFE_ITEMS.foodBowl.need, 'hunger');
assert.equal(CAFE_ITEMS.waterBowl.need, undefined);
assert.equal(cafeActionFor(CAFE_ITEMS.waterBowl), CAFE_ACTIONS.water);
assert.equal(cafeActionFor(CAFE_ITEMS.bed), CAFE_ACTIONS.rest);
assert.equal(cafeActionFor(CAFE_ITEMS.rug), CAFE_ACTIONS.play);
assert.equal(cafeActionFor(CAFE_ITEMS.toyBasket), CAFE_ACTIONS.play);
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
assert.deepEqual(catDestinationForTap({ tapX: 50, tapY: 60 }), { x: 30, y: 38 });
assert.deepEqual(catDestinationForTap({ tapX: 0, tapY: 0 }), { x: 2, y: 12 });
assert.deepEqual(catDestinationForTap({ tapX: 100, tapY: 100 }), { x: 58, y: 68 });
const toyNode = { dataset: { decor: 'toyBasket' } };
assert.equal(firstCafeDecorElement([{ dataset: {} }, toyNode]), toyNode);
assert.equal(firstCafeDecorElement([]), null);

assert.equal(catWalkDuration({ x: 20, y: 20 }, { x: 20, y: 20 }), 0);
assert.equal(catWalkDuration({ x: 2, y: 12 }, { x: 58, y: 68 }), 1450);
assert.equal(catWalkDuration({ x: 2, y: 12 }, { x: 58, y: 68 }, true), 0);

// The browser catalog and Firestore's server-authoritative price allowlist must
// move together or valid purchases will be denied (or a stale price accepted).
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
for (const item of Object.values(CAFE_ITEMS)) {
  assert.match(rules, new RegExp(`itemId == '${item.id}' \\? ${item.price}(?:\\s|$)`),
    `${item.id} price must be mirrored in Firestore Rules`);
}
assert.match(rules, /pairedCafePurchase\(childId, itemId\)/);

// Café sprites have positive z-index values for in-room layering. Keep them in
// a local stacking context, and keep the fixed app navigation above page
// content, so a scrolled cat or décor sprite can never float over the menu.
const css = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8');
assert.match(css, /\.cafe-room\s*\{[^}]*\bisolation:\s*isolate\s*;/s);
assert.match(css, /\.bottom-nav\s*\{[^}]*\bz-index:\s*(?:[1-9]|[1-9]\d+)\s*;/s);

console.log('Café interaction helpers: all checks passed.');
