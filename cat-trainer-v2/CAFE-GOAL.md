# Cat Trainer — Interactive Café Goal

> **Status:** Working draft for discussion. This file defines the intended
> experience before implementation. Values marked **TUNING DRAFT** are proposals,
> not final balance decisions.
>
> **This is the combined spec.** It merges the product/experience spec (the
> "Interactive Café Goal") with a **code-grounded audit** of the current app, so
> the "audit the code first" items are answered inline instead of deferred. Notes
> that come from reading the shipped source are marked **▸ From the code**.

> **Observed calibration (August 2026):** Sirus has earned about **15–20 existing
> app points per active day**. Ember reached Hero form on the first day. These are
> real-use baselines for tuning; the current Hero threshold must not be copied
> unchanged into the Interactive Café progression model.

---

## 0. Codebase reality — grounded audit (Aug 2026)

Everything in this section is read from the current `cat-trainer-v2/` source, so
**Slice 0's "audit the code" is effectively complete.** Build against these
facts; they resolve several "must be audited" and "DECISION NEEDED" flags below.

### 0.1 Where things live

| Concern | File | Key symbols |
| --- | --- | --- |
| Shop items + room art | `src/data/cafe-items.js` | `CAFE_ITEMS` (17 items), `CAFE_ROOM_ART` |
| Cat definitions + poses | `src/data/cats.js` | `CAT_DEFS`, `freshCatProgress()` |
| Daily quests | `src/data/quests.js` | `DEFAULT_QUESTS` (13), `SECTIONS`, `seededQuests()` |
| Reward math (single source of truth) | `src/shared/rewards.js` | `CAPS`, `HERO_THRESHOLD`, `isHeroReady`, `applyCatProgress` |
| Café render + interactions | `src/app.js` | `renderChildCafe`, `initCafeInteractions`, `reactCat`, `catMood`, `catIdleBeat`, `catStroll`, `cafePoseArt`, `cafeSlot`/`CAFE_SLOTS` |
| Persistence / transactions | `src/store.js` | `purchaseCafeItem`, `moveCafeItem`, `setCafeItemPlaced`, quest-approval reward writes |

### 0.2 The current progression model (unchanged, keep it)

- **▸ From the code:** each cat carries `{ brain, energy, bond, evolved }`.
  `CAPS = { brain: 12, energy: 12, bond: 20 }`.
- **▸ From the code:** `isHeroReady(cat) = cat.brain >= 12 && cat.energy >= 12`.
  **Bond is *not* part of the Hero gate** — it is cosmetic/mood only. Coins are a
  café-only currency, never spent on progression.
- **▸ From the code:** every quest completion also grants `QUEST_BOND = 1`.
  Progression is cumulative and never spent (`applyCatProgress` just clamps).

This directly answers **§18 Q9** and **§11**'s "how do the current meters relate"
concern: keep two clearly separate layers, no duplicate meaning —

| Layer | Fields | Meaning | Behavior |
| --- | --- | --- | --- |
| **Progression** (existing) | Brain, Energy, Bond, coins | Long-term *growth* → Hero | Cumulative, never decays, parent-approved |
| **Daily care** (new) | Hunger, Rest, Happiness | *Today's wellbeing* | Decays over time, refilled by Care Charges |

The new care layer must **never** read or write Brain/Energy/Bond values. It only
*gates* new Hero progress (§11), it never touches the earned numbers.

### 0.3 Why Ember evolved on day one (§5.4 / §11.2, confirmed)

- **▸ From the code:** the Brain quest (`b-read`) grants +2 brain and the Move
  quest (`v-move`) grants +2 energy, every day. With `HERO_THRESHOLD` at 12/12,
  a handful of active days — or one very busy day — clears it. The instinct to
  **not reuse the current threshold** is correct; the new rule needs a
  multi-active-day requirement (§11.2).

### 0.4 Points ↔ quest completions (answers §18 Q1)

- **▸ From the code:** there are **13 default quests, each worth `points: 1`**
  (`quests.js`). So points and completions are ~**1:1** — the observed 15–20
  points/active day ≈ **15–20 quest completions** (all dailies plus a few
  custom/repeat quests).
- **Implication for Care Charges (§6):** at one charge per completion, Sirus
  earns *far* more charges than any small cap can hold, so **the cap (proposed 6)
  — not scarcity — is the real constraint.** Care becomes easily maintainable
  *if he does his chores*. For a chore-motivation app that is the correct shape,
  but it confirms §6.1's worry that per-quest is "generous": the design lever is
  the **cap and refill size**, not the earn rate.

### 0.5 What's already shipped on this branch (Phase 0 papercuts)

Committed on `claude/cat-cafe-design-sbz2n9` (before this spec), clearing the
"broken-feeling" surface Sirus complained about:

- **Tap-highlight "white lines" fixed** — `.cafe-cat` now carries
  `-webkit-tap-highlight-color: transparent` + `user-select: none` (the décor
  already had these; the cat was the only tappable element missing them).
- **Placed décor is grabbable** — it was painting *behind* the cat; `#c-placed
  img` now sits at `z-index: 2` above the cat wrap (`z-index: 1`).
- **Grab affordance** — a soft drop-shadow so items read as liftable on touch.

> **Note:** the z-index change is a *stopgap*. **Decorate mode (Slice 1)
> supersedes it** — once Play/Decorate are separated, layering is handled by the
> mode, not by forcing décor above the cat. Don't build the stopgap twice.

### 0.6 The "snap-back" bug, precisely (§7.2)

- **▸ From the code:** `reactCat()` plays a springy `catPop` squash-stretch
  ("the float"), flashes a `play`/`celebrate` pose, then a 900 ms
  `catSettleTimer` reverts to the resting pose. That is the exact "change
  picture, then immediately snap back" behavior §7.2 rules out. The state machine
  (§7) replaces this settle-timer pattern.
