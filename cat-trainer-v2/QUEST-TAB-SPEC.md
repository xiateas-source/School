# Cat Trainer — Quest Tab & Daily Essentials

**Status:** Draft 0.4 — Slices 1–2 accepted; reduced Slice 3 implemented, pending acceptance
**Date:** August 15, 2026
**App:** Cat Trainer / Sirus app
**Feature type:** Child routine / quest experience + parent quest management
**Ownership:** Quest is the **responsibility** system. It OWNS routines, Daily Essentials, required tasks, timers/Beat-the-Clock, First→Then, support/help/read-aloud, and independence/mastery. It EXPOSES a small set of contracts that the Activities spec consumes (see §26). Implement **Quest first, Activities second.**

---

## 0. Ownership map (read this first)

| Area | Owner | Notes |
|---|---|---|
| Daily Essentials, required-task status | **Quest** | Activities only *reflects* it read-only |
| Now/Next/Later, Routine Mode, Pick your next mission, Focus Mode | **Quest** | — |
| First → Then sequence cue | **Quest** | Contract in §26.1; Activities may be the "Then" destination |
| Timers, toothbrush timer, Beat the Clock, game wrappers | **Quest** | Activities defines no timers |
| I need help, read-aloud | **Quest** | Activities explicitly does not implement help |
| Support fading + Independence Mastery (tiers, ⭐ marker, celebration) | **Quest** | §16; rolling-window, anti-streak (§16.3–16.4); weekly surface §26.5 |
| Approval-mode contract (`parent \| self \| together`) + self-complete security model | **Quest** | §26.2; Activities consumes the same enum |
| Shared **Needs You** parent attention queue | **Quest** | §26.3; Activities submits labeled items into it |
| "No double reward" rule for a Quest that points at an Activity | **Quest** | §19; the linkage rule lives here |
| Quest CRUD, routines, Quest Library, recurrence, bulk edit | **Quest** | Separate surface from Activity CRUD |
| Point economy `1 pt = 1 min`, ledger schema, My Progress | **Shared / My Progress** (external) | Neither spec redefines it; both consume it (§20) |
| Optional self-directed Activities, Favorites, Surprise Me, approved links, movement library | **Activities** | See `ACTIVITIES-TAB-SPEC.md` |

---

## 1. Purpose

Redesign the Quest experience so it works as an **external executive-function support**, not a giant checklist Sirus must mentally sort and not another system Mom must constantly maintain.

The redesigned Quest tab should:

1. make expected daily tasks predictable without presenting them as punishments;
2. reduce overwhelm by showing what matters **now**, rather than every Morning, Brain, Move, Tidy, General, and Night item at once;
3. give Sirus meaningful choices about **order, challenge style, and how he approaches required work**;
4. support growing independence so Mom can move from task-by-task reminders toward a single cue such as **"Check your missions"**;
5. keep the point economy simple: a normal successful Quest reward remains `+1 minute` unless explicitly configured otherwise;
6. let the natural consequence of noncompletion be **the missed earning opportunity**, not an invented penalty;
7. preserve the Café's existing Quest → Care Charge contract and the later approval → permanent reward contract;
8. make parent setup dramatically less cumbersome through reusable routines, recurrence, bulk editing, and easy exceptions.

The long-term goal is not perfect compliance. It is a system that helps Sirus increasingly **notice what needs doing, choose a starting point, begin, finish, and move on with less adult prompting**.

---

## 2. Product model — three positive earning paths

This is the **canonical** definition of the three paths. Activities references it rather than restating it.

| Path | Meaning | Owner spec | Example |
|---|---|---|---|
| **Quests / Daily Essentials** | Responsibilities, routines, school, expected goals | Quest | Brush teeth |
| **Activities** | Voluntary constructive choices | Activities | 10-Minute HIIT |
| **Recognition** | Mom/Abba notices a positive behavior | (existing) | Helped Arlo gently |

All three may produce the same predictable `+1 minute` reward, but they remain conceptually distinct and must stay distinguishable in My Progress history (§20).

### 2.1 Daily Essentials

Some Quests are **Daily Essentials**: tasks expected regardless of whether Sirus chooses them (personal care, morning routine, school, household responsibilities, evening/bedtime routine, other family expectations).

Daily Essential does **not** mean: automatic punishment; screen-time deduction; a broken streak; a failed day; the cat becoming sad/sick; or the task disappearing when its preferred time passes.

### 2.2 Optional Quests

The Quest system may also contain optional/bonus Quests that are not Daily Essentials. These remain distinct from the Activities library: a Quest is a specific family-created goal or responsibility; an Activity is a reusable child-chosen experience owned by `ACTIVITIES-TAB-SPEC.md`.

---

## 3. Non-negotiable reward rules

- **1 point = 1 minute** of Available screen time.
- A normal approved Quest is ordinarily worth **+1 minute**.
- Previously earned minutes remain Sirus's until used or affected by an explicit existing `-2` behavior event.
- An unfinished or late Quest does **not** deduct points and does **not** invalidate previously earned points.
- There is no invisible debt for incomplete Daily Essentials.
- The natural point consequence of not completing a reward-bearing Quest is simply: **that `+1` was not earned.**
- The app may show remaining earning opportunities but must not describe them as losses.

Prefer **"4 minutes still available to earn"** over **"4 tasks missed."**

### 3.1 Health / safety tasks

Some Daily Essentials still require adult follow-through even if Sirus does not independently initiate them. The independence goal is **less repeated prompting**, not making health/safety requirements optional. The point system needs no extra punishment to enforce this.

