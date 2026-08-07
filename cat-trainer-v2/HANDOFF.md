# Cat Trainer v2 — Handoff & Context

_Last updated: 2026-08-07. This is the durable source of truth for the rebuild.
If you're a fresh session picking this up, read this file first._

---

## 1. What this is (one paragraph)

Cat Trainer is a **synchronized family screen-time point system** presented as a
cozy cat-training game. **1 point = 1 minute of screen time** (all screen time,
not just the Switch). Mom manages points from her phone; Sirus (upper-elementary)
sees his balance live on his tablet and plays. Real-life choices and daily quests
train three cats — **Nova, Ember, Moss** — through **Brain, Energy, Bond, Hero
Forms, Cat Coins, and a customizable Cat Café**. The cats make the existing point
system engaging; they never replace it or turn accountability into shame.

## 2. Where everything lives

| Thing | Value |
|---|---|
| Repo | `xiateas-source/School` |
| New app folder | `cat-trainer-v2/` (the legacy app in `cat-trainer/` is untouched) |
| Dev branch | `claude/homeschool-project-access-y60nsr` |
| Live/Pages branch (default) | `claude/github-upload-sharing-e67k75` |
| Live URL | https://xiateas-source.github.io/School/cat-trainer-v2/ |
| Legacy live URL | https://xiateas-source.github.io/School/cat-trainer/ |
| Firebase project | `xiatea-afc59` (Firestore **Standard** + Auth) |
| Family timezone | America/Chicago |

**Deploy method:** work on the dev branch → open a PR into the Pages branch →
merge. GitHub Pages redeploys automatically (~1–2 min). No build step; the app is
plain ES modules + the Firebase CDN.

## 3. Locked product decisions (confirmed with Mom)

- **Balance model: carryover + redeem.** Points bank into an `available` balance
  that carries day to day. Mom records screen time used to draw it down. The
  dashboard shows Available + earned/used today. (The legacy app reset daily — we
  deliberately changed this.)
- **Hero's Reset = +2 Bond** (same as "Yes, ma'am/sir").
- **Hero Form** unlocks at **Brain ≥ 12 AND Energy ≥ 12**; Brain/Energy are never
  spent. Caps: Brain 12, Energy 12, Bond 20.
- **Parent auth: email + password** (first sign-in creates the account). We tried
  passwordless email-link first — unreliable on mobile — and replaced it.
- **Child device: anonymous auth + 6-digit pairing code.** Limited "child" role.
- **Negative adjustments never remove** Brain/Energy/Coins/Bond/Hero progress.
- **Cat Coins** buy café items only; never exchangeable for screen time.
- **No Cloud Functions** (stays on the free Spark plan). Security is enforced by
  Firestore rules. This covers the realistic threat (a child poking the tablet)
  but is not fully tamper-proof — see §9.

## 4. Architecture / file map

```
cat-trainer-v2/
├── index.html            role gate + parent shell + child shell + dialogs
├── firebase-config.js    project config (not secret)
├── firestore.rules       security rules (MUST be published in the console)
├── manifest.webmanifest  installable PWA
├── sw.js                 service worker: offline shell + cache purge (§9)
├── styles/base.css       cozy storybook UI, responsive phone + tablet
├── assets/               26 PNGs (see §7)
├── tools/
│   └── stamp.mjs         cache-bust: stamps ?v=<hash> on imports/entry/CSS + sw.js (§11)
└── src/
    ├── app.js            orchestrator: auth flow, routing, rendering, events
    ├── firebase.js       modular SDK init from CDN + offline persistence
    ├── auth.js           parent email+password, anonymous child, device memory
    ├── store.js          realtime subscriptions + transaction-safe writes
    ├── data/
    │   ├── cats.js        CAT_DEFS (nova/ember/moss + hero art)
    │   ├── quests.js      13 default quests, sections, section icons
    │   └── cafe-items.js  11 café items (IDs preserved from legacy)
    └── shared/
        ├── rewards.js     caps, hero thresholds, quick actions, bond values
        └── dates.js       America/Chicago local-day logic
```

