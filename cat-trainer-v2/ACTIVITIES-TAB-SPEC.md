# Cat Trainer — Activities Tab

**Status:** Draft 0.5 — reconciled with Quest spec + current code (`cat-trainer-v2`)
**Date:** August 12, 2026
**App:** Cat Trainer / Sirus app
**Feature type:** Child activity library + constructive screen-time earning path
**Ownership:** Activities is the **autonomy** system. It OWNS optional self-directed activities, the movement/create/build/discover/play library, approved links, Favorites, and Surprise Me. It **consumes** Quest-owned contracts (`QUEST-TAB-SPEC.md` §26) and the existing My Progress ledger. Implement **after Quest.**

---

## 0. What this spec does NOT own (dependencies, not duplication)

| Needed here | Owner | Consumed via |
|---|---|---|
| Daily Essentials / required-task status | Quest | read-only reflection (§2.3) |
| First → Then sequence cue | Quest | Quest §26.1 |
| The non-locking rule for First→Then | Quest | Quest §9.1 (do not restate) |
| Approval-mode enum `parent \| self \| together` + self-complete security model | Quest | Quest §26.2 |
| Shared **Needs You** parent attention queue | Quest | Quest §26.3 |
| "No double reward" rule for a Quest that points at a Move activity | Quest | Quest §19.1 |
| Point economy `1 pt = 1 min`, ledger schema, My Progress history | My Progress (external) | §14 |
| Timers / Beat the Clock / game wrappers | Quest | not implemented here (§7) |
| I need help / read-aloud / support fading / independence | Quest | not implemented here |
| Navigation slot (shared, unresolved) | Shared | Quest §26.4 |

Everything below is Activities-owned unless a row above says otherwise.

---

## 1. Purpose

Add an **Activities** area where Sirus can independently choose constructive things to do for fun and earn screen-time points for completing them.

Activities are voluntary, developmentally appealing options: drawing/creative prompts; building challenges; experiments/discovery; workouts/movement; imaginative play; cooking/making; and approved videos, tutorials, games, printables, or webpages selected by Mom/Abba.

The feature solves three problems:
1. Sirus needs a reusable **"What can I do?"** library that supports independence and choice.
2. Because **1 point = 1 minute**, reaching a larger goal (e.g. 45 min) needs many legitimate earning opportunities; Activities add a positive, child-chosen path alongside responsibilities and recognition.
3. Voluntary Activities must coexist cleanly with **Daily Essentials** so fun choices don't become a way to postpone required responsibilities.

Activities must remain a **choice-based library**, not absorb the rules for mandatory daily tasks (those are Quest-owned).

---

## 2. Relationship to the reward system

The family point economy is authoritative and **defined externally** (My Progress / Point Ledger, `shared/ledger.js`). Activities consumes it and must not fork it:

- **1 point = 1 minute** of Available screen time.
- A normal Activity completion earns **+1 point / +1 minute** unless a deliberate decision changes a specific activity.
- Activity rewards appear as **Earned** events in My Progress, tagged as Activity (§14).
- Activity rewards never create debt and follow existing balance/accounting integrity.
- Activities do not change the meaning or value of Quests.

### 2.1 Three earning paths — defined in Quest §2
The canonical three-path model (Quests / Activities / Recognition) lives in `QUEST-TAB-SPEC.md` §2. Activities is the **voluntary** path. Do not restate the table here; keep the three distinguishable in history.

### 2.2 No double reward — rule owned by Quest §19.1
A single action must not silently generate two rewards. The specific case "a Quest that says *do a Move activity*" is resolved by **Quest §19.1** (default: prompt-only, no stacking). Activities must honor that outcome and must not separately award a point for an Activity that a prompt-only Quest already represents. This must be settled before the Move library ships alongside the existing `v-move` Quest.

### 2.3 Daily Essentials boundary — status owned by Quest
Mandatory daily tasks **do not become Activities**; they remain Quests (`QUEST-TAB-SPEC.md` §2.1). Mental model: **Must do → Daily Essentials/Quests · Choose to do → Activities · Caught doing well → Recognition.**

**Migration inflow (Quest §18.1):** the reverse also holds. During migration, every existing Quest is audited, and any that is an *optional self-directed choice* (a likely candidate: the current `v-move` "Complete a movement challenge" and most `General`-bucket items) **moves into this Activities library** rather than staying in Quest by inertia. Such migrated items earn through the Activity path (`kind:'activity'`, **no** Care Charge or cat stats — §14/§15) and must not double-reward against any prompt-only Quest that points at them (§2.2). Independence Mastery does **not** follow them: mastery is a Quest-only concept for recurring responsibilities (Quest §16.3), not for voluntary Activities.

