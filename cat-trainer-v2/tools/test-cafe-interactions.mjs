import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAFE_ITEMS } from '../src/data/cafe-items.js';
import {
  CAFE_ACTIONS, CAT_WANDER_SPOTS, cafeActionFor, catDestinationForObject,
  catDestinationForTap, catWanderDestination, firstCafeDecorElement,
  catWalkDuration
} from '../src/cafe-interactions.js';

const roles = Object.values(CAFE_ITEMS).reduce((counts, item) => {
  counts[item.role] = (counts[item.role] || 0) + 1;
  return counts;
}, {});

assert.deepEqual(roles, { play: 4, rest: 5, decor: 6, food: 1, water: 1 });
assert.equal(cafeActionFor(CAFE_ITEMS.foodBowl), CAFE_ACTIONS.food);
assert.equal(CAFE_ITEMS.foodBowl.need, 'hunger');
assert.equal(CAFE_ITEMS.waterBowl.need, undefined);
assert.ok(Object.values(CAFE_ITEMS).filter(item => item.role === 'rest').every(item => item.need === 'rest'));
assert.ok(Object.values(CAFE_ITEMS).filter(item => item.role === 'play').every(item => item.need === 'happiness'));
assert.equal(cafeActionFor(CAFE_ITEMS.waterBowl), CAFE_ACTIONS.water);
assert.equal(cafeActionFor(CAFE_ITEMS.bed), CAFE_ACTIONS.rest);
assert.ok(CAFE_ACTIONS.rest.durationMs >= 6000, 'a rest action remains readable before auto-ending');
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

for (let i = 0; i < CAT_WANDER_SPOTS.length; i++) {
  const destination = catWanderDestination({
    from: { x: 30, y: 38 },
    random: () => i / CAT_WANDER_SPOTS.length
  });
  assert.ok(destination.x >= 2 && destination.x <= 58, 'wander x stays in cat drag bounds');
  assert.ok(destination.y >= 12 && destination.y <= 68, 'wander y stays in cat drag bounds');
  assert.ok(Math.hypot(destination.x - 30, destination.y - 38) >= 12,
    'wander destination is a visible move, not an in-place shuffle');
}
assert.deepEqual(catWanderDestination({
  from: { x: 4, y: 59 },
  preferred: { x: 99, y: -20 }
}), { x: 58, y: 12 }, 'a low-need object preference uses the shared safe bounds');
assert.equal(catWanderDestination({
  from: { x: 58, y: 12 },
  preferred: { x: 58, y: 12 }
}), null, 'a cat already beside the preferred object stays there');
const rightOpen = catWanderDestination({
  from: { x: 30, y: 38 },
  obstacles: [{ x: 0, y: 0, width: 55, height: 100 }],
  random: () => 0
});
assert.ok(rightOpen.x >= 55, 'wander chooses the least-obstructed room anchor');

// The browser catalog and Firestore's server-authoritative price allowlist must
// move together or valid purchases will be denied (or a stale price accepted).
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
for (const item of Object.values(CAFE_ITEMS)) {
  assert.match(rules, new RegExp(`itemId == '${item.id}' \\? ${item.price}(?:\\s|$)`),
    `${item.id} price must be mirrored in Firestore Rules`);
}
assert.match(rules, /pairedCafePurchase\(childId, itemId\)/);
assert.match(rules, /spend\.get\('need', ''\) in \['hunger', 'rest', 'happiness'\]/);
assert.match(rules, /newNeeds\.keys\(\)\.hasOnly\(\['hunger', 'rest', 'happiness', 'lastUpdatedAt'\]\)/);
const childCareRule = rules.match(/function validChildCareUpdate\(\) \{([\s\S]*?)\n\s+return request\.resource/);
assert.ok(childCareRule, 'child care rule is present');
assert.ok((childCareRule[1].match(/\blet\s/g) || []).length <= 10,
  'Firestore Rules functions support at most ten let bindings');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const need of ['hunger', 'rest', 'happiness']) {
  assert.match(html, new RegExp(`id="c-${need}-meter"`), `${need} meter is present`);
  assert.match(html, new RegExp(`id="c-${need}-delta"`), `${need} refill feedback is present`);
}
assert.match(html, /id="c-need-cue"/, 'one functional low-need cue is present');

// Café sprites have positive z-index values for in-room layering. Keep them in
// a local stacking context, and keep the fixed app navigation above page
// content, so a scrolled cat or décor sprite can never float over the menu.
const css = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8');
assert.match(css, /\.cafe-room\s*\{[^}]*\bisolation:\s*isolate\s*;/s);
assert.match(css, /\.bottom-nav\s*\{[^}]*\bz-index:\s*(?:[1-9]|[1-9]\d+)\s*;/s);
assert.match(css, /data-cat-state="wander"/, 'travel walk does not inherit the idle breathing transform');

console.log('Café interaction helpers: all checks passed.');
