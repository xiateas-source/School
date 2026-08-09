// Pure helpers for the Cat Café object-action loop. Keeping geometry and timing
// here makes the touch behavior testable without loading Firebase or a browser.

export const CAFE_ACTIONS = Object.freeze({
  food: Object.freeze({ state: 'eat', pose: 'eat', durationMs: 7000 }),
  water: Object.freeze({ state: 'drink', pose: 'sit', durationMs: 7000 }),
  // A requested rest lasts long enough to read, then returns to the need-driven
  // resting pose. If Rest is still low, catMood keeps the cat quietly asleep.
  rest: Object.freeze({ state: 'sleep', pose: 'sleep', durationMs: 8000 }),
  play: Object.freeze({ state: 'play', pose: 'play', durationMs: 7000 })
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A small set of walkable anchors keeps autonomous movement deliberate instead
// of letting the cat drift to arbitrary pixels. Positions are the top-left of
// the same 40%-wide wrapper used by drag and tap movement.
export const CAT_WANDER_SPOTS = Object.freeze([
  Object.freeze({ x: 4, y: 16 }),
  Object.freeze({ x: 30, y: 14 }),
  Object.freeze({ x: 56, y: 17 }),
  Object.freeze({ x: 5, y: 36 }),
  Object.freeze({ x: 31, y: 38 }),
  Object.freeze({ x: 55, y: 37 }),
  Object.freeze({ x: 4, y: 59 }),
  Object.freeze({ x: 29, y: 62 }),
  Object.freeze({ x: 56, y: 58 })
]);

const rectOverlapArea = (a, b) => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
};

// Pick a bounded destination that is meaningfully different from the current
// spot and overlaps as little placed decor as possible. `preferred` is used for
// a gentle low-need seek: the caller can supply the same safe object-side anchor
// used by directed movement, without starting the object action or spending care.
export function catWanderDestination({ from, obstacles = [], preferred = null, random = Math.random }) {
  const start = {
    x: clamp(Number(from && from.x) || 0, 2, 58),
    y: clamp(Number(from && from.y) || 0, 12, 68)
  };
  const farEnough = (spot) => Math.hypot(spot.x - start.x, spot.y - start.y) >= 12;

  if (preferred && Number.isFinite(Number(preferred.x)) && Number.isFinite(Number(preferred.y))) {
    const spot = {
      x: clamp(Number(preferred.x), 2, 58),
      y: clamp(Number(preferred.y), 12, 68)
    };
    return farEnough(spot) ? spot : null;
  }

  const choices = CAT_WANDER_SPOTS.filter(farEnough).map((spot) => {
    // The PNG wrapper has generous transparent padding. Score the visible
    // center/body footprint so a furnished room still has usable destinations.
    const body = { x: spot.x + 8, y: spot.y + 6, width: 24, height: 22 };
    const overlap = obstacles.reduce((total, obstacle) => {
      if (!obstacle) return total;
      const rect = {
        x: Number(obstacle.x) || 0,
        y: Number(obstacle.y) || 0,
        width: Math.max(0, Number(obstacle.width) || 0),
        height: Math.max(0, Number(obstacle.height) || 0)
      };
      return total + rectOverlapArea(body, rect);
    }, 0);
    return { spot, overlap };
  });
  if (!choices.length) return null;

  const leastOverlap = Math.min(...choices.map(choice => choice.overlap));
  const open = choices.filter(choice => choice.overlap === leastOverlap);
  const roll = Number(random());
  const fraction = Number.isFinite(roll) ? clamp(roll, 0, 0.999999) : 0;
  const selected = open[Math.floor(fraction * open.length)];
  return { x: selected.spot.x, y: selected.spot.y };
}

export function cafeActionFor(item) {
  return item ? CAFE_ACTIONS[item.role] || null : null;
}

// Cat positions are the left/top of its 40%-wide wrapper. Food/play sprites
// carry their small prop toward the left side of the frame, while sleep art is
// centered. These anchors put that prop beside the object Sirus tapped and keep
// the cat inside the same walkable bounds used by direct dragging.
export function catDestinationForObject({ role, itemLeft, itemTop, itemWidth = 26 }) {
  const itemCenter = itemLeft + itemWidth / 2;
  const actionPropAnchor = role === 'rest' ? 20 : 12;
  const verticalOffset = role === 'rest' ? 5 : 13;
  return {
    x: clamp(itemCenter - actionPropAnchor, 2, 58),
    y: clamp(itemTop - verticalOffset, 12, 68)
  };
}

// Translate a blank-room tap into the same clamped left/top coordinates used by
// direct cat dragging. The offsets center the 40%-wide cat wrapper under the
// finger while keeping it inside the playable floor area.
export function catDestinationForTap({ tapX, tapY }) {
  return {
    x: clamp(tapX - 20, 2, 58),
    y: clamp(tapY - 22, 12, 68)
  };
}

// elementsFromPoint returns the visible stack from front to back. Select the
// first placed décor record beneath the cat's transparent image rectangle.
export function firstCafeDecorElement(elements) {
  return Array.from(elements || []).find(node => node && node.dataset && node.dataset.decor) || null;
}

export function catWalkDuration(from, to, reducedMotion = false) {
  if (reducedMotion) return 0;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 1.5) return 0;
  return Math.round(clamp(520 + distance * 15, 520, 1450));
}