Activities may **reflect** the Quest-owned First→Then cue (Quest §26.1) — e.g. `First: Morning Essentials → Then: Choose what's next` — but:
- this is a **read-only visual reflection**, never a lock on Activities or on already-earned screen time (the non-locking rule is Quest §9.1 — not restated here);
- all required/optional flags, schedules, windows, reminders, timers, Routine Mode, and First→Then rules live in `QUEST-TAB-SPEC.md`;
- Activities never substitute for a required Essential unless Mom/Abba explicitly configure that;
- until Quest ships the §26.1 read model, Activities shows **no** routine cue and simply presents the library.

---

## 3. Core product principles

1. Choice is part of the reward.
2. Completion earns the point, not opening the card.
3. Repeat real effort (repeatable activities may earn again — §6).
4. Don't turn enthusiasm into a loophole; repetition rules live on the activity.
5. Parent-curated internet access only.
6. No general web search from the child screen — the library is a launcher for approved resources.
7. AI proposes; parents approve (§13).
8. Activities remain fun — not a compliance metric.
9. Keep the point economy predictable — default `+1`, no randomized amounts.
10. Reuse existing account integrity — no second balance/ledger.
11. Voluntary stays voluntary — enjoying/repeating an Activity never reclassifies it as mandatory.
12. Required tasks stay visible without shame — Activities reflect the Quest cue but never confiscate minutes or add failure language (Quest §9.1 owns the rule).
13. Independence can be graduated — via the shared approval-mode contract (Quest §26.2), not an Activities-specific mechanism.

---

## 4. Child navigation and screen

Add a child-facing **Activities** destination. **Placement is a shared, unresolved decision** — see Quest §26.4 (the bottom-nav already has 5 items; a 6th risks crowding). Do not assume a fixed placement in code.

### 4.1 Screen hierarchy
1. **Activities** title
2. **What fits right now?** context picker
3. Optional **Surprise Me**
4. Category chips
5. Optional **Favorites** filter
6. Activity cards

If Quest exposes the First→Then cue (§26.1), surface it read-only. Never imply Activities or earned screen time are locked (Quest §9.1).

Category set (starting point): **Create · Build · Discover · Move · Play · Make**.

### 4.2 "What fits right now?" context picker
Filters/tags: **Time** (5/10/20+ min) · **Energy** (High/Quiet) · **Supplies** (None/Needed) · **Connection** (Offline/Online) · **Place** (Indoors/Outdoors). Child-friendly, optional (not a required form). The same tags feed Surprise Me (§10) — one tag set, no separate recommendation engine.

### 4.3 Activity card
Quickly understandable; e.g. `⚡ 10-Minute HIIT · High energy · 10 min · +1 min · Start`. After completion: `Nice workout! +1 minute earned · Done 3 times today · Do Again`. Possible fields: title, short description, category, estimated time, energy/supplies/online tags, supplies, `+1 min`, repeat status, linked/offline indicator, approval mode (**Self-complete** / **Needs approval**), **Mom/Abba Approved** source marker, favorite state, Start/Open/Do Again. Long instructions go in a detail view, not on the card.

---

## 5. Activity types

**Offline** or **Linked**.

### 5.1 Offline
No internet resource (Draw a monster, Build the tallest tower, Make a comic, etc.). May carry a short in-app instruction/detail view.

### 5.2 Linked
Mom/Abba attach a specific approved link (drawing tutorial, workout video, experiment page, printable, educational game, recipe, museum resource, specific child-appropriate video). The child card shows friendly info, never an editable URL field.

### 5.3 Link containment boundary
Approving a starting URL controls **which link Sirus launches from Cat Trainer**. It does **not** guarantee he can't navigate elsewhere after the external browser/site opens. Only safety promise:

> **Cat Trainer will not intentionally present Sirus with an unapproved Activity link.**

Stronger containment (approved-domain restriction, controlled in-app view, device parental controls) is separate technical research and must not be implied as solved (A-08).

---

## 6. Repeatable activities  *(Activities-owned; Quests are once-per-day)*

Repeated constructive activity is supported. A repeatable **10-Minute HIIT** done three separate times may create three `+1` rewards — genuine effort (30 min of movement), not farming.

