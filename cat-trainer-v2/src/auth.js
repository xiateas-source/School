// Authentication + pairing.
//  • Parent (Mom): passwordless email-link sign-in. Her account owns the family;
//    familyId == her uid.
//  • Child device (tablet): anonymous sign-in, then joins the family by entering a
//    short pairing code Mom generates. It holds a limited "child" role.

import { initFirebase, auth, authSdk } from './firebase.js?v=6e1109c4';

const EMAIL_KEY = 'catTrainerEmailForSignIn';

// --- Parent: email + password -------------------------------------------------
// Reliable on any device (no email round-trip). First sign-in creates the
// account; after that the same email + password signs Mom back in.
export async function parentSignIn(email, password) {
  await initFirebase();
  const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = authSdk();
  try {
    const res = await createUserWithEmailAndPassword(auth(), email, password);
    return res.user;
  } catch (err) {
    if (err && err.code === 'auth/email-already-in-use') {
      const res = await signInWithEmailAndPassword(auth(), email, password);
      return res.user;
    }
    throw err;
  }
}

// Turn a Firebase auth error into a friendly message.
export function friendlyAuthError(err) {
  const code = err && err.code || '';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Wrong password — try again.';
  if (code.includes('weak-password')) return 'Password needs at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email address looks off.';
  if (code.includes('network')) return 'No connection — check wifi and try again.';
  return 'Could not sign in. ' + (err && err.message || '');
}

// --- Child: anonymous ---------------------------------------------------------

export async function signInChildDevice() {
  await initFirebase();
  const { signInAnonymously } = authSdk();
  const result = await signInAnonymously(auth());
  return result.user;
}

// --- Session ------------------------------------------------------------------

export async function onAuth(callback) {
  await initFirebase();
  const { onAuthStateChanged } = authSdk();
  return onAuthStateChanged(auth(), callback);
}

export async function signOutUser() {
  await initFirebase();
  const { signOut } = authSdk();
  await signOut(auth());
  window.localStorage.removeItem('catTrainerRole');
  window.localStorage.removeItem('catTrainerFamilyId');
}

// The chosen role + family are remembered on the device so a tablet stays a
// tablet and Mom's phone stays Mom's phone across reloads.
export function rememberDeviceRole(role, familyId) {
  window.localStorage.setItem('catTrainerRole', role);
  window.localStorage.setItem('catTrainerFamilyId', familyId);
}
export function deviceRole() { return window.localStorage.getItem('catTrainerRole'); }
export function deviceFamilyId() { return window.localStorage.getItem('catTrainerFamilyId'); }