- **▸ From the code — the smoking gun:** every cat already has an **`eat` pose
  drawn** (`cats.js`), but `cafePoseArt` is only ever called with
  `sit`/`play`/`sleep`/`celebrate`. **The `eat` pose is dead art — defined,
  never rendered.** Slice 3 finally uses it.

### 0.7 Décor persistence & shop, today (partial answer to §18 Q10)

- **▸ From the code:** owned décor records are `{ id, x, y, placed }`;
  `moveCafeItem` saves position, `setCafeItemPlaced` toggles stored/placed. The
  new `roomLayout[]` schema (§10) is a superset — migrate the old shape into it.
- **▸ From the code:** all 17 items in `CAFE_ITEMS` are **shop-purchasable with
  coins**; a fresh child starts `coins: 0` with nothing owned. So "initially
  owned" = **none**; everything is shop-unlocked. Food bowl and water bowl are
  ordinary shop items today.
- **▸ From the code — cat-specific:** each cat has a favored bed
  (`bedItemId`: Nova→`bed`, Ember→`greenBed`, Moss→`pinkBed`) that swaps in the
  cat-on-bed nap art when that bed is owned + placed (`cafePoseArt`). This is the
  one existing "typed" object relationship to preserve.

---

## 1. Product promise

The Café is a **classic virtual-pet room powered by real life**.

Sirus should be able to arrange a room that feels like his, play with the cat,
and watch the cat live there. The cat has real needs that change over time. Real
quests create opportunities to care for those needs, and consistent care helps
the cat grow toward its Hero form.

The Café must feel like a toy and a small game—not a static portrait attached to
a checklist.

The first success test is simple:

> When Sirus opens the Café, he can make meaningful things happen and can also
> watch the cat do things without being told what to imagine.

## 2. Locked direction

These decisions are already made:

- Keep the existing cozy, chunky **256×256 pixel-art cats and props**. Do not
  remake the art at 16×16 or 32×32.
- Nova, Ember, and Moss retain their established identities and existing poses.
- The cat must visibly **idle, wander, seek attention, move to objects, eat,
  play, sleep, celebrate, and evolve**.
- Sirus can **move the cat and decorate the room**.
- Furniture placement persists. The room should reopen as Sirus left it.
- **Mom, Abba, Sirus, and Arlo can eventually appear inside the Café as family
  visitors.** This is a locked future direction, not a requirement for the first
  Interactive Café MVP.
- Hunger, Rest, and Happiness genuinely decay over real time.
- Needs are restored through real-life quest activity, not unlimited screen
  tapping.
- Caring for the cat contributes to long-term Hero evolution.
- The cat may need care, but it must never shame, threaten, punish, or withdraw
  love from Sirus.
- Needs, care spending, saves, and object interactions must have immediate,
  readable feedback. Sirus should not have to guess whether the game noticed
  him.
- Mom's dashboard, forms, and ledger stay clean and readable; the pixel-art game
  treatment belongs primarily to Sirus's surfaces.

## 3. Experience pillars

### 3.1 A living cat

The cat is not a button. It has a current activity, remembers where it is, reacts
for long enough to be understood, and sometimes acts without input.

### 3.2 A room Sirus owns

The Café is a persistent play space. Sirus can place, move, and store owned
items, then use those items while playing with the cat.

### 3.3 Real life powers care

Screen interactions express care, but real quest activity supplies it. Tapping a
bowl can make the cat eat only when the player has earned the care needed to
refill Hunger.

### 3.4 Consequences without guilt

Low needs have visible, meaningful consequences: behavior changes, the cat asks
for attention, and Hero growth slows until care resumes. Consequences do not
include death, sickness, abandonment, devolution, lost possessions, erased
progress, or emotional rejection.

### 3.5 A family place

The Café begins as Sirus's owned room, but it is not permanently limited to one
visible character. A later family-visits layer lets Mom, Abba, Sirus, and Arlo
enter the room as recognizable pixel avatars. Their presence should make the
room feel inhabited without taking ownership or control away from Sirus.

## 4. Core play loop

1. Hunger, Rest, and Happiness gradually decay with real elapsed time.
2. The cat's behavior, resting pose, and one simple icon cue reflect its most
   important current need.
3. Sirus completes a real-life quest and earns a **Care Charge** as immediate
   game feedback.
4. In the Café, Sirus chooses how to use that charge:
   - bowl → feed the cat;
   - bed/pillow/house → help the cat rest;
   - yarn/toy basket/cat tree → play with the cat.
5. The cat travels to the selected object and performs a clear, lasting action.
6. The chosen need refills with visible cause-and-effect feedback: the meter
   rises, the refill amount appears briefly, and the Care Charge count changes.
   Approved quests also award their normal coins and long-term progression.
7. Sustained quest completion and care build Hero progress.
8. Coins unlock more decorating choices, making the room more personal over
   time.

This separates **earning care** from **performing care**. A chore does not merely
move a bar in the background; it gives Sirus a reason to return to the Café and
interact with the cat.

> **▸ From the code:** Care Charges are a **new** concept, distinct from the
> existing coins. Coins keep their current job (buying décor via
> `purchaseCafeItem`); Care Charges are the quest→care bridge and are spent on
> needs, never on shop items. Keeping them separate avoids taxing the décor
> economy to feed the cat.

## 5. Needs model

Each cat has three needs on a 0–100 scale:

| Need | Meaning | Refilled through | Low-need behavior |
| --- | --- | --- | --- |
| Hunger | Food and physical care | Food bowl after a real quest | Approaches the bowl or Sirus; uses eat-related attention cues |
| Rest | Energy and recovery | Bed, pillow, or house after a real quest | Moves less, rests, or approaches a sleep object |
| Happiness | Play, enrichment, and connection | Yarn, toy basket, cat tree, or petting after a real quest | Seeks Sirus, approaches a toy, or invites play |