### 6.1 Repeat modes (per activity)
- **Repeatable** — earns again each valid completion.
- **Once today** — only the first valid completion each activity date earns.
- **One time** — after completion, stays in history but no longer earns.

No global daily Activity cap in this draft; the family controls repetition per activity.

### 6.2 Completion integrity
Distinguish **Start/Open** (launch) → **Complete** (Sirus says finished) → **Rewarded** (the point transaction actually exists under the approval model). Opening and closing a webpage must never mint a point.

### 6.3 Per-activity approval mode — **shared contract, Quest §26.2**
Each Activity uses one of `parent | self | together` (the same enum and the same security model as Quests). Examples: HIIT → Self-complete or Parent approves; Draw a Picture → Self-complete; Read 15 Minutes → Parent approves; Make a Recipe Together → Do together.

**Important security note (do not design around it):** self-complete rewards **cannot be minted from the child device under current `firestore.rules`** (ledger is parent-write only; see §14.2 and Quest §26.2). Until the shared self-complete mechanism ships, an Activity may be *configured* Self-complete but its reward write falls back to parent settlement. This is one decision for the whole app, owned by Quest §26.2 — Activities does not solve it independently.

Graduated trust is per-Activity, not a child-wide switch. A self-complete Activity still obeys repeat rules and transaction integrity and never lets Sirus edit the reward, definition, URL, or approval setting.

---

## 7. Movement and workout support  *(library owned here; timers owned by Quest)*

**Move** is a first-class Activities category (HIIT, Energy Blast, Animal Moves, Ninja Training, Floor Is Lava, Dance, Superhero, Obstacle Course, Balloon Keep-Up, Sock Basketball, Balance, Jump, Yoga, Stretch, Walk, Playground). Workouts support **Do Again** when repeatable.

Activities defines **no timers or Beat-the-Clock** — those are Quest-owned (Quest §11). A Move card's "10 min" is an estimated-time *tag*, not a running timer. Acknowledge movement simply (`You moved 3 times today!`); no calorie counts, body metrics, or performance rankings.

Interaction with the existing `v-move` Quest is governed by Quest §19.1 (no double reward).

---

## 8. Developmentally fun activity design

Favor experiences giving a 7–8-year-old agency/choice, visible challenge, making/inventing, silliness, puzzles/mystery, movement, imaginative roles, growing competence, and chances to teach/perform/show. (Example pools per category retained as starter content — see §19.)

---

## 9. Favorites and reuse  *(Activities-owned)*

Sirus may mark Activities as **Favorites** — autonomy without a recommendation engine, and a natural signal of what he actually chooses. Child filters: All · Favorites · Create · Build · Discover · Move · Play · Make. Favorites are private preference state, never public popularity scores or comparisons.

---

## 10. Surprise Me  *(Activities-owned; parallel to Quest's Mystery Pick)*

A **Surprise Me** action picks one eligible Activity, reusing the same context tags as **What fits right now?** (category, time, indoor/outdoor, energy, supplies, linked/offline, repeat-eligibility today). When Sirus has set filters, Surprise Me chooses from that filtered set. It changes the *suggestion*, never the reward amount.

> Distinct from Quest's **Mystery Pick** (§12 there), which picks a *required Quest*. Do not merge the two.

---

## 11. Parent activity management  *(separate surface from Quest CRUD)*

### 11.1 Add Activity
Fields: **Title** (req) · Short description · **Category** (req) · **Activity type** Offline/Link · **Link** (req for Link) · Estimated minutes · Supplies · **Repeat mode** · **Approval mode** (§6.3) · **Reward** (default `+1`, fixed) · **Active** · **Context tags**. Later: thumbnail, approved domain/source, age note, parent note.

### 11.2 Parent control
Only Mom/Abba may create an Activity, edit its link, disable/archive it, change repeat/approval mode, approve an AI-suggested Activity, or manage trusted sources/domains. Sirus may browse, start, favorite, and submit completion per child permissions, but cannot add arbitrary links.

### 11.3 Shared parent-attention integration — **Needs You is Quest-owned (§26.3)**
A waiting **Parent approves** Activity surfaces in the same **Needs You** queue as Quests, labeled **Activity**, source never blurred. Batch review may include straightforward Activity submissions while preserving per-completion integrity. **I need help remains Quest-owned** (Activities does not implement help). Activity configuration stays in the Activities surface; rewarded Activity events remain auditable through My Progress + Activity detail, never misfiled as Quest events.

