# Cat Trainer v2 — Handoff & Context

_Last updated: 2026-08-11. This is the durable source of truth for the rebuild.
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
| Latest integrated code | the **Pages/default branch** below — all merged work lives there. **Start new work by branching from it**, not from an old dev branch. |
| Live/Pages branch (default) | `claude/github-upload-sharing-e67k75` |
| Retired dev branches | `claude/homeschool-project-access-y60nsr` (early rebuild), `claude/cat-trainer-continuation-wc3zjm` (cache-bust + service worker + co-parent). Both fully merged into Pages — do not branch from these. |
| Live URL | https://xiateas-source.github.io/School/cat-trainer-v2/ |
| Legacy live URL | https://xiateas-source.github.io/School/cat-trainer/ |
| Firebase project | `xiatea-afc59` (Firestore **Standard** + Auth) |
| Family timezone | America/Chicago |

**Deploy method:** branch from the Pages/default branch → work → open a PR back
into the Pages branch → merge. GitHub Pages redeploys automatically (~1–2 min).
No build step; the app is plain ES modules + the Firebase CDN. Run
`node cat-trainer-v2/tools/stamp.mjs` before committing a deploy (§11).

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
- **Co-parent (Abba): his own email + password + a one-time invite code.** He joins
  Mom's *existing* family (never a second family) with the full 'parent' role —
  identical powers to Mom, own identity in the ledger. Mom generates the invite in
  Settings → "Invite Abba".
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
    ├── care.js           Hunger/Rest/Happiness decay + Care Charge tuning (pure/tested)
    ├── data/
    │   ├── cats.js        CAT_DEFS (nova/ember/moss + hero art)
    │   ├── quests.js      13 default quests, sections, section icons
    │   └── cafe-items.js  11 café items (IDs preserved from legacy)
    └── shared/
        ├── rewards.js     caps, hero thresholds, quick actions, bond values
        ├── ledger.js      point classification, legacy normalizer, day summaries, amount integrity
        ├── feedback.js    family-feedback delivery identity, claim lease, bundling
        └── dates.js       America/Chicago local-day logic + day-navigator math
```

## 5. Firestore data model

```
families/{familyId}                 familyId == parent's auth uid
  ownerUid, name, createdAt, settings{ allowNegative, dailyCap, timezone }
  members/{uid}                     { role:'parent'|'child', displayName, pairingCode? }
                                    (multiple 'parent' members allowed: Mom is the
                                     owner; Abba is a co-parent who joined by code)
  childProfiles/{childId='sirus'}   { name, activeCatId, available, coins, childCanSwitchCat,
                                      careCharges, lastCareCompletionId?, lastCareSpend?,
                                      lastCafePurchase?{ itemId, at }, cafeCat?{ x, y } }
    cats/{catId}                    { brain, energy, bond, evolved,
                                      catNeeds{ hunger, rest, happiness,
                                                lastUpdatedAt } }   (independent per cat)
    ownedCafeItems/{itemId}         { purchasedAt, price, x?, y?, placed? }
                                    (x/y = saved room position %; placed=false = tucked
                                     away in the shop. Absent x/y → a default slot;
                                     absent placed → shown. Child may edit these.)
  quests/{questId}                  { title, section, enabled, order, points, brain, energy, coins }
  pointTransactions/{txnId}         v2: { schemaVersion, childId, kind, category, reasonCode,
                                      reasonLabel, note?, requestedAmount, amount, balanceBefore,
                                      balanceAfter, activityDate, createdBy, createdByName, deviceId,
                                      createdAt, localDate, timeLabel, questCompletionId?,
                                      questAttemptId?, relatedTransactionId?, reversesTransactionId?,
                                      catId, rewardRequested{}, rewardApplied{}, bond, coins, brain, energy }
                                    (requestedAmount = full rule; amount = applied delta after the
                                     zero floor; activityDate drives the day view, createdAt drives
                                     audit order; rewardApplied = the only cat delta a reversal may undo)
  familyFeedback/{eventId}          one shared delivery queue (Slice 2). eventId is source-derived:
                                    pt_<txnId> (point_recognition) | qr_<attemptId> (quest_returned).
                                    { recipientChildId, type, sourceTransactionId?, sourceQuestCompletionId?,
                                      sourceQuestAttemptId?, actorId, actorName, amount, reasonLabel,
                                      parentNote, activityDate, createdAt, deliveryStatus, claimedByClientId,
                                      claimedAt, seenAt }   (child may change ONLY the delivery fields)
  questCompletions/{childId_questId_localDate}   deterministic id = dedupe key; carries attemptId (retry-unique)