> **Naming caution — ▸ From the code:** the existing progression stat is already
> called **Energy** (`cat.energy`, capped 12, part of the Hero gate). The care
> need here is **Rest**, a *different* value. Keep the labels distinct in code and
> UI (`care.rest` vs. `cat.energy`) so the two never get confused or shown as one
> meter.

### 5.1 Need bands

| Value | Band | Effect |
| --- | --- | --- |
| 70–100 | Thriving | Normal idle and wander behavior; occasional playful actions |
| 40–69 | Okay | Normal behavior with occasional need hints |
| 15–39 | Needs care | Relevant attention behavior becomes more likely; Hero growth pauses for that need |
| 0–14 | Urgent but safe | Strong, clear care request; no further penalty beyond the existing low-need effects |

The language shown to Sirus should be descriptive, not accusatory: “Ember looks
hungry” or “Moss could use a cozy rest,” never “You forgot Ember” or “Moss is sad
because you did not do your chores.”

### 5.2 Functional need cue

When a need enters **Needs care** or **Urgent but safe**, the cat may show one
small icon bubble:

| Need | Bubble icon | Tap result |
| --- | --- | --- |
| Hunger | Bowl | Briefly highlights a compatible placed food bowl |
| Rest | Moon/bed | Briefly highlights a compatible bed, pillow, or house |
| Happiness | Yarn | Briefly highlights a compatible yarn, toy basket, or cat tree |

Rules:

- Show at most one need bubble at a time, chosen by the lowest need.
- The bubble communicates a usable action; it is not generic dialogue.
- Tapping it guides Sirus toward compatible objects but never spends a Care
  Charge automatically.
- If no compatible object is placed, tapping the bubble may open or pulse the
  relevant owned item in the décor tray.
- The cue may return after a quiet interval, but it must not blink, bounce
  continuously, or nag.
- Text can supplement the icon for clarity, but the icon must remain
  understandable without reading a speech bubble.

> **▸ From the code:** today `catMood()` already picks a coarse resting look
> (`sleepy` when `energy <= 3`, `happy` after a completion or `bond >= 12`, else
> `calm`). Replace that stat-driven mood with one driven by the **lowest care
> need**, and reuse the existing `spawnFx` sprites for the cue.

### 5.3 Decay proposal — TUNING DRAFT

Initial conservative target:

| Need | Proposed decay per 24 real hours | Approximate full-to-low time |
| --- | ---: | ---: |
| Hunger | 35 points | about 2 days |
| Rest | 25 points | about 3 days |
| Happiness | 20 points | about 4 days |

Rules:

- Decay is calculated from timestamps, so it continues while the app is closed.
- Decay is deterministic, not tied to timers remaining alive in the browser.
- Need values never fall below 0 or exceed 100.
- The first implementation caps offline decay at **48 hours per return**. Longer
  absences do not create a more severe homecoming.
- Newly adopted cats begin at healthy levels so the first session is play, not
  repair.
- Hero form does not remove needs; it changes presentation and may make decay a
  little more forgiving later.

These rates should be tested against Sirus's actual quest rhythm before being
treated as final.

> **▸ From the code / feasibility:** this is a static Pages app with a Firestore
> backend — **there is no server cron and no background job.** That is fine: the
> timestamp model needs none. Store `care.lastUpdatedAt`; on render compute
> `display = clamp(stored − rate × hoursSince(lastUpdatedAt), 0, 100)` (read-only,
> no write); on any care action recompute all needs to *now*, apply the refill,
> then write values + a fresh timestamp. Because it is derived from a timestamp,
> every device agrees without syncing a clock, and the existing Firestore
> snapshot flow propagates it. The 48 h cap is just a clamp on the elapsed term.

### 5.4 Real-use calibration

Known behavior from the current app:

- Sirus earns roughly **15–20 points on an active day**.
- Ember reached Hero form during the **first day** of use.
- Existing points and individual quest completions are not assumed to be the
  same unit. The number of quests and their point values must be audited before
  Care Charges are balanced.

Implications:

- The current Hero threshold produces an early-session unlock, not the sustained
  care payoff described in this spec.
- Care must not be awarded once per point. The draft Care Charge is awarded per
  completed quest, regardless of that quest's point value.
- Decay and refill tuning should be tested against a normal week of activity,
  including quieter days, rather than against the highest observed day.
- The existing first-day evolution is preserved. Rebalancing must never devolve
  Ember or require Sirus to re-earn an achievement already granted.

> **▸ Resolved (see §0.4):** the audit is done — 13 quests × 1 point = points and
> completions run ~1:1, so "15–20 points" ≈ "15–20 completions." Tune the Care
> Charge **cap and refill**, not the earn rate.

### 5.5 Alternative Rest model to consider — TUNING DRAFT

An option worth recording before Slice 4 locks: instead of Rest decaying like the
other two needs, **Rest could recover on its own over time** (the cat naps) and
be *spent by play* (each play costs some Rest). Rest then becomes a natural
rhythm limiter — a couple of plays, then the cat wants a nap — rather than a
third chore. This keeps play from being spammable without adding a care burden,
and it leans on the existing sleep/cat-on-bed art.

Trade-off: it makes Rest asymmetric with Hunger/Happiness (one recovers, two
decay), which is slightly harder to explain to Sirus. The symmetric model in §5.3
is simpler to teach. **Recommendation:** ship the symmetric model first; if Rest
feels like busywork in testing, switch Rest to self-recovery + play-cost. Either
way, `play` nudging Rest down a little gives back-to-back play a natural "let the
cat rest" beat.

## 6. Care Charges and quest mapping

### 6.1 Proposed rule — TUNING DRAFT

- Marking a quest complete grants one immediate Care Charge.
- A Care Charge is tied to the quest completion, **not each point** the quest is
  worth.
- Sirus can spend that charge on Food, Rest, or Play in the Café.
- Parent approval remains the gate for permanent coins, ledger effects, and
  Hero progress.