## 5. Firestore data model

```
families/{familyId}                 familyId == parent's auth uid
  ownerUid, name, createdAt, settings{ allowNegative, dailyCap, timezone }
  members/{uid}                     { role:'parent'|'child', displayName, pairingCode? }
  childProfiles/{childId='sirus'}   { name, activeCatId, available, coins, childCanSwitchCat }
    cats/{catId}                    { brain, energy, bond, evolved }   (independent per cat)
    ownedCafeItems/{itemId}         { purchasedAt, price }
  quests/{questId}                  { title, section, enabled, order, points, brain, energy, coins }
  pointTransactions/{txnId}         { childId, amount, kind, reasonCode, reasonLabel,
                                      bond, coins, brain, energy, catId, questId?,
                                      createdBy, deviceId, createdAt, localDate, timeLabel }
  questCompletions/{childId_questId_localDate}   deterministic id = dedupe key
pairings/{code}                     top-level { familyId, role:'child', active, createdAt }
```

`kind` ∈ `adjust | quest | redeem | correction`. Balance/earned/used-today for the
dashboard are derived from the ledger (`todayTotals`), so there's no reset counter
to drift.

## 6. Security rules (IMPORTANT)

Rules live in `firestore.rules` and **must be published in the Firebase console**
(Firestore Database → Rules → paste → Publish). They enforce:
- **Family isolation** — only signed-in members read/write a family's data.
- **Parent-only** — settings, quests, members, pairing codes, arbitrary point
  adjustments/redemptions, and **deleting ledger entries**.
- **Child** — may complete a quest once/day (amount validated against the stored
  quest), earn its rewards (monotonic, capped), and buy café items.

> ✅ The rules were updated when the per-entry delete (trashcan) was added
> (`pointTransactions … allow delete: if isParent(fid)`) and have been
> **published in the console** (confirmed 2026-08-07). If you change
> `firestore.rules` again, re-publish it there or the new behavior is denied.

**Setup ordering gotcha (already handled):** rules `get()/exists()` can't see
pending writes in the same batch. `setupFamily` therefore writes family → parent
member → (child+cats+quests) in awaited steps, and tolerates a permission-denied
on the first-run family existence check. Keep this ordering if you touch setup.

## 7. Assets

26 PNGs in `assets/`, transparent except `cafe-room.png` (intentionally opaque).
Verified correct. Source of truth = Google Drive originals (file IDs are in the
original project handoff). To replace one, download from Drive, resize to ~150×150
(the café/cat sprites) with Pillow, and check integrity (PNG IDAT CRC) before
committing — `yarn-blue.png` shipped corrupt once and had to be re-pulled.

Known art nit: **`ember-hero.png` looks almost identical to `ember.png`** — the
evolution won't feel special. Candidate for a fresher Drive asset.

## 8. Status — what works

- [x] Cross-device sync (Mom's phone ↔ Sirus's tablet, live)
- [x] Parent email+password sign-in; anonymous child device pairing (6-digit code)
- [x] Quick point actions + custom amount/reason
- [x] Screen-time redemption (record minutes used)
- [x] Undo last action (compensating correction)
- [x] Per-entry delete from the ledger (trashcan; reverses + removes)
- [x] Quest completion once/day with points + Brain/Energy/Bond + coins
- [x] Cats: independent progress, active-cat selection, Hero Form + celebration
- [x] Cat Café: buy items with coins, decorate the room
- [x] Sirus's read-only Point Log
- [x] Ledger with device attribution; America/Chicago day boundary
- [x] Service worker: offline app shell + installable PWA; cache purged per deploy

## 9. Known issues / limitations

