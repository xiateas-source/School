// ⬇️ PASTE YOUR FIREBASE CONFIG HERE ⬇️
// After you create your free Firebase project (see FIREBASE-SETUP.md), Firebase
// gives you a small block that looks exactly like the one below. Replace the
// placeholder values with the real ones. This is the ONLY file you need to edit.
//
// These values are NOT secret — they only identify your project. Access is
// protected by the security rules, not by hiding this config.

export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId: 'PASTE_APP_ID'
};

// Set to true automatically once real values are pasted (used to show a friendly
// "finish setup" message instead of a crash while the placeholder is still here).
export const isConfigured = !firebaseConfig.apiKey.startsWith('PASTE_');