- If a quest is not approved, already-spent care is not clawed back from the cat.
- Care Charges may be stored up to a small cap so Sirus can choose when to visit
  the Café, but cannot stockpile enough to make needs irrelevant.

Proposed initial cap: **6 charges**.

Proposed refill per charge: **+20** to the chosen need.

The cap and refill amount remain provisional until the repo confirms how many
individual quest completions usually make up Sirus's observed 15–20 points per
day. If he completes many small quests, one charge per quest may still be too
generous even though it is not one charge per point.

> **▸ Resolved (see §0.4):** confirmed ~15–20 completions/day, so per-quest
> charges overflow any small cap — **the cap is the binding constraint.** With
> cap 6 × +20, a returning Sirus can top up ~1.2 needs' worth per visit, which
> comfortably offsets the §5.3 daily decay. That is intentionally easy-if-you-do-
> your-chores; tighten by lowering the cap or refill if testing shows needs never
> meaningfully dip.

> **▸ From the code — where to hook:** quest completion and parent approval both
> run through transactional writes in `src/store.js` (the approval path applies
> `brain/energy/bond/coins`). Grant the Care Charge on the **child's completion**
> write (immediate feedback), and keep coins/progression on the **approval**
> write, exactly as §6.1 intends. Amounts must be server-authoritative — never
> trust a charge count sent from the child device (same rule the reward code
> already follows).

### 6.2 Alternative to consider

Quest categories could award typed care instead:

- Morning / food-related tasks → Food;
- Night routine → Rest;
- Move / Brain / Tidy-and-Help → Play or flexible care.

This is more thematic but less flexible. The first build should use flexible
charges unless testing shows that choosing among care types is confusing.

> **▸ From the code:** the section taxonomy already exists
> (`Morning / Brain / Move / Tidy / Night / General` in `quests.js`), so typed
> care would be cheap to add later — the mapping key is already on every quest.

## 7. Cat behavior state machine

The cat has exactly one primary state at a time.

| State | Trigger | Expected behavior | Exit |
| --- | --- | --- | --- |
| `IDLE` | No higher-priority activity | Sit, breathe, look around, or make a tiny shift | Autonomous choice or interaction |
| `WANDER` | Random idle choice while needs allow | Walk/slide to a valid open location and remain there | Arrive at destination |
| `SEEK_ATTENTION` | A need is low and no interaction is active | Approach Sirus/front area or the relevant object; show a gentle cue | Care begins, tap response, or timeout |
| `APPROACH_OBJECT` | Sirus taps an interactive object | Move toward a usable position beside that object | Arrive, then enter object activity |
| `EAT` | Bowl selected and care is available | Show eat pose at the bowl; refill Hunger visibly | Animation completes |
| `PLAY` | Toy selected and care is available | Show play pose at the toy; refill Happiness visibly | Animation completes |
| `SLEEP` | Sleep object selected and care is available, or Rest is very low | Show sleep/cat-on-bed pose and remain asleep meaningfully | Sirus wakes/moves cat or rest completes |
| `PET_REACTION` | Sirus taps the cat | Pause, react, and acknowledge the touch | After a readable duration |
| `CELEBRATE` | Quest/care milestone | Use celebrate pose and effect | After animation completes |
| `HERO_EVENT` | Evolution milestone | Hero pose overrides normal activity | Event completes |
| `DRAGGED` | Sirus drags the cat | Follow pointer/finger | Drop at valid position, then idle |

> **▸ From the code:** the ingredients already exist but are scattered across ad
> hoc timers — `catStroll` (WANDER), `catIdleBeat`/`scheduleCatIdle` (IDLE),
> `reactCat` (PET_REACTION), `cafePoseArt` (pose lookup incl. cat-on-bed for
> SLEEP), and the evolution flow (HERO_EVENT). The work is **consolidating these
> into one state variable with the priority rules below**, not writing behavior
> from scratch. `EAT` and `APPROACH_OBJECT` are the genuinely new states (and
> `EAT` finally renders the dead `eat` pose from §0.6).

### 7.1 State priority

Highest to lowest:

1. Direct manipulation (`DRAGGED`)
2. Hero/evolution event
3. Sirus-requested object interaction
4. Celebration
5. Urgent attention-seeking
6. Sleep/resting
7. Autonomous wandering
8. Idle

High-priority states cancel or pause lower-priority ones. A stale timer may never
reset a newer action.

> **▸ From the code:** the current bug §0.6 describes is exactly a *stale timer
> resetting a newer action* — `catSettleTimer` fires 900 ms later and overwrites
> whatever the cat is doing now. The new machine must cancel pending timers on
> every state transition (a single `currentState` + one cancelable timer, not the
> several free-running timers today).

### 7.2 Minimum readable durations — TUNING DRAFT

- Tap/pet reaction: 2.5–4 seconds
- Eat: 6–10 seconds
- Play: 6–10 seconds
- Celebration: 3–5 seconds
- Attention request: 8–15 seconds, then return to an appropriate resting state
- Sleep: persists until interrupted or until the rest action resolves; it is not
  a sub-second sprite swap
- Wander: travel time depends on distance; the cat remains at its destination

The current “change picture, then immediately snap back” behavior is explicitly
out of spec. (**▸ From the code:** that is the 900 ms `catSettleTimer` in
`reactCat`; removing it is part of this slice.)

### 7.3 Autonomous behavior

While the Café is open and the cat is not busy:

- choose an idle variation or short wander after a randomized delay;
- remain inside the walkable room bounds;
- avoid covering critical controls;
- prefer relevant placed objects when a need is low;
- do not repeatedly interrupt Sirus with attention cues;
- do not snap back to center after wandering;
- reduce wandering when Rest is low;
- increase playful idle choices when Happiness and Rest are high.

Existing single-frame poses are sufficient for the first version. Two-frame idle
or walk art is later polish, not an MVP blocker.