- **Service worker (`sw.js`) — now shipped, and designed to pair with the cache
  stamp so it does NOT reintroduce stale modules.** Strategy: version-stamped
  requests (any `?v=` URL: modules + CSS) are **cache-first** (immutable per URL,
  so a deploy's new URL is always a fresh fetch); the HTML document is
  **network-first** with a cache fallback for offline; other same-origin assets
  are **stale-while-revalidate**. Cross-origin Firebase (CDN + Firestore) is
  **not intercepted**, so realtime sync and Firebase's own offline persistence
  are untouched. On `activate` it deletes every old `cat-trainer-v2-*` cache and
  claims clients, so `skipWaiting` + a new hash = old code gone next load. The
  SW's cache name is stamped with the same content hash as the modules
  (`tools/stamp.mjs`), so bumping a version is automatic. It's registered with
  `updateViaCache:'none'` so the SW script itself is never served stale.
  - _Caveat:_ `index.html` is network-first, so online users get fresh HTML; if
    a device is fully offline at deploy time it keeps the last cached shell until
    it's online again (expected offline behavior).
  - _Not stamped:_ image assets (a stale image is cosmetic, not app-breaking).
    Add them to `FILES`/`restampHtml` in the stamp script if art updates ever
    need instant busting.
- **Module cache — handled by the cache-bust stamp.** ES modules aren't
  versioned, so a phone used to serve an old module after a deploy. Running
  `node tools/stamp.mjs` before each deploy appends a content-hash `?v=…` query
  to every local import + the entry script + the CSS link (and the SW cache
  name), so any changed file is a fresh URL (see §11).
- **Anti-tamper is rules-based, not Cloud-Functions-based.** A determined user
  with dev tools on the tablet could submit off-spec gameplay writes. Fine for a
  single household; move quest completion into a Cloud Function (Blaze plan) if
  stronger guarantees are ever needed.
- **Ember hero art** is weak (§7).

## 10. Future features / backlog

- "Add to Home Screen" art polish — the manifest ships an SVG icon (installs
  fine); add maskable PNG icons (192/512, `purpose:"maskable"`) + Apple
  touch-icon for a crisper iOS home-screen tile. (Service worker + offline: done.)
- Quest reordering UI + enable/disable toggles in the parent Quests screen
  (data already supports `order` and `enabled`).
- Daily screen-time cap (setting exists as `dailyCap`, not yet enforced/surfaced).
- "Guided sequence" option for morning/night routines (unlock one at a time).
- Movement-only "cardio cat" / school-only "scholar cat" variants.
- Real cat facts unlocked per new cat (sneaky science).
- Weekly "boss cat" needing a bigger combined effort.
- Multiple children (schema is close; childProfiles is already a collection).
- Fresher `ember-hero.png`.

## 11. How to make a change & deploy

1. Edit files under `cat-trainer-v2/` on the dev branch.
2. `node --check` each changed ES module (they use import syntax; check as `.mjs`).
3. Run `node tools/stamp.mjs` to refresh the cache-bust `?v=` stamps. It's
   idempotent and content-hashed, so it only rewrites files whose content
   actually changed — always run it before committing a deploy, then commit the
   stamped result.
4. Commit, push the dev branch.
5. Open a PR into `claude/github-upload-sharing-e67k75` and merge → Pages redeploys.
6. If you changed `firestore.rules`, tell Mom to re-publish them in the console.
7. Test on device. Thanks to the stamp, changed modules refresh on their own;
   only `index.html` itself is subject to Pages' ~10-min cache (or one hard
   refresh) — see §9.

## 12. Rollback

The legacy app at `cat-trainer/` is untouched and still live — it's the fallback.
Data lives in Firestore regardless of which front-end is served, so reverting the
Pages content does not lose family data.

## 13. Acceptance criteria (from the original brief) — status

Cross-device points ✅ · negative adjustment (no cat loss) ✅ · custom adjustment ✅
· quest once/day ✅ · Hero Form ✅ · screen-time redemption ✅ · café coins only ✅
· child can't submit arbitrary points / edit settings ✅ · family isolation ✅ ·
duplicate quest completions blocked ✅ · persistence across reloads/devices ✅.
Remaining: offline-loss hardening (needs service worker), stronger anti-tamper
(optional Cloud Functions).
