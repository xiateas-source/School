// Pairing-code rules, kept pure so they can be unit-tested in node and so the
// client and the Firestore rules describe the SAME code lifecycle.
//
// A pairing code is a short-lived, single-use bearer token. Three properties
// make a 6-digit code safe enough to type onto a tablet:
//
//   1. Not enumerable — the rules deny `list` on /pairings entirely, so nobody
//      can ask "give me every code". A code can only be fetched by knowing it.
//   2. Short-lived — a code dies PAIRING_TTL_MINUTES after the server stamped
//      createdAt. The rules do that arithmetic themselves (createdAt is a server
//      timestamp), so a device with a wrong clock can neither mint a code that
//      outlives the window nor kill one early.
//   3. Single-use — redeeming a code consumes it in the same atomic write that
//      creates the membership. A code that paired a device is dead.
//
// Together those shrink the attack surface to "guess one specific live 6-digit
// code, from ~900k, inside a 15-minute window, without being able to list".

export const PAIRING_TTL_MINUTES = 15;
export const PAIRING_TTL_MS = PAIRING_TTL_MINUTES * 60 * 1000;

// The roles a code can grant. A child code pairs a tablet (limited role); a
// parent code invites a co-parent (full role). A code grants exactly one.
export const PAIRING_ROLES = ['child', 'parent'];

// The exact field set a new pairing doc may carry. Mirrored by the rules'
// hasOnly() check so a client cannot smuggle extra fields (e.g. a homemade
// expiry) into the document.
export const PAIRING_FIELDS = ['familyId', 'role', 'active', 'createdAt', 'createdBy'];

// The only fields redeeming a code may touch. Mirrored by the rules.
export const PAIRING_CONSUME_FIELDS = ['active', 'consumedAt', 'consumedBy'];

// 6 digits, no leading zero, so the code is always exactly six characters on a
// numeric keypad. `rand` is injectable for deterministic tests.
export function generatePairingCode(rand = Math.random) {
  return String(100000 + Math.floor(rand() * 900000));
}

export function isPairingCodeShape(code) {
  return typeof code === 'string' && /^[1-9][0-9]{5}$/.test(code);
}

// Millisecond epoch for a Firestore timestamp, a Date, or a raw number. Returns
// null for anything else — including a not-yet-resolved serverTimestamp sentinel
// — so an unreadable createdAt fails closed as "not usable".
export function timestampMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

export function pairingExpiresAtMs(pairing) {
  const created = timestampMs(pairing && pairing.createdAt);
  return created == null ? null : created + PAIRING_TTL_MS;
}

// The client-side mirror of the rules' validPairing(). Used only to turn a
// doomed redemption into a friendly message BEFORE writing; the authoritative
// check is in firestore.rules, which re-derives all of this server-side.
// Returns a reason string, or null when the code is good.
export function pairingRejection(pairing, wantRole, nowMs = Date.now()) {
  if (!pairing) return 'missing';
  if (pairing.active !== true) return 'consumed';
  if (pairing.consumedAt != null) return 'consumed';
  if (typeof pairing.familyId !== 'string' || !pairing.familyId) return 'missing';
  if (pairing.role !== wantRole) return 'wrong-role';
  const expiresAt = pairingExpiresAtMs(pairing);
  if (expiresAt == null) return 'expired'; // legacy code with no readable stamp
  if (nowMs >= expiresAt) return 'expired';
  return null;
}

export function isPairingUsable(pairing, wantRole, nowMs = Date.now()) {
  return pairingRejection(pairing, wantRole, nowMs) === null;
}

// One message for every failure mode. Deliberately does NOT distinguish "no such
// code" from "expired" from "already used": a distinguishing error would turn
// the pairing screen into an oracle that confirms which codes exist.
export function pairingErrorMessage(kind) {
  return kind === 'parent'
    ? 'That invite code is not valid — codes expire after 15 minutes and work once. Ask Mom for a new one.'
    : 'That code is not valid — codes expire after 15 minutes and work once. Ask Mom for a new one.';
}