> **▸ From the code:** `catStroll` currently wanders and then **snaps back to
> `left: 30%`** after ~1.4–2.6 s — the exact "snap back to center" this section
> forbids. The state machine keeps the cat where it wandered instead of scheduling
> a return.

### 7.4 Welcome-back behavior

Opening the Café should not always reset the cat to a frozen center position.
After restoring the saved room and applying elapsed-time decay, choose one valid
opening presentation based on the saved state and current needs:

- remain at the cat's last saved location in an appropriate idle pose;
- already be sleeping at a placed bed when Rest is lowest;
- investigate or sit near a placed toy when needs are healthy;
- approach the front/attention area with the current functional need cue.

This is presentation, not a random reward or a hidden need change. It must never
move stored objects, spend care, or overwrite Sirus's saved cat position before
he interacts.

## 8. Direct interaction

### 8.1 Moving the cat

- Sirus can press and drag the cat in Play mode.
- The cat remains where it is dropped, clamped to the walkable room area.
- Dragging cancels the cat's current autonomous movement or noncritical action.
- Dropping near a compatible object may suggest an interaction, but must not
  spend a Care Charge without a clear tap/confirmation.
- The cat's last location persists across normal reloads.

> **▸ From the code:** décor drag already works via pointer capture in
> `initCafeInteractions` (grab → move → `moveCafeItem` save). Cat-drag can reuse
> that exact plumbing; today the cat has no drag handler (taps go to `reactCat`).

### 8.2 Tapping the cat

- A tap produces a readable pet/attention response.
- Tapping is always allowed and never costs care.
- Petting may provide a tiny visual acknowledgment, but cannot refill Happiness
  indefinitely or replace real quests.
- Repeated taps should not restart the animation so rapidly that it flickers.

> **▸ From the code:** `reactCat` already does haptics + a squash-stretch + a
> finger-positioned sparkle burst — keep that *feel*, just (a) drop the 900 ms
> settle-timer revert and (b) route it through `PET_REACTION` so a newer state
> can't be clobbered. A tiny per-day Bond nudge on petting is fine (Bond is
> cosmetic, §0.2) but cap it so it can't be farmed.

### 8.3 Tapping objects

| Object type | Play-mode action |
| --- | --- |
| Food bowl | Cat approaches and eats; offers to spend a Care Charge on Hunger |
| Water bowl | Cat approaches and drinks; small neutral care animation, or later supports a fourth need if intentionally added |
| Bed / pillow / house | Cat approaches and sleeps; offers to spend a Care Charge on Rest |
| Yarn / toy basket / cat tree | Cat approaches and plays; offers to spend a Care Charge on Happiness |
| Decorative objects | Small feedback only; they do not pretend to be usable care objects |

If no Care Charge is available, the cat may still approach or acknowledge the
object, but the UI explains gently that completing a quest earns care. It should
never fake a refill.

Every placed object should acknowledge a Play-mode tap, even when it is purely
decorative. The smallest acceptable responses are a short wiggle, a sparkle or
paw effect, or the cat briefly looking toward it. Feedback must not imply that a
need changed when it did not. Reuse `fx-sparkle.png`, `fx-starburst.png`,
`fx-confetti.png`, and `fx-paw.png` before requesting new effects.

> **▸ From the code:** the object→need mapping keys off item IDs already in
> `CAFE_ITEMS` — food/water bowls (`foodBowl`, `waterBowl`), beds (`bed`,
> `pinkBed`, `greenBed`, `petPillow`, `petHouse`), toys (`rug`/`pinkYarn` yarn,
> `toyBasket`, `tower` cat-tree). Tag each item in `cafe-items.js` with a
> `role: 'food' | 'rest' | 'play' | 'decor'` so the Café doesn't hardcode ID
> lists. Collars/crown are `decor` (see §9.2). The décor `wiggle` acknowledgment
> already exists in `initCafeInteractions`.

### 8.4 Drag-the-yarn play

Yarn supports one direct toy interaction in addition to ordinary tap-to-play:

- In Play mode, Sirus can press and drag a placed yarn ball.
- If the cat is available, it turns toward or follows the yarn within the
  walkable room bounds.
- On drop, the cat moves to the yarn and performs the existing play pose for a
  readable duration.
- Dragging and playing with yarn are always allowed as screen play.
- Refilling Happiness still requires a clearly offered Care Charge; moving yarn
  alone cannot keep the need full indefinitely.
- If the cat is sleeping, eating, in a Hero event, or being directly dragged,
  the yarn acknowledges the touch without incorrectly interrupting the
  higher-priority state.

### 8.5 Visible care resolution

When Sirus confirms a care action, feedback occurs in this order:

1. The cat reaches the compatible object and begins the activity.
2. The relevant need meter animates from its old value to its new value.
3. A brief `+amount` label appears beside that meter.
4. The Care Charge count visibly decreases by one.
5. A small sparkle/paw effect confirms completion.

The UI must prevent double spending from repeated taps and must not show the
refill before the write is accepted locally. If saving later fails, retain the
local action for retry rather than snapping the cat or meter backward without
explanation.

## 9. Decorate mode

The Café has two explicit modes:

- **Play:** interact with the cat and placed objects.
- **Decorate:** arrange the room without accidentally triggering cat actions.

> **▸ From the code:** today there is only one mode — décor drag and cat tap
> coexist in the same view, which is why placed items and the cat fight for the
> same taps (the Phase-0 z-index stopgap, §0.5). Splitting into Play/Decorate is
> the real fix and lets §0.5's stopgap be removed.

### 9.1 Decorate-mode requirements

- A visible `Decorate Room` control enters the mode.
- An item tray shows all owned décor, including items currently stored.
- Sirus can drag an owned item from the tray into the room.
- Sirus can drag placed items to new positions.
- Sirus can return an item to storage without losing ownership.
- A clear `Done` control exits and saves.
- A visible `Undo` control reverses the most recent placement, move, layering,
  or storage action during the current decorating session.
