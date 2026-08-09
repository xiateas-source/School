# Cat Trainer — Interactive Café Goal

> **Status:** Active product spec and roadmap, reconciled through the live
> three-need care release (PR #36, August 9, 2026). Hunger has passed device
> testing. Rest and Happiness are live and awaiting Sirus's device test before
> Hero-care progression begins.
>
> **This is the combined spec.** It merges the product/experience spec (the
> "Interactive Café Goal") with a **code-grounded audit** of the current app, so
> the roadmap stays tied to shipped behavior. It records durable requirements,
> locked decisions, current verification, and remaining work—not a changelog of
> one-off fixes. Values marked **TUNING ACTIVE** are implemented starting values
> that may change after real use.

> **Observed calibration (August 2026):** Sirus has earned about **15–20 existing
> app points per active day**. Ember reached Hero form on the first day. These are
> real-use baselines for tuning; the current Hero threshold must not be copied
> unchanged into the Interactive Café progression model.

---

## 0. Codebase reality — grounded audit (Aug 2026)

Everything in this section is read from the current `cat-trainer-v2/` source, so
**Slice 0's audit is complete.** Build against these facts and the locked calls
in §0.8.

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

Keep two clearly separate layers with no duplicate meaning:

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

### 0.4 Points ↔ quest completions

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

### 0.5 Released room baseline

- Play and Decorate are separate modes. Cat and décor movement persist as
  normalized room coordinates.
- Cat taps, object taps, blank-room calls, and décor dragging have distinct
  input paths and readable feedback.
- One-step Decorate Undo, stored-item placement, and room bounds are implemented.

### 0.6 Released behavior baseline (§7)

- Cat actions run through one interruption-safe state controller; a stale action
  timer cannot reset a newer interaction.
- Idle, walk, eat, play, sleep, pet, celebrate, drag, and object-approach states
  use the mapped art and leave the cat at its saved destination.
- Autonomous wandering remains disabled until its destination choice and pacing
  pass a dedicated device test.

### 0.7 Décor persistence & shop

- **▸ From the code:** each owned item is a document in `ownedCafeItems` with its
  purchase record plus `x`, `y`, and `placed`; `moveCafeItem` saves position and
  `setCafeItemPlaced` toggles storage.
- **▸ From the code:** all 17 items in `CAFE_ITEMS` are shop-purchasable with
  coins. A fresh child starts with zero coins and no owned décor. Food and water
  bowls are ordinary shop items.
- A child purchase is one atomic, rules-validated transaction: a known item is
  created and coins fall by that item's exact catalog price.
- Each cat's transparent sleep frames layer over whichever rest object is used.
  The three signature cat-on-bed composites remain archived art unless complete,
  consistent cat × furniture coverage is deliberately added.

### 0.8 Decisions locked (Aug 2026)

Per the family's go-ahead, the open forks are decided here so building can
proceed. **All remain tunable in testing** — this locks a starting point, not a
final balance sheet. This table is the authoritative record of the starting
decisions; the sections below keep the fuller reasoning.

| Fork | Locked call | Why |
| --- | --- | --- |
| **Hero unlock rule** (§11.2) | Keep the 12/12 Brain+Energy caps **and** require **14 distinct active care days** (`heroCareProgress`, advances only on days the cat is at least "Okay") | Can't be rushed in one session; ~2 weeks of real habit, not a grind |
| **Rest model** (§5.3, §5.5) | **Symmetric decay** (§5.3); `play` also nudges Rest down. Self-recovery (§5.5) is the documented fallback if Rest feels like busywork | Simplest to teach Sirus first |
| **Care Charge grant** (§6.1) | On the **child's quest completion** (immediate); coins + progression still gated on **parent approval** | Responsive without waiting on an adult |
| **Care Charge type** (§6.2) | **Flexible** — spend on any need; typed-by-section care deferred | Fewer choices for a young kid |
| **Decay rates** (§5.3) | Hunger 35 / Rest 25 / Happiness 20 per 24 h as the starting point | Conservative; retune from a real week |
| **Offline-decay cap** (§5.3) | Keep **48 h** | Gentle homecoming |
| **Rest-action end** (§7.2) | A Care-Charge rest **auto-ends** after the sleep animation; a low-Rest *self-nap* persists until Rest recovers or Sirus moves the cat | Predictable and cozy |
| **Room scope** (§10) | **One shared room per child** (matches current per-child décor) | Simplest; per-cat rooms can come later |
| **Furniture overlap** (§9.1) | Cat may **freely overlap** furniture (no collision) for MVP | Matches the "no collision physics" non-goal |
| **Sound** (§12.1) | **Off by default**, saved preference respected | Least intrusive |
| **Room snapshot** (§9.4) | **Preview with Save/Cancel**, not an instant download | A beat to confirm the shot |
| **Attention-cue wording & family visits** (§13, §18) | **Deferred** to their own slices; not MVP-blocking | Later polish |

### 0.9 Current animation and interaction ground truth (Aug 2026)

- Two-frame idle, play, eat, walk, and sleep art is mapped for all three cats.
  Object-directed actions use it; reduced-motion mode moves directly to the
  destination and shows the meaningful action still.
- The resting look is driven by daily care, never the long-term training Energy
  stat. Low Rest selects quiet sleep; otherwise the cat is awake by default.
- Blank-room taps call the cat to that saved location. Water has a distinct
  neutral action, Toy Basket is a play object, and every cat uses the same
  cat-only sleep layering path on every rest object.
- Hunger and the core object-interaction loop passed device testing. Rest and
  Happiness still need their post-release device pass.

**Animation plan:** **`ART-ANIMATION.md`** records the frame manifest, generation
prompts, and frame-swapper wiring. All three tiers are present and mapped; object
actions now call them for food, rest, and play care.

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
- Sirus can **move the cat and decorate the room**. Dragging remains available,
  and tapping an open spot calls the cat to walk there and stay there.
- Furniture placement persists. The room should reopen as Sirus left it.
- **Mom, Abba, Sirus, and Arlo can eventually appear inside the Café as family
  visitors.** This is a locked future direction, not a requirement for the first
  Interactive Café MVP.
- Short, deterministic **cat speech bubbles** eventually deliver meaningful
  family feedback: exciting parent-added points and gentle returned-quest
  messages. This is not AI chat and does not block the core care loop.
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
include death, abandonment, devolution, lost possessions, erased progress, or
emotional rejection. A later advanced-care expansion may add a **temporary,
fully recoverable “under the weather” state and medicine**, because Sirus wants
pet care to carry more responsibility; §5.6 defines the safety boundary. That
health layer is deliberately after the three core needs work end-to-end.

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

> **▸ From the code:** `catMood()` now uses the **lowest daily care need**, never
> the long-term Energy stat. The functional cue selects that same lowest need and
> highlights a compatible placed object—or the matching stored-item tray—without
> spending care.

### 5.3 Implemented decay — TUNING ACTIVE

Current starting values:

| Need | Decay per 24 real hours | Approximate full-to-low time |
| --- | ---: | ---: |
| Hunger | 35 points | about 2 days |
| Rest | 25 points | about 3 days |
| Happiness | 20 points | about 4 days |

Rules:

- Decay is calculated from timestamps, so it continues while the app is closed.
- Decay is deterministic, not tied to timers remaining alive in the browser.
- Need values never fall below 0 or exceed 100.
- Offline decay is capped at **48 hours per return**. Longer
  absences do not create a more severe homecoming.
- Newly adopted cats begin at healthy levels so the first session is play, not
  repair.
- Hero form does not remove needs; it changes presentation and may make decay a
  little more forgiving later.

These rates are live but should be tuned against Sirus's normal week before
being treated as final.

> **▸ From the code / feasibility:** this is a static Pages app with a Firestore
> backend — **there is no server cron and no background job.** That is fine: the
> timestamp model needs none. Store `catNeeds.lastUpdatedAt`; on render compute
> `display = clamp(stored − rate × hoursSince(lastUpdatedAt), 0, 100)` (read-only,
> no write); on any care action recompute all needs to *now*, apply the refill,
> then write values plus a fresh server timestamp. The existing Firestore
> snapshot flow propagates that shared baseline. The 48 h cap is a clamp on the
> elapsed term.

### 5.4 Real-use calibration

Known behavior from the current app:

- Sirus earns roughly **15–20 points on an active day**.
- Ember reached Hero form during the **first day** of use.
- The 13 default quests each award one point, so observed points and quest
  completions run roughly **1:1**.

Implications:

- The current Hero threshold produces an early-session unlock, not the sustained
  care payoff described in this spec.
- Care is awarded once per completed quest, never multiplied by the quest's
  point value.
- Decay and refill tuning should be tested against a normal week of activity,
  including quieter days, rather than against the highest observed day.
- The existing first-day evolution is preserved. Rebalancing must never devolve
  Ember or require Sirus to re-earn an achievement already granted.

### 5.5 Rest fallback if testing shows busywork

If the live symmetric model feels like a third chore, **Rest could recover on its
own over time** (the cat naps) and be *spent by play* (each play costs some
Rest). Rest then becomes a natural
rhythm limiter — a couple of plays, then the cat wants a nap — rather than a
third chore. This keeps play from being spammable without adding a care burden,
and it leans on the existing sleep/cat-on-bed art.

Trade-off: it makes Rest asymmetric with Hunger/Happiness (one recovers, two
decay), which is slightly harder to explain to Sirus. Keep the implemented
symmetric model unless device use shows Rest feels like busywork. The current
5-Rest play cost already gives back-to-back play a natural "let the cat rest"
beat.

### 5.6 Advanced pet health and medicine — LOCKED LATER DIRECTION

Sirus wants the cats to require real care, including visible consequences for
too little **or too much** food/water, a temporary sick or sad state, and medicine
he can buy and give. Preserve that request as a post-MVP expansion; do not bolt
it onto Hunger alone before Rest and Happiness are proven.

The later design must satisfy all of these boundaries:

- The state is mild, temporary, and completely recoverable. Cats never die, run
  away, become permanently injured, lose Bond, devolve, or lose possessions.
- Cause and repair are readable before consequences occur. The interface must
  show a healthy target or “full” limit instead of surprising Sirus with a hidden
  overfeeding rule.
- The current MVP continues to **block food at full** and preserve the Care
  Charge. It has no Hydration need, so water cannot yet cause or cure illness.
- If balanced feeding/hydration is later added, too-much care should first make
  the cat politely refuse (“I’m full”) before any temporary low-energy/unwell
  consequence is possible.
- Medicine can be a shop item and a hands-on action, but recovery must never be
  paywalled behind a coin balance. Provide a starter/free recovery route if
  medicine is required.
- A return after time away is framed as “let’s help” and celebrates recovery; it
  never says Sirus caused suffering or failed the cat.

This feature needs its own tuning and device test after the core Café goal is
complete. It is not part of the three-needs care release.

## 6. Care Charges and quest mapping

### 6.1 Implemented starting rule — TUNING ACTIVE

- Marking a quest complete grants one immediate Care Charge.
- A Care Charge is tied to the quest completion, **not each point** the quest is
  worth.
- Sirus can spend that charge on Food, Rest, or Play in the Café.
- Parent approval remains the gate for permanent coins, ledger effects, and
  Hero progress.
- If a quest is not approved, already-spent care is not clawed back from the cat.
- Care Charges may be stored up to a small cap so Sirus can choose when to visit
  the Café, but cannot stockpile enough to make needs irrelevant.

Current cap: **6 charges**.

Current refill per charge: **up to +20** to the chosen need.

At roughly 15–20 completions on an active day, Sirus can readily reach the cap,
so the **cap and refill size** are the tuning levers. With 6 × +20, a returning
Sirus can restore about 1.2 full meters per visit. Retune only after observing a
normal week, including quiet days.

> **▸ From the code:** quest completion and parent approval use transactional
> writes in `src/store.js`. The child's completion grants the Care Charge;
> approval applies Brain/Energy/Bond/coins. Firestore rules validate each grant
> and each paired one-charge care spend rather than trusting child-supplied math.

### 6.2 Deferred typed-care alternative

Quest categories could award typed care instead:

- Morning / food-related tasks → Food;
- Night routine → Rest;
- Move / Brain / Tidy-and-Help → Play or flexible care.

This is more thematic but less flexible. The live build uses flexible charges;
typed care should stay deferred unless testing shows a clear reason to add it.

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
| `SLEEP` | Sleep object selected and care is available, or Rest is very low | Layer the cat-only sleep pose over the selected rest object and remain asleep meaningfully | Sirus wakes/moves cat or rest completes |
| `PET_REACTION` | Sirus taps the cat | Pause, react, and acknowledge the touch | After a readable duration |
| `CELEBRATE` | Quest/care milestone | Use celebrate pose and effect | After animation completes |
| `HERO_EVENT` | Evolution milestone | Hero pose overrides normal activity | Event completes |
| `DRAGGED` | Sirus drags the cat | Follow pointer/finger | Drop at valid position, then idle |

> **▸ From the code:** `catState`, one cancelable state timer, and the shared pose
> lookup now coordinate idle, pet, approach, eat, play, sleep, celebrate, and drag
> behavior. Autonomous wandering remains the one deliberately disabled state.

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

> **▸ From the code:** each state transition cancels pending state work before it
> starts the new action, preserving this priority rule.

### 7.2 Minimum readable durations — TUNING ACTIVE

- Tap/pet reaction: 2.5–4 seconds
- Eat: 6–10 seconds
- Play: 6–10 seconds
- Celebration: 3–5 seconds
- Attention request: 8–15 seconds, then return to an appropriate resting state
- Sleep: persists until interrupted or until the rest action resolves; it is not
  a sub-second sprite swap
- Wander: travel time depends on distance; the cat remains at its destination

An action may not be reset by an older timer. The released state controller
cancels pending state work before starting a newer interaction.

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

Two-frame idle, walk, eat, play, and sleep poses are already mapped. Autonomous
wandering remains disabled until its pacing and destination selection pass on
Sirus's device; when enabled, it must keep the cat at the destination rather than
scheduling a return to center.

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
- Tapping an open room location makes the cat walk there, remain there, and save
  that location. Tapping an object still uses the object's specific action.
- The cat remains where it is dropped, clamped to the walkable room area.
- Dragging cancels the cat's current autonomous movement or noncritical action.
- Dropping near a compatible object may suggest an interaction, but must not
  spend a Care Charge without a clear tap/confirmation.
- The cat's last location persists across normal reloads.

> **▸ From the code:** cat drag and blank-room call-to-walk now reuse the room's
> pointer plumbing and persist normalized coordinates through `moveCafeCat`.

### 8.2 Tapping the cat

- A tap produces a readable pet/attention response.
- Tapping is always allowed and never costs care.
- Petting may provide a tiny visual acknowledgment, but cannot refill Happiness
  indefinitely or replace real quests.
- Repeated taps should not restart the animation so rapidly that it flickers.

> **▸ From the code:** petting runs through `PET_REACTION` with haptics, a
> squash-stretch, and finger-positioned sparkles. It does not refill a care meter
> or overwrite a newer higher-priority action.

### 8.3 Tapping objects

| Object type | Play-mode action |
| --- | --- |
| Food bowl | Cat approaches and eats; offers to spend a Care Charge on Hunger |
| Water bowl | Cat approaches and performs a distinct neutral drink bob with the teal bowl still visible; dedicated drink sprites or a Hydration need may come later |
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

> **▸ From the code:** every `CAFE_ITEMS` entry carries a
> `role: 'food' | 'water' | 'rest' | 'play' | 'decor'` and care objects also name
> their need. Water has a neutral action, Toy Basket is play, visible object taps
> take priority through a cat sprite's transparent area, and transparent curled
> cat frames layer over every rest object. Collars and the crown remain décor.

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

> **▸ From the code:** the released Café implements both modes. Play routes taps
> to cat/object actions; Decorate owns furniture drag, storage, placement, and
> one-step Undo.

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

Current Firestore state is intentionally split by ownership and write boundary:

```text
childProfiles/{childId}
  activeCatId
  cafeCat { x, y }
  careCharges

childProfiles/{childId}/cats/{catId}
  brain, energy, bond, evolved
  catNeeds { hunger, rest, happiness, lastUpdatedAt }
  heroCareProgress  # next progression slice; not implemented yet

childProfiles/{childId}/ownedCafeItems/{itemId}
  purchasedAt
  price
  placed
  x
  y
```

Conceptually, those documents form one shared Café state:

```text
selected cat + cat position + per-cat needs/progression + care charges
+ owned room layout
```

Requirements:

- Coordinates are normalized to the room, not saved as device-specific pixels.
- Need decay is derived from `lastUpdatedAt`; it is not written every minute.
- Position writes occur at the end of a drag or placement action, not every
  animation frame.
- Existing users receive safe defaults through migration/fallback logic.
- The app remains usable offline and syncs when connectivity returns.
- Firestore rules explicitly limit child writes to the released Café fields and
  validate care grants, care spends, and purchases atomically. The matching rules
  for Hunger, Rest, and Happiness are deployed.
- Conflicting writes should preserve owned items and the most recent intentional
  room arrangement.

> **▸ From the code — migration:** a cat with no care data receives a healthy 80
> baseline on first use. A Hunger-only cat keeps its Hunger and receives fresh 80
> Rest/Happiness values, so new meters do not retroactively decay. Existing
> `ownedCafeItems` documents and normalized positions require no room-layout
> rewrite.

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

### 11.2 Locked Hero-care gate — NOT YET IMPLEMENTED

At the observed pace of 15–20 points per active day, a points-only threshold
would roughly correspond to:

| Intended active-day target | Observed point range |
| ---: | ---: |
| 7 days | 105–140 points |
| 14 days | 210–280 points |
| 21 days | 315–420 points |
| 30 days | 450–600 points |

These ranges are reference math, not point thresholds. The locked gate uses
distinct active days so Hero form cannot be rushed in one session.

Locked rule:

- Approved quests continue to build the existing long-term progression.
- Brain ≥ 12 and Energy ≥ 12 remain one requirement; Bond is not a gate.
- The cat must also accumulate **14 distinct active care days** in
  `heroCareProgress`.
- A day advances at most once and only while the cat's three daily needs are at
  least in the **Okay** band.
- Low needs pause new Hero-care days; they never subtract earned days or
  long-term stats.
- Restoring care resumes progress immediately.
- Hero progress never decays and the cat never devolves.
- Evolution uses the existing Nova, Ember, and Moss Hero assets and a clear
  celebratory event.
- Existing evolved cats remain evolved; the new gate applies only to future
  evolutions.

Implementation is the next progression slice after Rest and Happiness pass
device testing. It must define an atomic once-per-local-day advance and cannot
trust a client-supplied counter.

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

### 13.1 Cat speech bubbles and family feedback — locked follow-up

The cat should help Sirus understand meaningful family actions without making
him study the ledger:

- When Mom or Abba manually adds positive points, show one exciting synced
  announcement with the adult, amount, and reason—for example, “Mom gave you 1
  point for drying dishes!” The cat may deliver it in a speech bubble with a
  short celebration.
- A rejected completion must never silently disappear. Return the quest to the
  available list and show one gentle message such as, “Mom sent Drying Dishes
  back—check it and try again.” Support a short optional parent reason later.
- Attribute Mom and Abba correctly; do not label every parent event “Mom.”
- Give each event a durable id/read state so refreshing, reconnecting, or opening
  a second device does not replay the same celebration repeatedly.
- Use short deterministic templates. These speech bubbles are **not AI chat** and
  must not imply open-ended understanding the app does not have.
- Messages celebrate noticed behavior and make repair clear. They never shame,
  accuse, or have the cat withdraw affection.

Build the manual-point and returned-quest messages together as one feedback
slice, because they need the same event queue, attribution, bubble, and one-time
delivery behavior. Ordinary care hints can later reuse the bubble component.

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
- if the later health layer ships, label an unwell state as temporary, name the
  available repair action, and celebrate recovery without assigning blame.

## 15. Scope of the Interactive Café MVP

The MVP is complete when all of the following work together:

1. Sirus can enter and exit Play and Decorate modes clearly.
2. He can place, move, store, and restore owned décor.
3. The layout and cat location survive reload and work across supported screen
   sizes.
4. He can drag the cat or tap an open spot to call it, and it remains where moved.
5. The cat idles and wanders without snapping back to center.
6. Tapping the cat creates a readable response.
7. Tapping a food/water bowl, sleep object, or toy makes the cat travel there
   and perform the correct lasting pose; Water and Toy Basket are explicitly
   covered, and sleep presentation is consistent across cats and furniture.
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

> **▸ Status: complete.** The audit, migration-safe care defaults, and matching
> Firestore rules are implemented; the current three-need rules are deployed.

### Slice 1 — the room becomes Sirus's

- Add explicit Play/Decorate modes.
- Add item tray, free placement, storage, bounds, and persistence.
- Add one-step Undo for the current decorating session.
- Make the cat draggable and persist its position.

> **▸ Status: complete for the current room model.** Play/Decorate, the owned-item
> tray, placement/storage, one-step Undo, room bounds, and cat position persistence
> are released.

### Slice 2 — the cat becomes alive

- Replace reset timers with the explicit behavior state machine.
- Add lasting tap response, idle, wander, and attention states.
- Add state-aware welcome-back presentation and the functional need cue.
- Prevent stale timers and center snapping.

> **▸ Status: core released.** The interruption-safe controller, lasting tap and
> object actions, saved cat movement, idle animation, and functional low-need cue
> are present. Autonomous wandering and richer welcome-back choices remain
> pending their own device-tested pacing pass.

### Slice 3 — objects become playable

- Add approach movement and bowl/bed/toy interactions.
- Add drag-the-yarn play and lightweight feedback for decorative object taps.
- Animate meter refills and Care Charge spending so cause and effect are clear.
- Use the existing eat, cat-only sleep, play, and celebrate sprites; keep the
  partial signature-bed composites optional until coverage is consistent.
- Add clear no-charge feedback without guilt.

> **▸ Status: released except drag-the-yarn.** Food, water, rest, play, and décor
> taps have distinct readable actions; care meters and charges resolve visibly;
> full/no-charge/save-failure states are explicit. Ordinary yarn taps refill
> Happiness, but direct yarn dragging and cat-follow behavior remain open.

### Slice 4 — real-life care loop

- Add Needs, timestamp decay, Care Charges, and quest hooks.
- Tune decay/refill values from actual use.
- Connect care to Hero progress.

> **▸ Status: released; device tuning in progress.** Hunger, Rest, and Happiness
> are implemented end-to-end with the locked starting values: a healthy/testable
> 80 start, 100 maximum, 35/25/20-per-day timestamp decay, a 48-hour return cap,
> Care Charges
> capped at 6, and up to +20 per matching food/rest/play object use. Existing
> Hunger-only cats migrate with fresh 80 Rest/Happiness values rather than taking
> retroactive decay. Water remains a free neutral interaction. One lowest-need
> cue highlights a useful placed object (or the stored-item tray) without spending
> care automatically. A paid play refill also uses 5 Rest, making the locked
> play→rest rhythm visible without allowing repeated screen taps to drain it.
> Hunger passed device testing. Rest and Happiness are the current phone-test
> checkpoint. After they pass, `heroCareProgress` is the next separate progression
> slice.

### Slice 5 — animation polish

- Add two-frame idle/walk variants if desired.
- Add cat-specific timing and small visual effects.
- Add the optional sound layer and single room snapshot.
- Improve object-specific reactions without changing core rules.

> **▸ Status:** the two-frame idle, play, eat, walk, and sleep assets and the
> interruption-safe frame-swapper are complete. Cat-specific timing, sounds,
> snapshots, and richer object reactions remain optional polish.

### Slice 5B — family feedback and speech bubbles

- Add one durable, one-time child notification queue.
- Celebrate positive manual point additions with Mom/Abba attribution, amount,
  and reason through the cat.
- Make rejected/returned quests visibly reappear with a gentle explanation and
  optional parent note.
- Reuse the deterministic bubble for later care hints; do not add AI chat.

### Slice 6 — family visits

- Add selectable Mom, Abba, Sirus, and Arlo visitor avatars.
- Add safe room placement and simple visitor idle/reaction behavior.
- Preserve room ownership and spending permissions.
- Treat real-time multiplayer or shared decorating as a separate later choice.

## 17. Non-goals for the first build

- AI chat or open-ended cat dialogue (short deterministic speech bubbles are in scope)
- Remaking existing art at a lower resolution
- Breeding, death, permanent pet harm/loss, or the advanced illness/medicine
  system in the first MVP (the recoverable later direction is §5.6)
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

## 18. Remaining tuning and later decisions

Locked starting calls live in §0.8 and are not repeated here. The actual open
questions are:

1. After a normal week, do the 35/25/20 decay rates and 6 × +20 Care Charge
   balance let needs matter without making care feel constant?
2. Does symmetric Rest feel understandable, or does it feel enough like busywork
   to justify the self-recovery fallback in §5.5?
3. What exact attention-cue wording feels clear to Sirus without becoming
   nagging?
4. Should family visits be freely selected, event-triggered, or both?
5. When family visits are built, may visitors only interact, or can Sirus grant
   selected people permission to help decorate?
6. For the later health model, how long must a need remain urgent before a
   temporary unwell state is possible, and should balanced over-care ever do
   more than a polite refusal? Decide with Sirus only after the three core needs
   are tested.
7. Should point/returned-quest bubbles wait in a small inbox when the tablet was
   closed, or show only for live events? Either way, each event displays once.

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
code-grounded audit of `cat-trainer-v2/` (Aug 2026), reconciled through the live
three-need care release. Historical one-off fixes are intentionally omitted;
current behavior, durable requirements, decisions, and remaining work are kept.