---

## 4. Preserve the existing Café reward contract

**Implemented today (`store.js`) and authoritative:**

1. Sirus marks a Quest complete → files a `pending` completion.
2. The first completion attempt for that Quest/date records one immutable Care-award marker and grants **one immediate flexible Care Charge**, subject to the Café's current cap (6). A capped first attempt records zero; return, retry, correction, or reopen never creates fresh eligibility.
3. **Parent approval** later grants the permanent reward effects — screen-time points, coins, Brain, Energy, Bond — recomputed from the live quest at approval time.
4. Parent return/rejection does not claw back an already-granted or spent Care Charge.
5. Parent approval does not grant a second Care Charge.

The redesign changes **presentation, scheduling, routine support, and management**, not this economic boundary.

Activities remain separate: an Activity completion does **not** grant a Care Charge (enforced in `ACTIVITIES-TAB-SPEC.md` §15).

---

## 5. Core child-experience principles

1. Show less at once.
2. Give choices inside real boundaries.
3. Do not offer fake choices (don't ask *whether* to brush teeth; ask *which eligible mission* is next).
4. One clear next action beats a dashboard (Focus Mode).
5. The app carries the reminder burden.
6. Progress should feel like opportunity, not moral failure.
7. Playful challenge is optional.
8. Routine completion deserves closure without bonus points.
9. As skills grow, adult involvement can decrease.

---

## 6. Child navigation: Now / Next / Later

Replace the undifferentiated all-category wall.

- **NOW** — current routine / most relevant group (`☀️ Morning Missions · 4 left · 4 minutes available to earn`).
- **NEXT** — upcoming block (`🧠 School · Starts after Morning`).
- **LATER** — future routines (`🌙 Night Routine`).
- **ANYTIME** — eligible general/flexible Quests.

Key rule: **future work stays discoverable without competing visually with what Sirus needs to do now.**

---

## 7. Routine Mode: "Pick your next mission"

Primary way through Morning/Night. Show **2–4 currently-eligible** choices, not every quest. On completion: acknowledge → update progress → mark finished → surface another eligible mission → let him choose again.

### 7.1 Flexible order
Where order doesn't matter, Sirus chooses the sequence.

### 7.2 Dependencies
Where order genuinely matters, the routine encodes a dependency (`First: Eat breakfast → Then: Wash bowl`). A dependency reflects a real sequence requirement, not arbitrary control.

### 7.3 Build My Routine (later)
Mom/Abba decide **what** belongs in the routine; Sirus may sequence the **flexible** parts. Dependencies still override impossible orders.

---

## 8. Focus Mode

Open one Quest, remove the rest of the noise (title · `+1 minute` · Start timer · Done · I need help). Always offer a clear way back to the current routine.

---

## 9. Visual First → Then support

First → Then is primarily a **predictable sequence cue**, not a punishment mechanism. Two shapes: routine-level (`First: Morning Missions → Then: Choose what's next`) and task-level dependency (`First: Breakfast → Then: Wash your bowl`).

### 9.1 Default boundary (authoritative for the whole app)

First → Then is **not** a lock on already-earned screen time or on the Activities tab. It communicates sequence and expectations only. Any "before leisure begins" gate is an explicit future product decision (Q-06), never an accidental side effect of the Quest UI.

**This is the single source of the non-locking rule.** Activities consumes it via §26.1 and must not restate or override it.

---

## 10. Time-of-day windows

Human-readable windows, not hard deadlines: **Morning · School · Anytime · Evening · Night/Bedtime**. Exact clock times are a future per-parent option, not a per-task requirement.

### 10.1 Preferred window passes

When a Daily Essential is unfinished after its window: don't mark it failed; don't remove points; don't create a `-2`; don't erase the earning opportunity unless Mom explicitly set a once-only availability rule; change presentation to neutral **Still needs doing** (`☀️ Morning — still needs doing · 2 left`).

---

## 11. Optional timers and game modes  *(Quest-owned; Activities defines no timers)*

Timers are a **per-Quest tool**, not a global expectation.

### 11.1 Timer modes
- **None**.
- **Fixed-duration** — continue for the full duration (e.g. `🪥 2:00 Brush Challenge`); finishing early is not the goal.
- **Optional Beat the Clock** — race a *safe* task (tidy toys, hamper, bedding); the Quest is still completable without the timer.
- **Count-up** — see how long something takes; beat *his own* previous time later, no deadline.

### 11.2 Timer safety
Never reward rushing where speed reduces quality/safety. No beat-the-clock for toothbrushing, eating, accuracy schoolwork, hot/sharp/heavy tasks, or anything Mom/Abba mark unsafe to rush.

### 11.3 Toothbrush timer
Dedicated **2:00** brushing timer; playful visuals allowed but completion = the full two minutes. Reuse one timer component for morning/evening.

---

## 12. "Make it a game" wrappers

Optional, lightweight per-Quest wrappers that never change the responsibility or reward amount: **⚡ Beat the Clock · 🥷 Ninja Mode · 🐱 Cat Challenge · 🎲 Mystery Pick** (app picks one eligible required Quest) **· 👑 Boss Mission**. They must not randomize reward, punish declining, race health/safety tasks, or require a new Quest per variation.

> **Mystery Pick vs Surprise Me:** Mystery Pick (here) chooses a *required Quest*. **Surprise Me** (Activities §10) chooses an *optional Activity*. They are parallel but separately owned — do not merge.

---

## 13. "I need help"  *(Quest-owned)*

Every appropriate focused Quest offers **I need help**: Quest stays unfinished, is marked **Help requested**, and surfaces a parent notice ("Sirus needs help with School: Writing"). No point deducted, no failure. Delivery reuses existing family-feedback infrastructure (`familyFeedback`), not a new parallel system. Activities does not implement help unless a later explicit decision adds it.

---

## 14. Read-aloud / voice support  *(Quest-owned)*

Optional **read this mission aloud** action. Sound is optional; the Quest is fully understandable without audio; respect device sound preferences; never required for completion.

---

## 15. Routine progress and completion

Compact progress, no grade (`Morning Missions · 4 of 7 complete` or `3 left · 3 minutes available to earn`). Never show percent-good, missed-task score, letter grade, "bad morning," child comparison, or a broken streak.

### 15.1 Routine-complete moment
On the last Quest in a routine: a clear completion moment (`Morning Complete! You completed 7 missions.`). The active cat may celebrate if not overridden by higher-priority Café state. No bonus point — closure is the reward signal. Reduced-motion / no-sound users still get understandable feedback.

---

## 16. Support fading and independence  *(Quest-owned; see user clarification)*

**Independence Mastery means reduced need for adult prompting/support — never removal of a recurring responsibility.** A mastered Daily Essential **stays in the routine**. Example: mastered tooth-brushing remains in Morning; only the *support* fades.

> **Routine permanence does not require support permanence.**

### 16.1 Support levels
Per-Quest, not one child-wide switch: **Parent prompt → App prompt → Checklist only → Self-initiated ("I've got this")**. These are support settings, not grades. Moving back to more support later is allowed and never erases a prior accomplishment.

### 16.2 Approval modes
Approval and support are related but separate. Approval uses the **shared three-mode contract** defined in §26.2 (`parent | self | together`). The app must never let Sirus change his own approval mode, reward amount, required status, or support level.

### 16.3 Independence Mastery  *(the feature)*

Independence Mastery recognizes **needing less help**, not just completing more tasks. It is the app's positive counterpart to Room to Grow, and its whole point is to reward the app and Mom becoming **less** necessary for things Sirus has learned to manage himself.

**Core distinction:** Mastery never removes the Quest. Brushing teeth is still done every day. Mastery means *"This used to take Mom's help. Now you've got it."* The mastered Quest **stays in the routine** and gains a small **Mastered ⭐** marker, so the routine list itself becomes evidence Sirus is becoming more capable rather than an endless chore list.

#### 16.3.1 The independence signal (per completion)
Each completion of a support-eligible Quest carries an **independence signal**:
- `independent` — done with **no reminder**;
- `one_reminder` — done after **one** reminder;
- `prompted` — needed active prompting/help (or unmarked).

Capture is deliberately low-friction: a Quest whose `supportMode` is `self_initiated` counts its completions as `independent` automatically; otherwise the parent may set the signal with a quick 3-way tap at approval time (§17.3). **Unmarked defaults to `prompted`**, so mastery only ever rises from positive evidence — never from missing data.

#### 16.3.2 Tiers (forgiving rolling window — NOT consecutive days)
Mastery is computed over the **last 7 opportunities** for that Quest (an *opportunity* = a day the Quest was scheduled/active; days it wasn't scheduled don't count against him). A missed or prompted day simply isn't a positive tally — it **never erases** progress.

| Tier | Signal (tunable defaults) | Example label |
|---|---|---|
| 🌱 **Getting independent** | ≥3 of last 7 opportunities `independent` | *Brushed teeth with no reminder · 4 days* |
| 🌿 **Almost mastered** | ≥5 of last 7 `independent` **or** `one_reminder`, not yet 5 fully independent | *Morning tidy with one reminder · 5 days* |
| ⭐ **Mastered** | **≥5 of last 7 opportunities `independent`** | *Put breakfast dishes away independently · 7 days 🎉* |

The 5-of-7 ratio is intentionally forgiving and developmentally appropriate; the exact numbers are tunable but must stay a **rolling ratio, never a consecutive streak.**

#### 16.3.3 Crossing the threshold (the celebration) — DECIDED (Q-21)
The Mastered moment **does not auto-fire.** The flow is:
1. The rolling-window detector (§16.3.2) identifies a **mastery candidate** — a Quest whose independence signal has reached the Mastered ratio.
2. The app surfaces a **lightweight parent confirmation** in the parent surface (§17.3 Needs You): *"Sirus appears ready for Independence Mastery for **&lt;responsibility&gt;**."* — a small prompt, not the big celebration.
3. **Parent confirmation** sets/affirms `mastery.tier = mastered` and **triggers the one-time, idempotent celebration** for Sirus:

> **⭐ INDEPENDENCE MASTERED!**
> You've been brushing your teeth on your own.
> That's something you can handle now.

Then the Quest keeps its place in the routine with a persistent **Mastered ⭐** marker. Celebration/marker rules:
- the celebration is created only by the **parent confirmation**, never by the detector alone;
- fires **once** per Quest per mastery crossing (idempotent; a reload/reconnect never replays it — reuse the `familyFeedback` one-time delivery mechanism, keyed to the crossing);
- creates **no** permanent extra currency, coins, or point bonus — it is recognition, not economy;
- delivered via the same durable feedback queue as recognitions (§13 infrastructure), subordinate to higher-priority Café state.

#### 16.3.4 Mastery is sticky (regression is gentle)
Once ⭐ Mastered, the marker **persists**. If independence later dips below the ratio, the app does **not** revoke ⭐ or say "lost." Support may be quietly raised again (parent action, §16.1) while the ⭐ remains. Only an explicit parent choice clears the marker. This is the concrete guarantee behind *"a missed day shouldn't erase mastery."*

#### 16.3.5 Parent authority — DECIDED (Q-21)
The rolling-window detector only *surfaces a candidate*; it never declares mastery on its own. **Parent confirmation is required** to set Mastered and fire the celebration (§16.3.3). Mom/Abba may also dismiss a candidate, adjust the support level, or clear the ⭐ at any time. The app must never let **Sirus** change support level, mastery state, or the marker.

### 16.4 Anti-streak requirement (explicit)

Independence Mastery must **not** be a fragile streak. There is no "X days in a row" gate, no auto-decay of a support level on a miss, and no marker that resets when a day is missed. The signal is a **rolling ratio (5 of last 7 opportunities)**; a mastered Quest stays mastered until a parent explicitly changes it, described neutrally (never "lost").
*(Note: the Café's separate 14-day Hero-care mechanic in `rewards.js` is cat-care progression, unrelated to independence, and is not a model for this feature — that one IS a cumulative gate; Independence Mastery is deliberately not.)*

### 16.5 Weekly reflection surface  *(rendered by My Progress — contract §26.5)*

Independence Mastery appears as a **positive pattern in the weekly reflection**, alongside Room to Grow — turning the week into evidence of growing capability:

> **This week** · 18 wins · 3 Room to Grow · 2 Hero's Resets
> 🌱 **Independence Mastery** — *things you're learning to handle on your own*
> ⭐ Mastered: Put breakfast dishes away independently · 7 days
> 🌿 Almost mastered: Morning tidy with one reminder · 5 days
> 🌱 Getting independent: Brushed teeth with no reminder · 4 days

The weekly view already computes `wins` (earned count), `Room to Grow`, and `Hero's Resets` from `summarizeWeek` (`shared/ledger.js`). The Independence Mastery block is **new Quest-owned data** (derived from per-completion independence signals over the 7-day window), rendered by the My Progress weekly surface. The rendering contract is §26.5. The child view must present this as encouragement, never a score or comparison.

**Decided (Q-21):** the weekly view may *describe* independence growth (the three tiers with their forgiving counts), but must **not** show countdowns or predictions such as *"2 days until mastered."* Mastery is reached only by parent confirmation (§16.3.3), so the app never promises it on a timeline.

---

## 17. Parent portal: design target

**Goal:** after a normal week is configured, most ordinary days are managed from one calm screen with little/no routine editing. The portal behaves like a small operations console, not an editable Quest database.

### 17.1 Information architecture: Today · Routines · Log
**Today opens by default.** Routine configuration lives one level deeper.

### 17.2 Today
Answers within seconds: What needs me? How is the current routine going? What's still available to earn? Is Sirus asking for help? What's later? Do I need a one-day exception? Current routine may expand; future routines stay compact.

### 17.3 Needs You  *(the shared attention queue — see §26.3)*
Compact area at top of Today, shown only when parent action is required: Quest approvals, **I need help**, returned/retry decisions, a **mastery candidate to confirm** (§16.3.3), or a real sync/security problem. Ordinary completions do not accumulate as dismissible notifications. During approval of a support-eligible Quest, the parent may set the completion's **independence signal** (no reminder / one reminder / with help) with a quick optional 3-way tap (§16.3.1); leaving it unset records `prompted`.

### 17.4 Batch review
Select several straightforward submissions → **Approve selected**; open one only when it needs review; return one without affecting others. Batch review preserves per-Quest transaction integrity and must not double-apply on retry (matches current `approveCompletion` idempotency).

### 17.5 Today-only vs going-forward
Sharp separation. **For today:** Skip today · Move to later · Make this the next mission · Change today's order · Return/try again. **Going forward:** Edit Quest · Edit routine · Pause · Archive. A parent must never rewrite every future Tuesday to fix one Monday. Skip/Move is a schedule action, not a point deduction.

### 17.6 Today Is Different
Fast one-day exception (Sick day · School off · Out all day · Easy morning · Custom). Presets hide/skip/move Quests for that day; tomorrow returns to normal automatically. Exceptions are never interpreted as Sirus failing tasks.

### 17.7–17.10 Routines / recurrence / library / duplicate
Routines view shows containers first. Reusable features: ordered/flexible definitions, drag-reorder, recurrence (Every day · Weekdays · Weekends · Selected days · One time · Custom), daypart window, dependencies, default approval/support/timer behavior, pause/archive/duplicate, bulk edit, one-day exceptions that don't mutate the template. A **Quest Library** (Saved by family + Suggestions) reduces setup. Duplicating a Quest preserves its useful configuration by default.

### 17.11 Quest Log
History, not the home screen — answers "what happened with responsibilities," while the **Point Ledger** answers "what happened to points." Date-navigable; filters: All · Completed · Waiting · Returned · Help · Skipped · Changes. A rewarded Quest may *link* to its My Progress transaction without duplicating financial history.

### 17.12 Quick return/retry
Fast presets: Try again · Almost—fix one thing · Come see me · custom note. The returned Quest stays in the routine and follows the existing return/retry contract; returning it never claws back completed Café care.

### 17.13 Constraints
Phone-first: one-handed, large targets, progressive disclosure, batch ops, no required clock times, no need to open Routines on a normal day.
**Primary test:** *After the normal week is configured, can Mom manage an ordinary day from Today without opening Routines?*

---

## 18. Proposed Quest data extensions

**Current shape (`data/quests.js`) has none of these** — this is a real migration (see §24). Reconcile field-by-field against the live model and rules before coding.

```js
{
  id: 'morning-brush-teeth',
  title: 'Brush teeth',
  // Existing, preserved
  section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1, enabled: true, order: 30,
  // Routine model (NEW)
  routineId: 'morning',
  isDailyEssential: true,
  timeWindow: 'morning',
  recurrence: { type: 'selected_days', days: ['MO','TU','WE','TH','FR','SA','SU'] },
  dependsOnQuestIds: [],
  // Child presentation (NEW)
  timerMode: 'fixed_duration', // none | fixed_duration | optional_race | count_up
  timerSeconds: 120,
  allowedGameModes: ['cat_challenge'],
  readAloudText: 'Brush your teeth.',
  // Support / trust / completion (NEW)
  supportMode: 'checklist',    // parent_prompt | app_prompt | checklist | self_initiated
  approvalMode: 'parent',      // shared enum §26.2: parent | self | together
  mastery: {                   // Independence Mastery state (§16.3) — sticky
    tier: null,                // null | getting_independent | almost | mastered
    masteredAt: null,          // set once on first Mastered crossing; does NOT retire the Quest
    markerCleared: false       // only a parent may clear the ⭐
  }
}
```

Each **completion** additionally records an `independenceSignal` (`independent | one_reminder | prompted`, §16.3.1) so the rolling-window detector and the weekly reflection can read it. This is a completion-level field (like the existing `attemptId`/`status`), not a quest-definition field.

Today-only actions (Skip Today, Move Later, presets) must be **instance/day overrides**, never template mutations. `section` is preserved as-is; `routineId`/`timeWindow` layer on top so legacy quests keep rendering during migration.

### 18.1 Migration: classify every existing Quest  *(mandatory audit rule)*

**Rule:** during migration, *every* existing Quest must be explicitly classified as one of:
- a **responsibility** → stays in Quest as a Daily Essential or an optional/bonus Quest (§2.2), tagged `isDailyEssential: true|false`; or
- an **optional self-directed choice** → **migrated out to the Activities library** (`ACTIVITIES-TAB-SPEC.md`).

**No item may remain in Quest merely because that is where optional activities historically lived.** The legacy `General` bucket ("anytime quests that aren't part of a morning/night routine") and the `Move` section are the prime sources of items that likely belong in Activities. Every quest gets a deliberate decision; the default is **not** "leave it in Quest."

**Decision test:** *Is this expected regardless of whether Sirus chooses it?* Yes → responsibility (Quest). No → optional choice (Activities candidate).

**Consequence of moving a Quest → Activity:** it stops granting a **Care Charge** and cat stats (Brain/Energy/Bond/coins) and instead earns through the Activity path (`kind:'activity'`, no Care Charge — Activities §14/§15). It must not double-reward against any remaining prompt-only Quest (§19.1).

**Disposition of the current `DEFAULT_QUESTS`:**

| Quest | Section | Recommended class | Rationale |
|---|---|---|---|
| Bathroom, Take Wesley out, Check Wesley's water, Fold bedding, Get dressed, Brush teeth, Wash face/fix hair, Eat breakfast + wash bowl | Morning | **Quest — Daily Essential** | Required personal care / pet care / routine |
| Reset one shared space (`t-space`) | Tidy | **Quest — Daily Essential** | Required household responsibility |
| Night teeth & pajamas, Tidy & make bed | Night | **Quest — Daily Essential** | Required bedtime routine |
| Read or complete a Brain Quest (`b-read`) | Brain | **DECIDED — split** | Required/scheduled reading **stays a Quest**; open-ended "read something you choose" becomes an **Activity**. The one ambiguous `b-read` item must not serve both — replace it with a required-reading Quest and (separately) an optional-reading Activity. |
| Complete a movement challenge (`v-move`) | Move | **Migrate to Activities (recommended)** | Movement is Activities' domain; keep in Quest only if daily movement is a genuine requirement. Resolve §19.1 double-reward with Activities' Move library. |
| *(any family-created `General` items)* | General | **Audit each** | Most anytime/optional items belong in Activities; keep in Quest only if truly required |

This audit is a gate on Quest Slice 1 (child view) and on Activities Slice 1 (the migrated items must land in the Activity library, not vanish).

---

## 19. Relationship to Activities  *(the linkage rule lives here)*

- Daily Essentials remain Quests; Activities remain voluntary.
- Activities may be shown after/alongside the current routine per the final navigation design (§26.4).
- A First→Then cue may point from current Daily Essentials to Activities (Activities can be the "Then") **without** locking or confiscating earned screen time (§9.1).
- Completing an Activity does not substitute for an unfinished Daily Essential unless Mom/Abba explicitly create that relationship.

### 19.1 No double reward (owned here)
One action must not silently mint two points. If a Quest exists whose completion is "do a Move activity," the family must choose one of:
- **Prompt-only** — the Quest is a pointer into Activities and awards **no** separate point (the Activity's own completion is the single reward); **or**
- **Separate responsibility** — the Quest is its own required task and awards its own `+1`, and it is *not* satisfied by an Activity completion.

**Default: prompt-only, no accidental stacking.** The current `v-move` Quest ("Complete a movement challenge") must be classified into one of these before Activities' Move library ships, so it and Activities' HIIT don't both pay for the same workout. Activities references this rule (Activities §2.2) and does not define its own.

---

## 20. Relationship to My Progress  *(external shared contract — neither spec redefines it)*

Approved Quest point rewards appear as **Earned** events in My Progress. Source metadata may include originating Quest, routine name, activity date, submitted time, approval time, and (parent-only) whether completion was late. The child view must never use lateness to shame or grade. A Quest completed one day and approved later files under its **activity date** (already implemented in `approveCompletion`).

The ledger schema (`shared/ledger.js`) is the single source of truth. Quests write `kind:'quest'` → category `earned`. Do not fork the schema.

---

## 21. Relationship to explicit `-2` behavior consequences

Quest noncompletion and behavior deductions are separate systems. Not finishing / being late never auto-creates a `-2`; a missed earning opportunity is not a negative transaction. Existing Room-to-Grow presets remain the only behavior deductions unless the family changes them.

> **Did the Quest → earned the reward. Did not → did not earn that reward.** No extra punishment.

---

## 22. Decisions and open questions

| ID | Question / decision | Current direction |
|---|---|---|
| Q-01 | Now/Next/Later replaces all-category view? | **Recommended** |
| Q-02 | How many "Pick your next mission" at once? | 2–4 |
| Q-03 | Sirus reorders flexible Essentials? | **Recommended**; dependencies authoritative |
| Q-04 | Exact clock deadlines or dayparts? | Dayparts; exact only where useful |
| Q-05 | Preferred window passes? | **Still needs doing**; no penalty |
| Q-06 | Does First→Then lock Activities/game time? | **No by default** (§9.1) |
| Q-07 | Toothbrush timer? | **Fixed 2:00** |
| Q-08 | Optional Beat the Clock? | **Yes**, safe tasks only |
| Q-09 | Which wrappers first? | Tooth timer + optional race |
| Q-10 | Does "I need help" notify Mom immediately? | Recommended; delivery via `familyFeedback` |
| Q-11 | Read-aloud? | Useful; after core redesign |
| Q-12 | Self-complete trusted Quests? | **Blocked on security model §26.2** — current rules make ledger writes parent-only |
| Q-13 | Routine completion bonus point? | **No** |
| Q-14 | Can incomplete Essentials expire without reward? | Default Still needs doing; family rules TBD |
| Q-15 | Optional/general Quests vs Activities? | Keep boundary (§2.2) |
| Q-16 | Parent portal structure | **Today · Routines · Log**; Today default |
| Q-17 | Batch approvals? | **Yes**; preserve per-Quest integrity |
| Q-18 | Today-only vs future edits separate? | **Yes, required** |
| Q-19 | Quest Library? | **Recommended** |
| Q-20 | Does mastery remove a Daily Essential? | **No** — Quest stays with a Mastered ⭐; fade support (§16.3) |
| Q-21 | Independence Mastery signal + celebration | **DECIDED:** rolling 5-of-7 detector finds a *candidate*; the major celebration does **not** auto-fire; a lightweight parent confirmation ("Sirus appears ready…") sets Mastered and triggers the one-time idempotent celebration; parent may adjust/clear; weekly view describes growth but shows **no countdowns** (§16.3.3, §16.3.5, §16.5) |
| Q-24 | How is the per-completion independence signal captured? | Auto `independent` when `supportMode=self_initiated`; else optional parent 3-way tap at approval; unmarked → `prompted` (§16.3.1) |
| Q-22 | One-tap unusual-day presets? | **Recommended**; auto-return next day |
| Q-23 | How much parent tooling in MVP? | Enough to materially cut current burden |

---

## 23. Contracts this spec exposes  →  see §26

Because Activities depends on Quest, the consumable contracts are collected in **§26** so they have one authoritative home.

---

## 24. Suggested delivery slices

### Slice 0 — Compatibility & management audit *(findings already recorded, Aug 12)*
- **Quest model:** flat `{id,title,section,points,brain,energy,coins,enabled,order}`; **no** routine/timer/support/approval fields → §18 is a migration, not a field tweak.
- **Completion/approval:** `completeQuest` (child files pending + 1 Care Charge) / `approveCompletion` / `parentCompleteQuest` / `rejectCompletion` in `store.js`; idempotent; reward recomputed from live quest.
- **Care Charge grant + cap (6):** implemented (`care.js`, `grantCareCharge`).
- **Point/coin/Brain/Energy/Bond writes:** implemented at approval; ledger `kind:'quest'`.
- **Rules:** child may only create a `pending` completion; ledger is **parent-write only**; `validPointKind` = adjust/quest/redeem/correction.
- **Child rendering:** single flat "My Quests" list (`#c-quests`) — the source of overwhelm §1.2 confirms.
- **Migration audit (§18.1):** classify every existing Quest as responsibility-stays or optional-moves-to-Activities; no default-to-Quest. This gates Slice 1.
- Reconcile against My Progress + Activities before feature code.

### Slice 1 — Routine-focused child view — ✅ ACCEPTED (live device, Aug 12 2026)
Run the §18.1 classification first (move optional items to Activities). Then: Now/Next/Later/Anytime · Routine Mode · Pick your next mission · Focus Mode · progress + points-available language · Still needs doing. Preserve all reward economics. **Requires the §18 routine fields.**

**Acceptance result.** Shipped as PRs #51 (routine view) + #52 (glanceable-hierarchy polish). All acceptance checks passed on the family's phone, including Care Charge → approval → points/rewards → My Progress (economics unchanged). One item is flagged for real-use observation rather than counted as a failure:

- **Independent glance (Sirus, unaided): observe over real use.** In the first sitting he said he didn't know what to do, but was mid-distraction (learning magic tricks). Once oriented he expanded *Morning — still needs doing* and went to find his dish to wash — the correct behavior for this household. Because the functional behavior is right and the initial response was confounded, no further UI change is being made now; we watch whether he uses the hierarchy independently over the next few days.

**Product clarifications preserved from testing (behavioral truth for later slices):**
- **Tidy → Anytime is correct.** Timing (`anytime`) and obligation (`isDailyEssential`) are independent — Tidy is Anytime *and* essential.
- **Anytime means flexible timing, not "optional."** Never render Anytime as optional; obligation display is a later-slice concern.
- **Unfinished Morning responsibilities stay relevant after the Morning window** — the collapsed *still needs doing* treatment (default collapsed, all items one tap away) is working and is the intended pattern.
- **RIGHT NOW stays visible with "All done here — great job! 🎉"** once the current routine is complete — this empty-but-present state tested well; keep it.
- **Home's "Available quests" preview still works** but may eventually need to respect the newer routine prioritization. **Out of Slice 1 scope — do not change now;** note for a future slice.

### Slice 2 — Parent Today portal + routine foundations — ✅ ACCEPTED (device + automated, Aug 15 2026)
Today·Routines·Log shell (Today default) · Needs You (§26.3) · batch approval · routine groups/templates + dayparts · recurrence · today-only Skip/Move/Next/reorder · Today Is Different · overrides never mutate templates.

**Acceptance result.** Current merged code passed device testing and the automated Slice 2 harness (12 PASS, 1 honest SKIP, 0 FAIL). The skip is Feed/Rest/Play because the QA cat did not expose a low-need cue; that same Care regression passed on a real device. Reset/scenario/fake-clock infrastructure is not required to close Slice 2.

### Slice 3 — Reduced parent configuration + Activities contract — IMPLEMENTED, PENDING ACCEPTANCE

The approved reduced slice is intentionally smaller than Draft 0.3's original line item:

- phone-first reusable-Quest management grouped by daypart, with Daily Essentials and Bonus quests visibly separate;
- accessible one-row Up/Down reorder, duplicate-to-paused-copy, Pause/Resume (`enabled`), and distinct recoverable Archive/Restore (`archived`);
- conservative bulk Pause/Resume, Archive/Restore, daypart, recurrence, and Essential/Bonus only — **no bulk reorder**;
- gentle quick-return presets plus an optional short note, with no point or Care clawback;
- immutable per-Quest/date Care-award markers, including award-zero at the cap and migration backfill before a legacy pending completion is returned or an approved completion is corrected/reopened;
- pure read-only `routineCue(...)` contract for Activities, derived from Quest scheduling and explicitly non-locking.

**Deferred from the old Slice 3 bundle:** drag reorder, dependency authoring, Quest Library, and the full date-based Quest Log/filter expansion. Existing dependency data remains honored; Today and the accepted Log shell remain unchanged. These are later product choices, not blockers for Activities.

### Slice 4 — Timers and playful challenge
Reusable timer component · fixed-duration · 2:00 toothbrush · optional Beat the Clock · count-up · first wrappers. Reward amount unchanged.

### Slice 5 — Support and Independence Mastery
I need help · read-aloud · Build My Routine · support-level controls · per-completion `independenceSignal` capture (§16.3.1) · rolling 5-of-7 mastery detector + tiers · Mastered ⭐ marker (sticky) · one-time Mastered celebration via `familyFeedback` · 🌱 Independence Mastery block in the weekly reflection (§26.5) · evaluate per-Quest trusted self-completion **only after the §26.2 security model exists**.

### Slice 6 — Refinement
General/optional-Quest ↔ Activities migration · normal-week observation · minimal-prompt routine observation. Activities implementation may begin after reduced Slice 3; it does not wait for Quest timers, mastery, Library, or full Log work.

---

## 25. Acceptance criteria

### Reduced overwhelm
- [ ] Default child view does not show every section as one competing list.
- [ ] Current routine is visually dominant; future routines secondary but discoverable.
- [ ] Routine Mode shows a manageable number of next choices; Focus Mode reduces to one task.

### Agency & independence
- [ ] Sirus can choose next among order-independent required tasks; no fake yes/no choices; real dependencies constrain impossible sequences.
- [ ] Mom can increasingly use one general reminder.
- [ ] I need help provides a non-punitive stuck signal.

### Natural consequences & points
- [ ] Normal Quest reward predictable; unfinished/late never deducts; earned minutes never confiscated for another unfinished Quest.
- [ ] UI shows minutes-still-available, not lost points; `-2` behavior stays separate.

### Time windows / timers / completion
- [ ] Dayparts supported; passing a window shows Still needs doing, no failure language.
- [ ] 2:00 toothbrush timer; fixed-duration doesn't reward early finish; Beat-the-Clock optional + safe-only; timer never changes point amount.
- [ ] Routine completion gives a clear positive moment without a bonus point; accessible without motion/sound.

### Parent portal
- [ ] Opens to Today; Needs You holds only genuine actions; batch review preserves per-Quest integrity.
- [ ] Recurring routines don't require daily recreation; reorder/duplicate/pause/archive supported.
- [ ] One-day exception without rebuilding schedule; today-only actions can't mutate future templates; Today Is Different auto-returns.
- [ ] Quest Library + duplicate preserve config; Log is date-based history separate from the Point Ledger.
- [ ] Ordinary days manageable from Today without opening Routines.

### Support & Independence Mastery
- [ ] Mastering a Daily Essential does **not** remove it from the routine; it gains a persistent Mastered ⭐ marker.
- [ ] Mastery uses a **rolling 5-of-7-opportunities** signal, never a consecutive streak; a missed day never erases progress or the ⭐.
- [ ] The Mastered crossing fires a one-time celebration (idempotent, no replay) and creates no permanent currency or point bonus.
- [ ] Parent can reduce support while leaving the Quest visible, and raise it again without the app saying an achievement was "lost"; only a parent can clear the ⭐. Sirus can never change support/mastery state.
- [ ] The weekly reflection shows a 🌱 Independence Mastery block (Getting independent / Almost mastered / Mastered) beside wins / Room to Grow / Hero's Resets, as encouragement — never a grade or comparison.

### Migration classification (§18.1)
- [ ] Every existing Quest is explicitly classed responsibility (stays) or optional (moves to Activities); none stays in Quest by default.
- [ ] Items moved to Activities land in the Activity library and earn via `kind:'activity'` (no Care Charge / cat stats) without double-rewarding a prompt-only Quest.

### Existing-system compatibility
- [ ] Completion still grants its Care Charge; approval still controls permanent rewards; returning never claws back care.
- [ ] Activities do not inherit Quest Care Charge behavior; Quest rewards flow into the existing My Progress ledger.

---

## 26. Consumable contracts (authoritative home for Quest ↔ Activities dependencies)

Activities depends on these. Each is defined **once**, here.

### 26.1 Routine-state / First→Then read model
Quest exposes the **current routine and its First→Then cue** as a read-only view Activities can render (e.g. `First: Brush teeth → Then: Get dressed`). The cue carries no locking semantics (§9.1). Activities must only *reflect* it and must not read or duplicate Quest scheduling, recurrence, or window logic. Reduced Slice 3 implements this as pure `routineCue(...)` in `src/shared/routines.js`, returning `routineId`, `routineLabel`, `remainingEssentialCount`, nullable `first`/`then` items, and `blocking:false`. Activities must degrade to just its library if no cue item is available.

### 26.2 Approval-mode contract (`parent | self | together`)
One shared enum and one shared security model for completions in **both** systems:
- **parent** — child submits; parent approval mints the reward (the only mode implemented today).
- **self** — child may mark complete and the `+1` is minted without a separate approval.
- **together** — an adult-confirmed flow for tasks/Activities involving a parent.

**Security reality (blocking `self`):** current `firestore.rules` make `pointTransactions` **parent-write only** and cap `validPointKind` to adjust/quest/redeem/correction. A self-complete reward therefore **cannot be minted from the child device today** — this is true for self-complete Quests (Q-12) *and* self-complete Activities (A-02) identically. Shipping `self` requires one of: (a) a Cloud Function (Blaze) that mints the row server-side, or (b) a narrowly-scoped child-writable "pending self-earn" that a parent/function settles. **This decision is made once, here, for both systems.** Until then, both specs may present `self` in configuration UI but must fall back to `parent` for the actual reward write.

### 26.3 Shared "Needs You" parent attention queue
Quest owns the **Needs You** queue (§17.3). Activities' `Parent approves` completions surface in the *same* queue, clearly labeled **Activity**, distinct from Quest items, and never blur the source. Configuration and audit identity stay in each feature's own surface (Quest Log vs Activity detail; both reconcile through My Progress). Batch review may include straightforward Activity submissions while preserving per-completion integrity.

### 26.4 Navigation (shared layout — currently unresolved)
The child bottom-nav today has **5** items (Home · Quests · Cats · Café · Progress). Adding an Activities tab makes **6**, which the Activities spec (A-01) flags as crowding. This is a **shared** layout decision neither spec owns unilaterally. Recommended options, in order: (1) Activities as a prominent destination from Home rather than a 6th permanent tab; (2) merge Cats into Café to free a slot; (3) accept 6 tabs. **Unresolved — needs a family decision before Activities Slice 1.**

### 26.5 Independence Mastery weekly-reflection render contract
Quest owns the **mastery data** (per-completion `independenceSignal`, per-Quest `mastery.tier`/`masteredAt`, computed over the last 7 opportunities — §16.3). The **My Progress weekly reflection** owns the *rendering surface* and displays the 🌱 Independence Mastery block next to the existing `wins` / Room to Grow / Hero's Reset totals from `summarizeWeek` (`shared/ledger.js`). Contract:
- Quest exposes a per-Quest tier + human label (e.g. `Brushed teeth with no reminder · 4 days`) for the visible 7-day window; My Progress lists them under the three tier headings (§16.5).
- The block is **read-only encouragement** — never a grade, percentage, best/worst day, or comparison (consistent with `summarizeWeek`'s existing "no grade" rule).
- Because the signal lives on quest **completions**, `summarizeWeek` (which reads `pointTransactions`) cannot compute it alone; the weekly view must also read the window's completions (or a Quest-provided summary). Keep queries single-field (by `localDate`/window) and aggregate in memory to avoid new composite indexes.
- The one-time **Mastered** celebration is delivered through the existing `familyFeedback` queue (§16.3.3), not through the weekly view.