- One-step Undo is required for the first version. A full history, redo stack,
  or version browser is not.
- Items are constrained to valid room bounds.
- Placement uses free drag; optional soft snapping may help alignment but should
  not make the room feel rigid.
- Basic front/back layering is based on vertical position. A later version may
  add explicit “bring forward/send backward” controls if needed.
- Decorative placement cannot cover navigation or essential UI controls.
- The layout persists per child/profile.
- Unsaved or failed saves must not silently erase the last known layout.

> **▸ From the code:** `setCafeItemPlaced` already models stored-vs-placed, and
> `cafeSlot()`/`CAFE_SLOTS` already provide default positions for un-placed
> items — reuse both. The tray is essentially the current shop grid filtered to
> owned items.

### 9.2 Initial usable art inventory

The existing manifest already supports the first room:

- yarn: blue and pink;
- beds: blue stars, pink hearts, green paws;
- mint pillow and green pet house;
- plant, cat tree, bookshelf, toy basket;
- food and water bowls;
- moon collar, teal-heart collar, crown;
- pastel bunting.

The moon collar, teal-heart collar, and gold crown are treated as small
placeable display objects in the first build. Making them wearable is a separate
feature because each cat pose would need reliable attachment positioning.

The room background is `cafe-room.png`. Cat sprites and objects remain
transparent 256px chunky pixel art with crisp nearest-neighbor rendering.

> **▸ From the code:** this list matches `CAFE_ITEMS` exactly (17 items). Note
> the legacy IDs don't match display names — e.g. `rug` is "Blue Yarn", `bed` is
> "Blue Star Bed" — and `cafe-items.js` warns those IDs must not be renamed
> (migration compatibility). Key the `role` tags off IDs, not names.

### 9.3 Ownership and shop boundary

- Decorate mode may place only owned items.
- Buying/unlocking décor remains the shop/inventory system's job.
- Stored items are not deleted or refunded.
- Rearranging never costs coins.
- Low needs never lock, remove, or damage décor.

### 9.4 Room snapshot — small enhancement, not MVP-blocking

A camera control may capture the current room exactly as it appears, including
the cat and placed décor.

First version boundaries:

- save or download one image using the device's normal file flow;
- hide editor controls from the captured image;
- do not add an in-app album, cloud gallery, comments, or social sharing;
- do not require camera permission, because this captures the rendered room,
  not the device camera.

## 10. Persistence model

Minimum persisted state per child/profile:

```text
cafeState
  selectedCatId
  catPosition { x, y }
  catNeeds { hunger, rest, happiness, lastUpdatedAt }
  careCharges
  heroCareProgress
  roomLayout[]
    instanceId
    assetId
    x
    y
    z
    stored
  schemaVersion
```

Requirements:

- Coordinates are normalized to the room, not saved as device-specific pixels.
- Need decay is derived from `lastUpdatedAt`; it is not written every minute.
- State writes are debounced during dragging and flushed when Decorate mode ends.
- Existing users receive safe defaults through migration/fallback logic.
- The app remains usable offline and syncs when connectivity returns.
- Firestore/security rules must explicitly allow only the intended child/profile
  Café fields and must be deployed and verified before the feature is considered
  complete.
- Conflicting writes should preserve owned items and the most recent intentional
  room arrangement.

> **▸ From the code — migration:** today décor lives as `ownedItems: [{ id, x, y,
> placed }]` on the child, and needs would live on each cat doc (`cats/{id}`).
> Map old records into `roomLayout[]` (`id → assetId`, keep `x`/`y`, derive `z`
> from `y`, `placed:false → stored:true`); default `catNeeds` to healthy and
> `careCharges: 0` for existing users so no one is punished at rollout.
> Normalized 0–100 % coords are already what `moveCafeItem` stores, so this is a
> rename/superset, not a data rewrite.

## 11. Hero evolution relationship

Hero form represents sustained real-world effort and care—not a perfect streak.

### 11.1 Existing-user transition

- Ember's existing Hero form remains unlocked permanently.
- Ember continues to have needs, receive care, play, sleep, wander, decorate,
  and build any future post-Hero progression; Hero form is not an endpoint that
  removes the virtual-pet loop.
- The rebalanced rule applies to cats that have not yet evolved and to future
  evolution systems. It does not rewrite Sirus's history.
- Existing progress for Nova or Moss must be migrated without subtracting what
  Sirus has already earned.

> **▸ From the code:** `evolved` is a sticky boolean on the cat and
> `applyCatProgress` only ever sets `evolved ||= isHeroReady(...)` — it can never
> flip back to false. So "never devolve" is already guaranteed by the current
> data model; the new care-gate must preserve that (gate *new* progress, never
> clear `evolved`).

### 11.2 Timeline calibration — DECISION NEEDED

At the observed pace of 15–20 points per active day, a points-only threshold
would roughly correspond to:

| Intended active-day target | Observed point range |
| ---: | ---: |
| 7 days | 105–140 points |
| 14 days | 210–280 points |
| 21 days | 315–420 points |
| 30 days | 450–600 points |

These ranges are reference math, not recommended thresholds. Because Hero form
is meant to represent sustained care, the final rule should include activity
across multiple distinct days rather than a point total that can be rushed in
one session. The intended number of active days is still a product decision.

Draft rule:

- Approved quests continue to build the existing long-term progression.
- A quest contributes its full Hero value when the cat is receiving adequate
  care.
- Low needs **pause or reduce new Hero-care progress**; they never subtract
  earned progress.
- Restoring care resumes progress immediately.
- Hero progress never decays and the cat never devolves.
- Evolution uses the existing Nova, Ember, and Moss Hero assets and a clear
  celebratory event.
- Do not reuse the current threshold that allowed a first-day evolution.

