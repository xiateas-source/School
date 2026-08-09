// Pure rules for the Cat Cafe's real-life care loop. Keeping the tuning and
// timestamp math out of the DOM/Firebase layers makes offline decay and charge
// spending deterministic and easy to regression-test.

export const CARE_CONFIG = Object.freeze({
  maxNeed: 100,
  // 80 is safely inside the Thriving band and makes the first earned charge
  // visibly testable (80 -> 100) instead of presenting a full, inert meter.
  startingHunger: 80,
  hungerDecayPerDay: 35,
  offlineDecayCapHours: 48,
  chargeCap: 6,
  refillPerCharge: 20
});

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
  return { hunger: CARE_CONFIG.startingHunger, lastUpdatedAt };
}

export function careCharges(value) {
  return Math.trunc(clamp(Number(value) || 0, 0, CARE_CONFIG.chargeCap));
}

// Missing timestamps are a migration-safe healthy default. The store lazily
// stamps existing cats on first use so decay begins from their first new visit,
// not from an arbitrary deploy date.
export function hungerAt(catNeeds, nowMs = Date.now()) {
  const hungerValue = catNeeds && catNeeds.hunger;
  const rawHunger = hungerValue == null ? NaN : Number(hungerValue);
  const stored = clamp(
    Number.isFinite(rawHunger) ? rawHunger : CARE_CONFIG.startingHunger,
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
  const decay = CARE_CONFIG.hungerDecayPerDay * (elapsedMs / DAY_MS);
  return roundTenth(clamp(stored - decay, 0, CARE_CONFIG.maxNeed));
}

export function grantCareCharge(current) {
  const before = careCharges(current);
  const after = Math.min(CARE_CONFIG.chargeCap, before + 1);
  return { before, after, granted: after > before };
}

export function refillHunger(currentHunger, currentCharges) {
  const before = roundTenth(clamp(Number(currentHunger) || 0, 0, CARE_CONFIG.maxNeed));
  const chargesBefore = careCharges(currentCharges);
  if (before >= CARE_CONFIG.maxNeed) {
    return { ok: false, reason: 'need-full', before, after: before, refill: 0,
      chargesBefore, chargesAfter: chargesBefore };
  }
  if (chargesBefore < 1) {
    return { ok: false, reason: 'no-care-charges', before, after: before, refill: 0,
      chargesBefore, chargesAfter: chargesBefore };
  }

  const after = roundTenth(Math.min(CARE_CONFIG.maxNeed, before + CARE_CONFIG.refillPerCharge));
  return {
    ok: true,
    reason: null,
    before,
    after,
    refill: roundTenth(after - before),
    chargesBefore,
    chargesAfter: chargesBefore - 1
  };
}