---

## 12. Approved internet launcher and trusted sources

Activities is Sirus's **curated starting point for online content**: instead of searching the open web, Mom/Abba place the specific resource in his library first. Pattern: **want something to do → Activities → category → open an approved resource.**

### 12.1 Two levels of parent trust
1. **Approved Activity link** — this exact starting resource is approved.
2. **Trusted source/domain** — a broader source marked acceptable for future parent-side discovery/review.
A linked card may show **Mom/Abba Approved**. Sirus never manages the trusted-source list. Trusted domains constrain what the app/AI may suggest; they do not make all content on a site permanently safe.

### 12.2 Containment is a separate problem
This feature does not replace OS/browser parental controls; it reduces open-ended searching. Approving a source/URL does not prevent ads, recommendations, comments, outbound links, or changed content. Stronger navigation containment is a separate decision (A-08).

---

## 13. Future AI-assisted activity discovery  *(parent-side, later)*

AI is a **future parent-side** feature, not the first slice. Mom/Abba ask for something specific → AI returns proposed Activity cards (title, source, URL, category, time, supplies, a short parent-facing reason), each **Pending Review**. Nothing reaches Sirus until Mom/Abba **Approve**. A trusted-domain list can later restrict suggestions to approved sources. AI is never proof a page is permanently safe and never mints points or bypasses parent link approval.

---

## 14. My Progress / Point Ledger integration  *(external contract — §20 Quest / `shared/ledger.js`)*

Activity rewards use the **same** point source of truth as Quests and Recognition. A successful reward creates an **Earned** transaction identifying its Activity source (e.g. `+1 Activity: 10-Minute HIIT`). Parent detail may add Activity ID, repeat mode at completion, completion number for that activity/date, submitted/approved times, and linked source metadata.

### 14.1 Transaction extension (must extend, not fork, the shipped schema)
The ledger needs an explicit Activity source:

```js
{
  kind: 'activity',            // NEW — see 14.2
  category: 'earned',          // existing category, already valid in rules
  sourceActivityId: '<id>',
  reasonLabel: '10-Minute HIIT',
  requestedAmount: 1,
  amount: 1,
  activityDate: '2026-08-10',
  // existing balance + actor/audit fields (balanceBefore/After, createdBy, createdAt, ...)
}
```

### 14.2 Current-code blockers (must be resolved before coding — see Firebase §16.1)
- **`kind:'activity'` is currently rejected.** `shared/ledger.js` `classifyTransaction` has no `activity` case, and `firestore.rules` `validPointKind` allows only `adjust | quest | redeem | correction`. Both must add `activity` (classify → `earned`, with **zero** cat/coin reward and **no** Care Charge).
- **The child cannot write the ledger.** Rules make `pointTransactions` parent-write only, so a **Self-complete** Activity cannot mint its `+1` from the tablet today. This is the same blocker as self-complete Quests and is decided once in Quest §26.2. `Parent approves` Activities work within the current model (parent writes the row on approval, mirroring `approveCompletion`).

Do not create a parallel ledger schema. Reconcile field shape against the live My Progress contract before coding.

---

## 15. Relationship to the Café

Activities are a **screen-time point feature only.** By default an Activity completion earns its screen-time point and appears as **Earned**, but does **not** grant a Care Charge, Cat Coins, Brain, Energy, or Bond, and does not change Hunger, Rest, Happiness, Hero-care days, décor, or cat state. This keeps Activities from becoming a second Quest implementation. Any future Café contribution is an explicit, separately-tested decision.

*(Contrast: Quests DO grant a Care Charge on completion — Quest §4. The Activity ledger writer must therefore be a distinct path that omits the Care Charge and cat-stat writes present in `completeQuest`/`approveCompletion`.)*

---

## 16. Firebase / security-rule / index implications

