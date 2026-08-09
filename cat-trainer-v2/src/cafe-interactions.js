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