The exact relationship among current Brain, Energy, Bond, and the new three
needs must be audited before implementation so the app does not show duplicate
or contradictory meters.

> **▸ Resolved (see §0.2 / §0.3):** the audit is done. Current gate is
> `brain ≥ 12 && energy ≥ 12` (Bond excluded), and the +2 brain / +2 energy daily
> quests are why day-1 evolution happens. Recommended new rule: keep the 12/12
> caps as *one* requirement **and** add a distinct-active-days counter
> (`heroCareProgress`) that only advances on days the cat is at least "Okay"
> (§5.1). Evolve when both are satisfied. This reuses the existing stats as the
> "effort" axis and adds "sustained care over N days" as the second axis — no
> duplicate meter, and it answers **§18 Q2** once you pick N (recommend ~14).

## 12. Character identity

Behavior can share one state machine, but presentation should match the selected
cat:

- **Nova — Curious Moon Cat:** investigates objects, pauses and looks, gently
  invites exploration.
- **Ember — Brave Orange Cat:** energetic approaches, bold play, enthusiastic
  celebrations.
- **Moss — Steady Calico Cat:** calm pacing, cozy resting, reassuring attention
  cues.

The first build may express this through timing, preferred idle choices, and
short text cues. It does not require unique mechanics or AI chat.

> **▸ From the code:** the titles above already exist verbatim in `CAT_DEFS`
> (`title` fields), and each cat has its full pose set + hero art + favored bed.
> Identity is a matter of *timing/choice weighting* over the shared machine, not
> new assets.

### 12.1 Tiny sound layer — optional polish

The Café may use a very small set of short sounds: purr/pet, munch, sleepy cue,
play chirp, placement click, and celebration chime.

- Provide an obvious sound toggle on Sirus's Café surface.
- Respect the saved preference and avoid overlapping loops.
- Never use repetitive distress sounds for low needs.
- The game remains fully understandable with sound off.
- Sound is polish and may not block the interaction MVP.

## 13. Family visits — locked future direction

Mom, Abba, Sirus, and Arlo should eventually be able to enter and appear inside
the Café. `ART-PROMPTS.md` already defines warm pixel avatars for all four;
**Arlo is a family avatar, not a pet**.

The first family-visits version should:

- let Sirus choose who is currently visiting the room;
- support one or more family avatars without hiding the cat or essential UI;
- let visitors visibly acknowledge the cat, objects, and each other through
  small reactions or idle behavior;
- preserve Sirus's room arrangement when visitors enter or leave;
- keep the room playable on a phone-sized screen;
- treat family presence as connection and play, not as a requirement for
  maintaining the cat's needs.

Default permission boundary until deliberately changed:

- Sirus remains the room owner.
- Visitors may interact with the cat and usable objects.
- Visitors do not automatically spend Sirus's Care Charges or coins.
- Visitors do not move, store, buy, or remove Sirus's décor unless a later
  shared-decorating mode explicitly grants that ability.

This can begin as local, on-screen character selection. It does not require
simultaneous multiplayer accounts, real-time networking, or separate devices in
its first version.

## 14. Gentle-parenting and CBT-aligned guardrails

The Café may create motivation and responsibility. It may not turn care into
fear, shame, or emotional coercion.

Never:

- say the cat is disappointed in Sirus;
- blame low needs on missed chores;
- threaten death, illness, running away, loss of love, or loss of ownership;
- erase coins, décor, Bond, Hero progress, or an evolved form because time
  passed;
- use harsh streak loss or “you failed” language;
- make the cat refuse affection as punishment;
- send manipulative notifications implying the cat is suffering.

Do:

- show the current state clearly;
- offer one understandable next action;
- celebrate repair and returning after time away;
- let Sirus restart without a lecture;
- frame needs as information: notice, choose, care, continue;
- preserve affection/Bond as secure even when a need is low.

## 15. Scope of the Interactive Café MVP

The MVP is complete when all of the following work together:

1. Sirus can enter and exit Play and Decorate modes clearly.
2. He can place, move, store, and restore owned décor.
3. The layout and cat location survive reload and work across supported screen
   sizes.
4. He can drag the cat and leave it where dropped.
5. The cat idles and wanders without snapping back to center.
6. Tapping the cat creates a readable response.
7. Tapping a bowl, sleep object, or toy makes the cat travel there and perform
   the correct lasting pose.
8. Dragging yarn makes the cat visibly follow and play without turning screen
   play into an unlimited Happiness refill.
9. A low need produces one functional icon cue that guides Sirus to a compatible
   object.
10. A completed care action visibly changes the correct meter and Care Charge
    count.
11. Decorate mode includes at least one-step Undo.
12. Hunger, Rest, and Happiness decay from real elapsed time.
13. Real quest completion supplies limited care; screen tapping alone cannot keep
   every need full.
14. Low needs change behavior and prompt attention without removing progress or
    using guilt.
15. Care and approved quests contribute to Hero evolution without devolution.
16. All state saves safely, including offline/reconnect behavior.

## 16. Recommended build slices

### Slice 0 — unblock persistence

- Audit current Café code and deployed Firestore rules.
- Verify existing décor writes actually save and reload.
- Add migration-safe Café state defaults.

> **▸ Status:** the **code audit is done — see §0.** Remaining Slice 0 work is
> the *Firestore rules* review + the migration defaults (§10 note). The Phase-0
> papercuts (§0.5) are already merged on this branch.

### Slice 1 — the room becomes Sirus's

- Add explicit Play/Decorate modes.
- Add item tray, free placement, storage, bounds, and persistence.
- Add one-step Undo for the current decorating session.
- Make the cat draggable and persist its position.

### Slice 2 — the cat becomes alive

- Replace reset timers with the explicit behavior state machine.
- Add lasting tap response, idle, wander, and attention states.
- Add state-aware welcome-back presentation and the functional need cue.
- Prevent stale timers and center snapping.

### Slice 3 — objects become playable