### 16.1 Rules (`firestore.rules`)
- **`validPointKind`** must accept `'activity'` (currently 4 kinds). Category stays `earned` (already valid).
- **Activity reward writes stay parent-only** under the current model. Self-complete requires the shared mechanism in Quest §26.2 (Cloud Function or child-writable "pending self-earn"); do not loosen the blanket ledger rule ad hoc.
- **New collections** (parent-write, member-read), mirroring the `quests` pattern:
  - `activities/{activityId}` — parent CRUD; `allow read: if isMember`, `create/update/delete: if isParent`.
  - `activityCompletions/{id}` — like `questCompletions`: child may create a **pending** submission for `Parent approves`; repeat modes need an id scheme that permits multiple same-day completions for `Repeatable` (e.g. `sirus_<activityId>_<date>_<n>` or an attempt id), unlike the once-per-day quest id.
  - Favorites — either a child-writable `activityFavorites/{activityId}` doc (narrow, no reward) or a field on the child profile; keep it out of any reward path.
  - Trusted sources/domains — parent-only.
- **No Care Charge for Activities:** the child-profile care-earn rule (`validCareEarn`) is keyed to a `questCompletions` doc; an Activity completion must **not** touch `careCharges`, so no rule change is needed there — just ensure the Activity writer never increments care.

### 16.2 Indexes
- Current queries are single-field equality (auto-indexed) by design. Keep Activity queries the same: filter `activityCompletions` by `status`/`localDate` and sort in memory (as `store.js` does for pending approvals and the day view) to **avoid composite indexes**.
- Ledger day-view already unions `activityDate` + `localDate` single-field queries; `kind:'activity'` rows carrying `activityDate` slot in with **no** new index.

### 16.3 Schema version
Activity rows use `schemaVersion: 2` and the same required fields the rules validate (`childId`, `requestedAmount`, `amount`, `activityDate` matching the date regex, `createdBy == auth.uid`, `createdAt == request.time`).

---

## 17. Open product decisions

| ID | Question | Current direction |
|---|---|---|
| A-01 | Activities nav placement? | **Shared/unresolved — Quest §26.4** (bottom bar already has 5) |
| A-02 | How are completions approved? | Per-activity `parent \| self \| together` (**shared contract Quest §26.2**); `self` blocked on security model |
| A-03 | Reward other than +1? | Default +1; don't change economy without a deliberate decision |
| A-04 | Can a Quest linked to an Activity award an extra point? | **Resolved by Quest §19.1** — default no stacking |
| A-05 | Final category names? | Create·Build·Discover·Move·Play·Make (starting set) |
| A-06 | Surprise Me in MVP? | Useful; can follow the basic library |
| A-07 | Favorites in MVP? | Recommended if inexpensive |
| A-08 | External browser vs controlled in-app view? | Requires technical/safety review |
| A-09 | Maintain trusted sources/domains? | Accepted direction; may follow basic links |
| A-10 | When does AI discovery ship? | Parent-side follow-up, after manual library |
| A-11 | Activities grant Café progression? | No by default; revisit intentionally |
| A-12 | How reflect Daily Essentials / First→Then? | Read-only cue via **Quest §26.1**; no lock (Quest §9.1) |
| A-13 | Essential time windows? | **Quest §10** owns them; never hard-code here |
| A-14 | If a future before-leisure gate is added, how present it? | TBD in Quest design (Q-06); not part of the default Activities contract |

---

## 18. Suggested delivery slices  *(Activities ships AFTER Quest exposes §26 contracts)*

### Slice 0 — Compatibility audit *(findings recorded Aug 12)*
- **Nav:** 5 child tabs today; adding Activities is the §26.4 decision.
- **Ledger:** `kind:'activity'` unsupported in `classifyTransaction` **and** `validPointKind` → must extend both (§16.1).
- **Ledger writes:** parent-only → self-complete blocked (Quest §26.2).
- **Quest routine/First→Then read model:** does **not exist yet** — Quest Slice 1 must ship it before A-12 is buildable.
- **Care Charge / cat-stat paths:** must be omitted by the Activity writer (§15).
- Confirm link-open behavior on the tablet/PWA (A-08); update this spec with the shipped ledger contract.

### Slice 1 — Offline Activities library
Activities destination · parent Activity CRUD (`activities` collection) · categories + cards · basic What-fits-right-now tags · offline activities · repeat modes · per-activity approval mode (parent/self-fallback) · Start→Complete → `Parent approves` mints `+1` via a **new Activity ledger writer** (kind `activity`, no Care Charge, no cat stats) · show Activity rewards in My Progress · completion count + Do Again.

### Slice 2 — Curated links
Link activity type · parent save/edit approved URLs · trusted sources/domains (parent-only) · approved-source marker · child launches only stored approved links · Start-vs-Complete preserved · link/source audit metadata · device-test browser navigation and document the real containment boundary (A-08).

