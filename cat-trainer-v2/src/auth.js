// Authentication + pairing.
//  • Parent (Mom): passwordless email-link sign-in. Her account owns the family;
//    familyId == her uid.
//  • Child device (tablet): anonymous sign-in, then joins the family by entering a
//    short pairing code Mom generates. It holds a limited "child" role.

import { initFirebase, auth, authSdk } from './firebase.js';

const EMAIL_KEY = 'catTrainerEmailForSignIn';

// --- Parent: email link -------------------------------------------------------

export async function sendParentSignInLink(email) {
  await initFirebase();
  const { sendSignInLinkToEmail } = authSdk();
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };
  await sendSignInLinkToEmail(auth(), email, actionCodeSettings);
  window.localStorage.setItem(EMAIL_KEY, email);
}

// Call on page load — completes sign-in if the user arrived via the email link.
export async function completeEmailLinkIfPresent() {
  await initFirebase();
  const { isSignInWithEmailLink, signInWithEmailLink } = authSdk();
  if (!isSignInWithEmailLink(auth(), window.location.href)) return null;
  let email = window.localStorage.getItem(EMAIL_KEY);
  if (!email) email = window.prompt('Confirm your email to finish signing in:');
  const result = await signInWithEmailLink(auth(), email, window.location.href);
  window.localStorage.removeItem(EMAIL_KEY);
  // Clean the link params out of the URL.
  window.history.replaceState({}, document.title, window.location.pathname);
  return result.user;
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
