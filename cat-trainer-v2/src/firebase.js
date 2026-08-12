// Firebase initialization. Loads the modular SDK from Google's CDN (no build step
// needed — this works directly on GitHub Pages) and enables offline persistence
// so a tablet with flaky wifi queues actions and replays them on reconnect.

import { firebaseConfig, FIREBASE_SDK_VERSION, isConfigured } from '../firebase-config.js?v=ea220299';

const V = FIREBASE_SDK_VERSION;
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

export { isConfigured };

let _app = null;
let _auth = null;
let _db = null;
let _authModule = null;
let _dbModule = null;

// Lazily import + initialize so screens can show a friendly "finish setup"
// message instead of crashing while the config placeholder is still in place.
export async function initFirebase() {
  if (_app) return { app: _app, auth: _auth, db: _db };

  const [{ initializeApp }, authModule, dbModule] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`)
  ]);

  _app = initializeApp(firebaseConfig);
  _authModule = authModule;
  _dbModule = dbModule;
  _auth = authModule.getAuth(_app);

  // Offline-first: cache data locally and sync across tabs.
  try {
    _db = dbModule.initializeFirestore(_app, {
      localCache: dbModule.persistentLocalCache({
        tabManager: dbModule.persistentMultipleTabManager()
      })
    });
  } catch (err) {
    // Fallback if persistence can't be enabled (e.g. private browsing).
    console.warn('Firestore persistence unavailable, using memory cache.', err);
    _db = dbModule.getFirestore(_app);
  }

  return { app: _app, auth: _auth, db: _db };
}

// Accessors for the raw SDK modules so other files don't re-import the CDN.
export function auth() { return _auth; }
export function db() { return _db; }
export function authSdk() { return _authModule; }
export function dbSdk() { return _dbModule; }