- Add approach movement and bowl/bed/toy interactions.
- Add drag-the-yarn play and lightweight feedback for decorative object taps.
- Animate meter refills and Care Charge spending so cause and effect are clear.
- Use the existing eat, sleep, play, celebrate, and cat-on-bed sprites.
- Add clear no-charge feedback without guilt.

### Slice 4 — real-life care loop

- Add Needs, timestamp decay, Care Charges, and quest hooks.
- Tune decay/refill values from actual use.
- Connect care to Hero progress.

### Slice 5 — animation polish

- Add two-frame idle/walk variants if desired.
- Add cat-specific timing and small visual effects.
- Add the optional sound layer and single room snapshot.
- Improve object-specific reactions without changing core rules.

### Slice 6 — family visits

- Add selectable Mom, Abba, Sirus, and Arlo visitor avatars.
- Add safe room placement and simple visitor idle/reaction behavior.
- Preserve room ownership and spending permissions.
- Treat real-time multiplayer or shared decorating as a separate later choice.

> **▸ Sequencing note (from mine):** a smaller "prove-the-loop" step can sit
> between Slices 3 and 4 — **one need (Hunger) end-to-end**: `catNeeds.hunger` +
> timestamp decay + a Care Charge earned on quest completion + tap-the-bowl →
> `EAT` pose → meter rises. It exercises the whole vertical (store → decay → state
> machine → visible resolution) on one need before the full three-need system,
> and it's the fastest way to put a *doing something* cat in front of Sirus.

## 17. Non-goals for the first build

- AI chat or open-ended cat dialogue
- Remaking existing art at a lower resolution
- Breeding, death, sickness, or permanent pet loss
- A fourth need such as hygiene unless deliberately added later
- Complex furniture collision physics
- Family visitor avatars in the initial MVP
- Simultaneous multiplayer or unrestricted shared-room editing
- Full parent-dashboard pixel-art reskin
- Large catalogs of new décor before existing items are interactive
- Wearable collar/crown positioning across every cat pose
- An in-app screenshot album or social/photo-sharing system
- Large minigames added to compensate for an unresponsive core room
- Unique code architecture for each cat

## 18. Decisions to refine next

These questions should be answered before Slice 4 is finalized. Items marked
**▸ Answered** are resolved by the §0 audit; the rest remain product decisions.

1. Roughly how many individual quest completions make up Sirus's observed
   15–20 points on a typical day? — **▸ Answered (§0.4): ~1:1, so ~15–20
   completions.**
2. How many **active care days** should a new cat usually take to reach Hero
   form: about 7, 14, 21, 30, or another target? *(Recommend ~14; see §11.2.)*
3. Are flexible Care Charges the right bridge from quests to care, or should
   quest categories earn Food/Rest/Play separately? *(Section taxonomy already
   exists in code if you later want typed care — §6.2.)*
4. Should a Care Charge be granted when Sirus marks a quest complete, when Mom
   approves it, or in two stages? *(Code supports either hook — §6.1 note.)*
5. Are the proposed decay rates slow enough for the household's real rhythm?
6. Is a 48-hour offline-decay cap appropriate, or should the cat effectively
   “pause” after one day away?
7. Should sleep remain active until Sirus wakes the cat, or end automatically
   after a fixed rest animation?
8. Should each child have one shared room across cats, or a separate saved room
   for each cat? *(Today décor is per-child, not per-cat — §0.7.)*
9. How should the current Energy, Brain, Bond, and coin systems relate to
   Hunger, Rest, Happiness, and Hero progress without duplicate meanings? —
   **▸ Answered (§0.2): two separate layers; Bond isn't in the Hero gate; coins
   stay décor-only; Care Charges are new.**
10. Which existing objects are initially owned, shop-unlocked, or cat-specific? —
    **▸ Answered (§0.7): none owned by default; all shop-unlocked; each cat has a
    favored bed for the nap art.**
11. Can the cat freely overlap furniture, or should only major objects reserve
   space?
12. What exact attention cue feels clear to Sirus without becoming nagging?
13. Does Sirus choose family visitors freely, or should visits sometimes follow
    events such as a parent approving a quest?
14. When family visits are built, may visitors only interact, or can Sirus grant
    selected people permission to help decorate?
15. Should sound begin on or off by default, while always preserving Sirus's
    saved mute choice?
16. Should a room snapshot download immediately or first show a simple preview
    with Save/Cancel?
17. **New — Rest model:** symmetric decay (§5.3) or self-recovery + play-cost
    (§5.5)? *(Recommend symmetric first, switch if it feels like busywork.)*

---

## Source art contract

This spec follows `ART-PROMPTS.md`:

- cozy storybook, chunky retro pixel art;
- base 64×64 exported at 4× to 256×256;
- crisp nearest-neighbor scaling, no anti-aliasing or gradients;
- warm cream/teal/orange/pink/sage palette;
- transparent cat and prop sprites;
- Nova, Ember, and Moss identities remain locked;
- `mom.png`, `abba.png`, `sirus.png`, and `arlo.png` are the planned family
  visitor avatars, with Arlo treated as family;
- existing sit, play, eat, sleep, celebrate, Hero, cat-on-bed, and Café object
  assets are reused before requesting more art.

---

## Deploy reminder

Edit under `cat-trainer-v2/` on a dev branch → **`node tools/stamp.mjs`**
(cache-bust — don't skip) → PR into the Pages branch
(`claude/github-upload-sharing-e67k75`) → merge → Pages redeploys in ~1–2 min →
fully close/reopen the app on each device to clear the service-worker cache.
Documentation-only changes (like this file) don't need the stamp.

## Provenance

This combined spec = the product/experience "Interactive Café Goal" (v2) + a
code-grounded audit of `cat-trainer-v2/` (Aug 2026). **▸ From the code** notes and
§0 come from reading the shipped source; the product direction, guardrails, and
slice plan are unchanged from v2.