pairings/{code}                     top-level { familyId, role:'child'|'parent', active, createdAt }
                                    (role:'child' = tablet pairing; role:'parent' = co-parent invite)
```

`kind` ∈ `adjust | quest | redeem | correction`; `category` ∈ `earned | used |
room_to_grow | correction`. Balance/earned/used-today for the dashboard are derived
from the ledger (`todayTotals`, screen-time only for "used"), so there's no reset
counter to drift.

## 6. Security rules (IMPORTANT)

Rules live in `firestore.rules` and **must be published in the Firebase console**
(Firestore Database → Rules → paste → Publish). They enforce:
- **Family isolation** — only signed-in members read/write a family's data.
- **Parent-only** — settings, quests, members, pairing codes, arbitrary point
  adjustments/redemptions, and **deleting ledger entries**.
- **Point transactions (v2)** — parent-only create, now schema-validated
  (classification, amount, activity date, actor = caller, server time); **update is
  denied** (financial rows are immutable; corrected status is derived from a linked
  correction). Delete stays parent-only — the rare admin permanent-delete path (§8b).
- **Family feedback** — parent-only validated create; the child may change ONLY the
  narrow delivery fields (`deliveryStatus`, `claimedByClientId`, `claimedAt`,
  `seenAt`), never actor/amount/reason/source.
- **Child** — may complete a quest once/day (amount validated against the stored
  quest), earn its rewards (monotonic, capped), buy café items, and **rearrange /
  put away its own café décor** (update `x/y/placed` on an owned item). That last
  update is guarded so the purchase record stays immutable — `price` +
  `purchasedAt` can't change and only a parent can delete an item. Café items
  grant no points/coins, so a child editing them can't manufacture value.
  A purchase is an atomic, server-validated pair: the child's Coins decrease by
  the catalog price while that exact previously-unowned item is created. The
  17-item price allowlist is mirrored in `firestore.rules` and checked by
  `tools/test-cafe-interactions.mjs`.
- **Membership joins** — a user can create only their *own* member doc, and only
  as (1) the family owner bootstrapping their parent membership, (2) a **co-parent**
  presenting an active `role:'parent'` invite code for the family, or (3) a child
  device presenting an active `role:'child'` pairing code. Codes are validated by
  the `validPairing(fid, code, wantRole)` helper. Either parent can now mint codes
  (`pairings` create/manage gated by `isParent(familyId)`, not just the owner).

> ⚠️ **Rules must be re-published in the console** (Firestore Database → Rules →
> paste `firestore.rules` → Publish). Until Mom does this, the affected feature is
> denied with "Missing or insufficient permissions." See `FIREBASE-SETUP.md` →
> "Publishing / updating the security rules."
> - **My Progress Slice 2 (2026-08-11): the `familyFeedback` rules MUST be published
>   before the Slice 2 app code goes live.** A positive recognition writes a feedback
>   event in the SAME atomic transaction as the point; without the collection's
>   rules, the whole write is denied and Good Choice / Yes ma'am / Hero's Reset /
>   quest-reject would fail. The tightened point-transaction rules are compatible
>   with the live Slice 1 code, so publishing early is safe.
> - **Latest change (2026-08-09): Hunger care** allows a child to stamp only the
>   migration-safe initial `catNeeds` value or perform a paired one-charge Hunger
>   refill. Charge earning must be paired with its new pending quest completion;
>   charge spending must be paired with the named cat's timestamped need write.
>   Lor published the first Hunger-care rules on 2026-08-09.
> - **Follow-up purchase correction (2026-08-09):** the published rule still
>   froze `coins` on every child write, which denied legitimate purchases (14
>   coins could not buy the 12-coin Cat Tree). The latest file validates an exact
>   catalog-price debit + new owned-item record. Lor published that corrected
>   Hunger/purchase version before PR #34 device testing.
> - **Three-need care follow-up (2026-08-09):** the latest file expands the same
>   atomic one-charge care transaction from Hunger to Rest and Happiness, permits
>   a migration-safe 80 starting value for those new fields, and prevents any
>   non-selected need from increasing. **Publish this newest rules file before
>   testing the Rest/Happiness branch.**
> - Earlier changes (co-parent login, ledger-delete) were already published on
>   2026-08-07; the café one is a *new* change on top.
>
> Co-parents are mutually trusted: any parent can edit/remove another parent's
> membership (`members` update/delete is `isParent(fid)`). Fine for a household.

**Setup ordering gotcha (already handled):** rules `get()/exists()` can't see
pending writes in the same batch. `setupFamily` therefore writes family → parent
member → (child+cats+quests) in awaited steps, and tolerates a permission-denied
on the first-run family existence check. Keep this ordering if you touch setup.

## 7. Assets

79 PNGs in `assets/`, transparent except `cafe-room.png` and the app-icon tiles
(intentionally opaque). Source of truth = Google Drive **"Cat Trainer Artwork"**
folder (owner `sirusxclass@gmail.com`), with subfolders: Pets, Hero Forms, Cat
Cafe, Activity Poses, Effects, UI Icons, Family. To replace/add one, download from
Drive, resize with Pillow (~150 café/fx sprites, ~200 cat sprites, 192/512 icons),
and check integrity (PNG IDAT CRC) before committing — `yarn-blue.png` shipped
corrupt once and had to be re-pulled.

Added 2026-08-07 from Drive: 6 café items (`bunting-pastel`, `pet-house-green`,
`pet-pillow-mint`, `bed-green-paws`, `collar-teal-heart`, `crown-gold-heart`);
`coin.png`; app icons (`icon-192/512`, `apple-touch-icon`); 12 cat poses
(`{nova,ember,moss}-{sit,play,eat,sleep,celebrate}`); the on-bed nap poses
(`{nova-blue-star,ember-green-paw,moss-pink-heart}-bed`, preserved but no longer
selected at runtime because coverage is inconsistent across cat × bed pairs); 4
effects (`fx-{sparkle,starburst,confetti,paw}`); and
section/reward icons (`night-routine`, `tidy-and-help`, `game-time-star`). Added
2026-08-09: 18 second animation frames for two-frame blink/play/eat/walk/sleep
loops across Nova, Ember, and Moss. Cat taps alternate play/celebrate reactions;
placed usable objects now select the matching lasting action. `fx-paw` is the
drag trail.
Still unused in Drive if wanted later: the Family-folder portraits and the
`.zip` bundles (bulk sources only).

Known art nit: **`ember-hero.png` looks almost identical to `ember.png`** — the
evolution won't feel special. Candidate for a fresher Drive asset.

## 8. Status — what works

- [x] Cross-device sync (Mom's phone ↔ Sirus's tablet, live)
- [x] Parent email+password sign-in; anonymous child device pairing (6-digit code)
- [x] Quick point actions + custom amount/reason
- [x] Screen-time redemption (record minutes used)
- [x] Undo last action (compensating correction)
- [x] Per-entry delete from the ledger (trashcan; reverses + removes) — being
      replaced in Slice 3 by append-only Correct entry + a rare admin permanent delete (§8b)
- [x] Quest completion once/day with points + Brain/Energy/Bond + coins
- [x] Cats: independent progress, active-cat selection, Hero Form + celebration
- [x] Cat Café: buy items with coins, decorate the room
- [x] **Interactive Cat Café**: drag décor to arrange (positions saved per item +
      synced), tap the cat (bounce + hearts) / tap an item (wiggle), and Put away /
      Place items from the shop. New items land in a stable default slot until moved.
      _(shipped 2026-08-07; **drag/put-away/place pending the rules re-publish** in §6
      — tap reactions work without it)_
- [x] **Café object actions (Slice 3A)**: placed bowls, beds/pillows/houses, and
      toys are role-tagged. In Play mode the cat walks to the newest tapped object,
      then visibly eats, sleeps, or plays; a new object or direct cat touch cleanly
      interrupts. Sleep persists until interrupted, Hero cats participate, and
      reduced-motion users get meaningful still poses. Decorative taps acknowledge
      without claiming a care refill.
- [x] **Device-note corrections on the Hunger branch**: tapping blank room space
      makes the cat walk there and save its location; water has a distinct free
      drink bob with the teal bowl visible; Toy Basket is explicitly mapped/tested
      as play; placed objects remain tappable beneath the cat PNG's transparent
      rectangle; and all cats use transparent sleep frames layered over the
      selected rest object instead of inconsistent signature-bed composites.
- [x] **Child café purchase authorization**: tablet purchases now pair a catalog-
      price Coin debit with the exact new item. This fixes the reported 14-coins /
      12-coin Cat Tree denial. Requires the latest rules republish above.
- [x] **Three-need care loop**: Hunger, Rest, and Happiness start Thriving at a
      testable 80 and decay from one stored timestamp at 35/25/20 per day (maximum
      48 hours per return). Existing Hunger-only cats receive fresh Rest/Happiness
      values without retroactive decay. Each quest tap immediately grants one
      flexible Care Charge up to 6 while permanent rewards still wait for parent
      approval. Food bowls refill Hunger, beds/pillows/houses refill Rest, and
      yarn/toys/the Cat Tree refill Happiness by up to +20 through an atomic
      one-charge transaction; a paid play refill also uses 5 Rest. Full/no-charge/save-failure paths never fake or
      waste a refill; water stays free and neutral. The lowest need gets one
      tappable guide to a compatible placed/stored object. Hero-care days remain
      the next progression slice.
- [x] **Notes on point changes**: Mom/Abba can attach a free-text note to any add,
      subtract, or screen-time redemption from the parent portal; it shows as a
      second line in the ledger. (No rules change.)
- [x] **Art expansion from Drive** (2026-08-07, no rules change): shop grew 11→17
      café items; the café cat cycles idle poses (sit/play/eat/sleep) on tap; real
      effect sprites (sparkle on cat-tap, starburst+confetti on Hero evolution,
      confetti on quest-complete) replaced the emoji; `coin.png` replaced the 🪙
      emoji in the child café; and real maskable PNG + Apple-touch app icons ship.
- [x] Sirus's read-only Point Log
- [x] Ledger with device attribution; America/Chicago day boundary
- [x] Service worker: offline app shell + installable PWA; cache purged per deploy
- [x] Co-parent login (Abba): own email+password, joins Mom's family by invite code,
      full parent powers, own ledger identity; header shows who's signed in
      _(shipped + rules published 2026-08-07; **pending first on-device test with
      Abba** — Mom generates the code in Settings, Abba redeems it via "I'm Abba")_

## 8b. My Progress & Point Ledger (spec: MYPROGRESSPOINTLEDGERSPEC2, Draft 0.4)

Day-based ledger feature built in slices on top of the audited `6cc2e0d`
baseline. New pure modules: `src/shared/ledger.js` (classification, legacy
normalizer, day summaries, amount integrity), `src/shared/feedback.js` (delivery
identity, claim lease, bundling), `src/shared/dates.js` (day navigator math).
Standalone node tests: `tools/test-ledger.mjs`, `tools/test-dates.mjs`,
`tools/test-feedback.mjs`.

- [x] **Slice 1 — Integrity & day-based ledger** (merged). Schema v2 with
      `requestedAmount` vs applied `amount`, `activityDate` vs posted time,
      `rewardRequested` vs `rewardApplied`, Mom/Abba name snapshot. Child Log →
      **My Progress** day view with full date navigator; parent **Point Ledger**
      day view + audit detail; "Used today" counts screen time only; over-limit
      redemption blocked; legacy rows normalized; selected-day/week queries with
      no 50-row ceiling; Firestore validates the new point-transaction schema.
- [x] **Follow-ups** (merged): quest rows read "Approved by", not "Noticed by";
      the child "Completed today" drawer stays open across background re-renders.
- [x] **Slice 2 — Shared family feedback & "You were noticed!"** (merged +
      device-tested). First durable shared feedback queue (`familyFeedback`).
      Device acceptance: **live recognition, away/reconnect delivery, bundling,
      returned-quest separation, no replay after seen, and Café overlay behavior
      all pass.** Still pending: **Abba (co-parent) attribution on-device
      confirmation.** Recognition events are created atomically with the point;
      returned-quest events are created atomically before the pending completion
      is deleted; claim-lease + seen transitions drive one-time delivery; child
      rules allow only the narrow delivery-field updates.
- [ ] **Slice 3 — Parent corrections & refinement** (D-07 confirmed; NOT started).
- [ ] **Slice 4 — Weekly reflection** (later).

### Decisions locked for Slice 3

- **D-07 confirmed in principle.** Normal ledger mistakes use an **append-only,
  linked _Correct entry_**: the original stays visible, the correction links via
  `reversesTransactionId`, the corrected pair is excluded from Earned/Used/
  Room-to-Grow totals (already true in the day summaries), and Firestore denies
  ordinary point-transaction **update** and ordinary **delete**. Use a
  deterministic correction identity (`corr_<originalId>`) so an original can't be
  corrected twice. "Undo last" becomes a linked correction of the latest entry.
- **Refinement — rare parent-only PERMANENT delete** (kept, separate from the
  correction path) for true cleanup only: test entries, accidental duplicates,
  junk data. It is an advanced/admin action, NOT the normal path, and must:
  - require an explicit confirmation;
  - reverse only **provable** balance/reward effects (a v2 row's `rewardApplied`;
    balance and coins are always provable);
  - atomically remove any linked `familyFeedback` event (deterministic
    `pt_<transactionId>`) so no orphaned recognition can appear later;
  - **block** deletion when linked effects cannot be safely proven (e.g. a legacy
    row claiming uncapped-unknown Brain/Energy/Bond), rather than guessing;
  - never reverse Care Charges, completed care, Hero-care days, needs, or
    `evolved` status (those Café outcomes stay forward-only).
  - Because this admin action is the only delete path, Firestore keeps
    `pointTransactions` **delete = parent-only** (update stays denied); the
    *ordinary* delete is removed from the UI, not from the rules.
- **Also in Slice 3 (Draft 0.4):** link Hero's Reset to a same-day Room-to-Grow
  event via `relatedTransactionId`; add **Add entry to this day** (backdating,
  preselecting the viewed activity date). Calendar jump + activity markers already
  shipped in Slice 1.

### Note on orphaned feedback (observed during Slice 2 testing)

The current pre-Slice-3 hard delete reverses a transaction but does **not** remove
its linked `familyFeedback` event, so hard-deleting recognition test transactions
left feedback docs behind. Slice 3's permanent delete fixes this going forward by
deleting `pt_<transactionId>` in the same transaction. **No cleanup migration is
required** — the already-orphaned test events are already-seen and harmless as
legacy data.

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
  name), so any changed file is a fresh URL (see §11). The stamp `FILES` list now
  includes `ledger.js`, `feedback.js`, and `polish.css`, and `restampHtml` stamps
  any local `src/*.js` script + `styles/*.css` link.
- **Co-parent join is device-remembered, not account-discoverable.** After Abba
  redeems the invite code once on a device, that device keeps him signed in and
  routed to the family (memory is keyed to his uid, so a shared device won't
  cross-route parents). But a *new* device — or after he signs out (which clears
  the memory) — needs a fresh invite code, because there's no server-side
  "which family is this uid in" index. If credential-only login on any device is
  wanted later, add a small `userFamilies/{uid}` reverse-lookup doc written at
  join/setup and read on sign-in. Invite/pairing codes also never expire or get
  single-used (same as the child codes) — acceptable for one household.
- **Anti-tamper is rules-based, not Cloud-Functions-based.** A determined user
  with dev tools on the tablet could submit off-spec gameplay writes. Fine for a
  single household; move quest completion into a Cloud Function (Blaze plan) if
  stronger guarantees are ever needed.
- **Ember hero art** is weak (§7).
- **Advanced pet health is deliberately post-MVP.** Sirus wants recoverable
  sickness, balanced too-much/too-little care, purchasable medicine, and visible
  consequences. `CAFE-GOAL.md` §5.6 preserves the request with no-death, no-loss,
  no-shame, and free-recovery guardrails.

## 10. Future features / backlog

- "Add to Home Screen" art polish — **done 2026-08-07** (maskable `icon-192/512`
  + `apple-touch-icon` from Drive's `app-icon-nova`). Service worker + offline: done.
- Quest reordering UI + enable/disable toggles in the parent Quests screen
  (data already supports `order` and `enabled`).
- Daily screen-time cap (setting exists as `dailyCap`, not yet enforced/surfaced).
- "Guided sequence" option for morning/night routines (unlock one at a time).
- Movement-only "cardio cat" / school-only "scholar cat" variants.
- Real cat facts unlocked per new cat (sneaky science).
- Weekly "boss cat" needing a bigger combined effort.
- Multiple children (schema is close; childProfiles is already a collection).
- Fresher `ember-hero.png`.
- Fourteen-day `heroCareProgress`, advancing only on distinct active days when
  the cat's three daily needs are at least Okay.
- Mom, Abba, Sirus, and Arlo as selectable Café visitors (avatars already exist).
- My Progress Slice 4: Week view + behavior-pattern summary (no ranking/percent).
- After the full three-need loop: Sirus's recoverable health/medicine expansion
  from `CAFE-GOAL.md` §5.6.

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
