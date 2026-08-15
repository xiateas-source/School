// Pure rules for the Cat Cafe's real-life care loop. Keeping the tuning and
// timestamp math out of the DOM/Firebase layers makes offline decay and charge
// spending deterministic and easy to regression-test.

export const CARE_CONFIG = Object.freeze({
  maxNeed: 100,
  // 80 is safely inside the Thriving band and makes the first earned charge
  // visibly testable (80 -> 100) instead of presenting a full, inert meter.
  startingNeed: 80,
  startingHunger: 80, // compatibility name for the shipped Hunger slice
  decayPerDay: Object.freeze({ hunger: 35, rest: 25, happiness: 20 }),
  hungerDecayPerDay: 35, // compatibility name for the shipped Hunger slice
  offlineDecayCapHours: 48,
  chargeCap: 6,
  refillPerCharge: 20,
  playRestCost: 5,
  okayMin: 40
});

export const CARE_NEEDS = Object.freeze(['hunger', 'rest', 'happiness']);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTenth = (value) => Math.round(value * 10) / 10;

function timestampMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + (Number(value.nanoseconds) || 0) / 1e6;
  }
  return null;
}

export function freshCatNeeds(lastUpdatedAt = null) {
  return {
    hunger: CARE_CONFIG.startingNeed,
    rest: CARE_CONFIG.startingNeed,
    happiness: CARE_CONFIG.startingNeed,
    lastUpdatedAt
  };
}

export function careCharges(value) {
  return Math.trunc(clamp(Number(value) || 0, 0, CARE_CONFIG.chargeCap));
}

// Care decisions must agree with the whole-number value shown in the meter.
// Without this shared rule, a recently-full need can decay to 99.9 while the
// phone still says 100/100, then incorrectly ask Sirus to earn another charge.
export function displayNeedValue(value) {
  const raw = Number(value);
  const safe = Number.isFinite(raw) ? raw : CARE_CONFIG.startingNeed;
  return Math.round(clamp(safe, 0, CARE_CONFIG.maxNeed));
}

export function isNeedFull(value) {
  return displayNeedValue(value) >= CARE_CONFIG.maxNeed;
}

// Hero-care eligibility follows the same whole-number values Sirus sees. A
// decayed 39.5 displays as 40/100 and therefore belongs to the Okay band in both
// the interface and the progression transaction.
export function areCareNeedsOkay(needs) {
  return CARE_NEEDS.every(need => displayNeedValue(needs && needs[need]) >= CARE_CONFIG.okayMin);
}

// Missing values are migration-safe healthy defaults. In particular, cats from
// the Hunger-only release already have a timestamp but no Rest/Happiness. Those
// two new needs begin at 80 on first use instead of being retroactively decayed
// from Hunger's older timestamp.
export function needAt(catNeeds, need, nowMs = Date.now()) {
  if (!CARE_NEEDS.includes(need)) throw new Error('unknown-care-need');
  const value = catNeeds && catNeeds[need];
  const raw = value == null ? NaN : Number(value);
  if (!Number.isFinite(raw)) return CARE_CONFIG.startingNeed;
  const stored = clamp(
    raw,
    0,
    CARE_CONFIG.maxNeed
  );
  const updatedMs = timestampMs(catNeeds && catNeeds.lastUpdatedAt);
  if (updatedMs == null) return roundTenth(stored);

  const elapsedMs = clamp(
    Number(nowMs) - updatedMs,
    0,
    CARE_CONFIG.offlineDecayCapHours * HOUR_MS
  );
  const decay = CARE_CONFIG.decayPerDay[need] * (elapsedMs / DAY_MS);
  return roundTenth(clamp(stored - decay, 0, CARE_CONFIG.maxNeed));
}

export function needsAt(catNeeds, nowMs = Date.now()) {
  return Object.fromEntries(CARE_NEEDS.map(need => [need, needAt(catNeeds, need, nowMs)]));
}

export function lowestCareNeed(needs, threshold = CARE_CONFIG.maxNeed + 1) {
  const lowest = CARE_NEEDS.reduce((best, need) => {
    const rawValue = needs && needs[need];
    const raw = rawValue == null ? NaN : Number(rawValue);
    const value = clamp(Number.isFinite(raw) ? raw : CARE_CONFIG.startingNeed, 0, CARE_CONFIG.maxNeed);
    return !best || value < best.value ? { need, value } : best;
  }, null);
  return lowest && lowest.value < threshold ? lowest : null;
}

// Compatibility helper retained for the already-shipped Hunger callers/tests.
export function hungerAt(catNeeds, nowMs = Date.now()) {
  return needAt(catNeeds, 'hunger', nowMs);
}

export function grantCareCharge(current) {
  const before = careCharges(current);
  const after = Math.min(CARE_CONFIG.chargeCap, before + 1);
  return { before, after, granted: after > before };
}

// One immutable processing key per daily Quest instance. The marker is created
// even when Care is already full (award 0), so return/retry cannot bank that
// completion and collect a charge later after spending one.
export function questCareAwardId(childId, questId, date) {
  if (!childId || !questId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new Error('bad-quest-care-award-id');
  }
  return `${childId}_${questId}_${date}`;
}

export function dailyQuestCareAward(alreadyProcessed, currentCharges) {
  const before = careCharges(currentCharges);
  if (alreadyProcessed) {
    return { createMarker: false, careChargeGranted: false, award: 0, before, after: before };
  }
  const charge = grantCareCharge(before);
  return {
    createMarker: true,
    careChargeGranted: charge.granted,
    award: charge.granted ? 1 : 0,
    before: charge.before,
    after: charge.after
  };
}

export function refillNeed(catNeeds, need, currentCharges, nowMs = Date.now()) {
  if (!CARE_NEEDS.includes(need)) throw new Error('unknown-care-need');
  const needsBefore = needsAt(catNeeds, nowMs);
  const before = needsBefore[need];
  const chargesBefore = careCharges(currentCharges);
  if (isNeedFull(before)) {
    return {
      ok: false, reason: 'need-full', need, before, after: before, refill: 0,
      chargesBefore, chargesAfter: chargesBefore,
      needsBefore, needsAfter: { ...needsBefore }, restCost: 0
    };
  }
  if (chargesBefore < 1) {
    return {
      ok: false, reason: 'no-care-charges', need, before, after: before, refill: 0,
      chargesBefore, chargesAfter: chargesBefore,
      needsBefore, needsAfter: { ...needsBefore }, restCost: 0
    };
  }

  const after = roundTenth(Math.min(CARE_CONFIG.maxNeed, before + CARE_CONFIG.refillPerCharge));
  const restAfter = need === 'happiness'
    ? roundTenth(Math.max(0, needsBefore.rest - CARE_CONFIG.playRestCost))
    : needsBefore.rest;
  const restCost = roundTenth(needsBefore.rest - restAfter);
  return {
    ok: true,
    reason: null,
    need,
    before,
    after,
    refill: roundTenth(after - before),
    chargesBefore,
    chargesAfter: chargesBefore - 1,
    needsBefore,
    needsAfter: {
      ...needsBefore,
      [need]: after,
      ...(need === 'happiness' ? { rest: restAfter } : {})
    },
    restCost
  };
}

// Compatibility helper retained for the first vertical-slice API.
export function refillHunger(currentHunger, currentCharges) {
  const result = refillNeed({ hunger: currentHunger }, 'hunger', currentCharges);
  return {
    ok: result.ok,
    reason: result.reason,
    before: result.before,
    after: result.after,
    refill: result.refill,
    chargesBefore: result.chargesBefore,
    chargesAfter: result.chargesAfter
  };
}