### Slice 3 — Favorites and Surprise Me
Favorites · Surprise Me using the same context filters · refine time/supplies/energy/offline filters · render the Quest-owned routine/First→Then cue (once Quest §26.1 exists) · empty states.

### Slice 4 — AI-assisted parent discovery
Parent-only AI suggestion flow · Pending Review · explicit Approve before child visibility · optional trusted-domain filtering · AI never mints points or bypasses link approval.

---

## 19. MVP acceptance criteria

### Child experience
- [ ] Sirus opens Activities without entering a parent surface; browses by category; narrows by time/energy/supplies/offline-online.
- [ ] A card clearly shows what to do and whether it earns `+1`; starting/opening never awards a point; completing a valid Activity produces exactly one reward for that completion.
- [ ] Each Activity uses its configured approval mode without letting Sirus alter reward or trust setting.
- [ ] Repeatable exposes Do Again; a repeatable HIIT done three valid times yields three distinct `+1` rows; Once-today can't earn twice per date; One-time can't earn after its rewarded completion.

### Daily Essentials boundary  *(rules owned by Quest)*
- [ ] Mandatory tasks stay Quests, not Activities.
- [ ] Activities reflect the Quest First→Then/routine state (Quest §26.1) without duplicating scheduling logic.
- [ ] An unfinished Essential never erases earned minutes; passing its window never labels the day failed (Quest §9.1/§10.1).
- [ ] Completing Activities never auto-substitutes for an unfinished Essential; unfinished Essentials just leave their Quest rewards unearned.

### Point integrity
- [ ] Activity rewards use the existing Available Minutes balance; default `+1`; My Progress labels the event **Activity**; the ledger can audit the originating Activity.
- [ ] One Activity completion can't also mint a linked Quest point unless explicit bonus behavior was configured (Quest §19.1).
- [ ] No second point ledger/balance is created; rows use `kind:'activity'`, category `earned`.

### Café boundary
- [ ] Activity completion grants no Care Charge, no Coins/Brain/Energy/Bond, and changes no Hunger/Rest/Happiness/décor/Hero-care.

### Parent workload
- [ ] Parent-approved Activities reuse the shared **Needs You** queue (Quest §26.3), visibly distinct from Quests; configuration stays in Activities management.

### Parent-curated links
- [ ] Sirus can't type an arbitrary URL; only Mom/Abba create/change links and manage trusted sources.
- [ ] A linked card can say the starting resource was parent-approved without implying the whole external site is contained; opening a link never awards the point; the UI never claims navigation containment that isn't implemented.

### Tone
- [ ] Activities feel voluntary and constructive; repeating an allowed Activity is positive, not cheating; no calorie/body metrics or shame mechanics; reward is for completing the experience, not for a "good enough" result.

---

## 20. Starter content pack

Small first library (quality/reuse over quantity). **Move:** 10-Minute HIIT · Animal Moves · Dance Workout · Ninja Training · Balance Challenge (all Repeatable). **Create:** Draw a Picture · Invent a Monster · Make a Comic · Design a Superhero · Draw a Treasure Map (Repeatable). **Build:** Tallest Tower · Cat Castle · Bridge · Something Tiny (Repeatable). **Discover:** Learn One Weird Fact · Solve a Riddle · (Test What Floats — Once today) · Find Something Symmetrical. **Play:** Puppet Show · Spy Mission · Treasure Hunt · Secret Code (Repeatable). **Make:** Paper Airplane · Card for Someone · Help Make a Recipe · (Try a Simple Experiment — Once today). Refine based on what Sirus actually chooses.

---

## 21. Reconciliation notes

This is a **new feature proposal** layered on the existing Café / My Progress systems. It preserves: `1 point = 1 minute`; Activity rewards land in **Earned** history (not a new currency); Café needs/Care Charges stay separate from screen-time points (§15); clean parent surfaces; existing Cat Trainer visual language.

**Reconciled Aug 12, 2026** against the shipped `cat-trainer-v2` code and `QUEST-TAB-SPEC.md`:
- Duplicated Daily Essentials / First→Then rules were removed and replaced with dependencies on Quest §9.1, §10, §26.1.
- The approval-mode contract, self-complete security model, "Needs You" queue, no-double-reward rule, three-path model, and nav decision are now **owned by Quest** and referenced here, not restated.
- The `kind:'activity'` ledger extension and the parent-only-write blocker are documented as real current-code issues (§14.2, §16), not assumed solved.
