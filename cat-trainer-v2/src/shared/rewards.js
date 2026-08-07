// Central reward rules. This is the ONE place reward math lives so the parent and
// child screens can never disagree, and so the same rules can be mirrored in the
// backend security layer (the child device must never be trusted to supply amounts).

export const CAPS = { brain: 12, energy: 12, bond: 20 };
export const HERO_THRESHOLD = { brain: 12, energy: 12 };

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// --- Quick actions (Mom's dashboard) -----------------------------------------
// Preserved from the legacy app. `bond` is the Bond awarded to the active cat on
// a POSITIVE change. Hero's Reset = +2 Bond (confirmed with the family).
export const QUICK_ACTIONS = [
  { code: 'good_choice',   label: 'Good choice',          amount: 1,  bond: 1, tone: 'positive' },
  { code: 'yes_maam',      label: 'Yes, ma’am/sir',  amount: 1,  bond: 2, tone: 'positive' },
  { code: 'rebuttal',      label: 'Rebuttal',             amount: -2, bond: 0, tone: 'negative' },
  { code: 'refused_breaths', label: 'Refused breaths',    amount: -2, bond: 0, tone: 'negative' },
  { code: 'body_not_words', label: 'Body, not words',     amount: -2, bond: 0, tone: 'negative' },
  { code: 'hero_reset',    label: 'Hero’s Reset',    amount: 1,  bond: 2, tone: 'restore' }
];

export const QUICK_ACTION_BY_CODE = Object.fromEntries(QUICK_ACTIONS.map(a => [a.code, a]));

// Bond earned by a custom positive adjustment (Mom types her own amount/reason).
export const CUSTOM_POSITIVE_BOND = 1;
// Every quest completion also builds +1 Bond on the active cat (legacy behavior).
export const QUEST_BOND = 1;

// --- Hero Form ---------------------------------------------------------------
export function isHeroReady(cat) {
  return cat.brain >= HERO_THRESHOLD.brain && cat.energy >= HERO_THRESHOLD.energy;
}

// Apply cumulative cat progress (never spent). Returns a new cat object and
// whether this application newly unlocked the Hero Form (for the celebration).
export function applyCatProgress(cat, { brain = 0, energy = 0, bond = 0 }) {
  const next = {
    ...cat,
    brain: clamp(cat.brain + brain, 0, CAPS.brain),
    energy: clamp(cat.energy + energy, 0, CAPS.energy),
    bond: clamp(cat.bond + bond, 0, CAPS.bond)
  };
  const newlyEvolved = !cat.evolved && isHeroReady(next);
  next.evolved = cat.evolved || isHeroReady(next);
  return { cat: next, newlyEvolved };
}

// --- Balance (carryover + redeem model) --------------------------------------
// Points bank into an available balance that carries over day to day. Negative
// adjustments and redemptions draw it down. `allowNegative` decides whether the
// balance may fall below zero (default: floor at 0, matching the legacy default).
export function applyBalanceDelta(available, delta, { allowNegative = false } = {}) {
  const next = available + delta;
  return allowNegative ? next : Math.max(0, next);
}
