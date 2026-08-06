# Cat Trainer Rebuild — Project Handoff

## First instruction: do not start coding yet

Before changing any files:

1. Thoroughly inspect the current Cat Trainer app and repository.
2. Identify the existing behavior, data model, point rules, quest rules, cat progression, Bond rules, café purchases, and parent controls.
3. Review the available image assets.
4. Propose a clean rebuild architecture and screen flow.
5. Explain what should be preserved, replaced, migrated, or discarded.
6. Wait for approval of the rebuild plan before implementing it.

This is intended to be a **clean rebuild**, not another layer of patches on the current app.

---

# Repository and deployment

## GitHub repository

```text
xiateas-source/School
```

## Current app folder

```text
cat-trainer/
```

## Current GitHub Pages source branch

```text
claude/github-upload-sharing-e67k75
```

## Current live app

```text
https://xiateas-source.github.io/School/cat-trainer/
```

## Recent relevant commits

```text
edd7d593f0d99dadbb593e49a33e00a3079fd810
Install clean transparent Cat Trainer PNG artwork

b9e3392033ff8f0f02c8fc70ca7bce714d6648b0
Correct Cat Trainer PNG package documentation
```

Inspect the current branch rather than assuming these are still HEAD.

## Existing storage key

```text
catTrainerMvpV1
```

The legacy app stores data in browser local storage. That is no longer sufficient because Mom’s phone and Sirus’s tablet must share live data.

## Current legacy structure

Relevant files include:

```text
cat-trainer/index.html
cat-trainer/styles.css
cat-trainer/image-fix.css
cat-trainer/assets.css
cat-trainer/app.js
cat-trainer/app-core.js
cat-trainer/app-ui.js
cat-trainer/asset-overrides.js
cat-trainer/service-worker.js
cat-trainer/manifest.webmanifest
cat-trainer/assets/
```

Historical embedded-art files also exist:

```text
sprite-1.js through sprite-5.js
family-1.js through family-4.js
v4-loader.js
v4-pack-*.js
```

Do not carry the embedded image-pack architecture into the rebuild. Use normal image files. Treat the existing app as a behavioral reference and possible migration source, not as the foundation for the new codebase.

---

# Project purpose

Cat Trainer is a synchronized family screen-time point system presented as a cozy cat-training game.

The app does **not** create a new behavior or reward system. It turns Sirus’s existing point system into a more engaging visual experience.

```text
1 point = 1 minute of screen time
```

This means all permitted screen time, not only Nintendo Switch time.

Mom must be able to add or subtract points from her phone. The new balance must appear on Sirus’s tablet.

---

# Core reward systems

There are four distinct progress types.

## Points

```text
1 point = 1 minute of available screen time
```

Points can be added or subtracted and are redeemed when Sirus uses screen time. Points must remain separate from cat-game rewards.

## Brain

Brain trains the currently active cat and is never spent.

## Energy

Energy trains the currently active cat and is never spent.

## Cat Coins

Cat Coins are spent on Café furniture, decorations, cosmetic items, hats, and collars where supported. Cat Coins must never be exchanged for screen time.

## Design principle

Sirus must never have to choose between using screen-time points and progressing in the cat game.

A task may award multiple rewards simultaneously:

```text
Brush Teeth
+1 screen-time point
+1 Energy
+1 Cat Coin
```

Brain, Energy, Bond, and Coins are separate game progress.

---

# Mom’s point dashboard

Mom needs a fast mobile dashboard that works comfortably with one hand.

The current quick actions are:

```text
+1  Good choice
+1  “Yes, ma’am/sir”
−2  Rebuttal after a direction
−2  Refused deep breaths
−2  Used his body instead of words
+1  Completed a Hero’s Reset
```

Mom must also be able to enter any positive or negative amount with a custom reason. Date and time should be recorded automatically, with an optional note.

Required functions:

- Add points
- Subtract points
- Enter a custom adjustment
- See the current available screen-time balance
- See points earned today
- See points lost today
- Redeem or record used screen time
- Undo an accidental action
- Review a chronological point ledger
- See which device or user made an entry
- Manage quests
- Select the active cat
- Review cat progress
- Manage Café rewards and settings

The most common actions should take as few taps as possible.

## Ledger rather than silent balance edits

Every change should create a transaction record.

```text
+1  Good choice
−2  Rebuttal after a direction
+1  Morning quest
−15 Screen time used
+2  Manual correction
```

Undo should preferably create a compensating transaction rather than silently deleting history.

---

# Sirus’s tablet experience

The tablet is the child-facing game experience.

It should clearly show:

```text
Screen Time Available: 24 minutes
```

It should distinguish:

```text
Earned Today: 10 points
Available Balance: 24 minutes
```

Those values may differ because minutes may carry over or be redeemed.

The tablet should update when Mom changes points from her phone and must not expose unrestricted point-editing controls.

## Child permissions

The child interface may:

- View the current point balance
- View today’s activity
- Complete available daily quests
- Select a cat if Mom permits it
- View cat progress and Hero Forms
- Enter and decorate the Café
- Spend Cat Coins on approved Café items

The child interface may not:

- Enter arbitrary point adjustments
- Change reward values
- Edit the ledger
- Change parent settings
- Bypass once-per-day quest restrictions
- Redeem screen time without the intended parent flow

Use role-based authorization, not merely hidden buttons.

---

# Cross-device synchronization

This is a core requirement, not an optional enhancement.

The rebuild needs a shared backend with realtime updates.

Required behavior:

1. Mom adds or subtracts points on her phone.
2. The backend records the transaction.
3. The available balance is recalculated safely.
4. Sirus’s tablet receives the update.
5. The visible balance changes without a manual refresh.

Prevent duplicate writes and inconsistent balances.

## Suggested account model

```text
Family
├── Parent account
├── Child profile: Sirus
├── Parent phone session
└── Child tablet session
```

Possible onboarding:

- Mom signs in with email or magic link.
- Mom creates or opens the family space.
- The tablet is paired using a short code or QR code.
- The tablet remains signed into a limited child role.
- The child does not need an email account.

Claude may propose Firebase, Supabase, or another suitable backend. Explain realtime synchronization, authentication, authorization, security rules, offline behavior, hosting, cost, maintenance, and how GitHub Pages communicates with it.

Do not rebuild this as another localStorage-only application.

---

# Daily quests

Daily quests can award four separate values:

```text
points
brain
energy
coins
```

Most existing built-in quests currently give approximately +1 point/minute plus their other configured rewards.

Each quest can only be completed once per local calendar day. Use:

```text
America/Chicago
```

## Quest completion requirements

Completing a quest should be one atomic operation:

1. Confirm it has not already been completed for that date.
2. Add the configured point reward.
3. Add Brain to the active cat.
4. Add Energy to the active cat.
5. Add Cat Coins.
6. Apply any applicable Bond reward.
7. Record the completion in the ledger.
8. Mark the quest completed for the day.
9. Update Mom’s phone and Sirus’s tablet.

Prevent double completion caused by repeated tapping, lag, refreshing, or two devices acting at once.

Mom should be able to create, edit, enable, disable, categorize, reward, reset, and reorder quests. Likely categories include Morning, Brain, Movement, Helping, Evening/Night, and Custom.

Preserve current quest wording and values where possible by inspecting the legacy app.

---

# Cats

The current cats are:

```text
Nova
Ember
Moss
```

One cat is active at a time. Brain, Energy, and Bond earned from relevant actions go to the active cat. Each cat stores independent progress. Changing the active cat must not merge, reset, or transfer progress.

---

# Hero Forms

A cat unlocks its Hero Form when:

```text
Brain >= 12
Energy >= 12
```

Brain and Energy are cumulative and are not spent at unlock.

The UI should show progress such as:

```text
Brain: 9 / 12
Energy: 12 / 12
Needs 3 more Brain
```

Use the dedicated Hero Form image:

```text
nova-hero.png
ember-hero.png
moss-hero.png
```

Do not stretch or recolor the ordinary cat image to imitate a Hero Form.

---

# Bond

Positive point changes also build the active cat’s Bond.

Known rules:

```text
Most positive choices: +1 Bond
“Yes, ma’am/sir”: +2 Bond
```

The exact Hero’s Reset Bond value was cut off in the product description. Do not invent it. Inspect the current app and preserve its exact behavior. If the code does not establish it clearly, flag it for confirmation.

Negative point changes should not automatically remove Brain, Energy, Coins, Hero Form progress, or Bond unless the existing system explicitly does so.

---

# Screen-time redemption

Points represent available screen-time minutes.

Mom needs a clear way to record used screen time:

```text
Available: 24 minutes
Use: 15 minutes
Remaining: 9 minutes
```

Redemption should create a ledger transaction:

```text
−15 Screen time used
```

Mom should be able to redeem all minutes, redeem a custom amount, correct an accidental redemption, see the remaining balance immediately, and see the tablet update.

Use the term **screen time**, not Switch time.

---

# Open rules to inspect before implementation

Do not guess these rules. Inspect the existing app first:

- Can the point balance go below zero?
- Do unused points carry over indefinitely?
- Is there a daily screen-time cap?
- Are quest rewards immediately available or parent-approved?
- Does completing a quest build Bond?
- What exact Bond value does Hero’s Reset award?
- Can Sirus change the active cat himself?
- Who is allowed to complete or approve quests?
- Is screen time recorded manually, timed in-app, or both?

Present observed behavior and unresolved decisions during brainstorming.

---

# Emotional and parenting design

The app should support accountability without shame.

Negative adjustments should:

- Change the point balance
- Appear neutrally in history
- Avoid humiliating animations
- Avoid making the cat appear frightened, disappointed, abandoned, or angry
- Avoid implying that losing points damages the cat relationship

Hero’s Reset is restorative:

```text
Heroes make mistakes, make things right, and keep going.
```

The app should visually reinforce returning, repairing, and continuing—not perfection. The cats should not become emotional leverage.

---

# Café and Cat Coins

Cat Coins are the only currency used for Café purchases.

The Café should be a visual room decorated with transparent PNG assets. Possible items include beds, bowls, yarn, cat tree, bookshelf, toy basket, plant, and moon collar.

Existing ownership should be migrated if practical. Prior stable décor IDs include:

```text
rug
bed
plant
tower
```

Inspect the current app before changing IDs so purchases can be migrated.

---

# Image assets

## Source of truth

The highest-quality generated images are in the user’s Google Drive. The repository contains optimized copies at:

```text
cat-trainer/assets/
```

Use Drive originals as the visual source of truth. Inspect repository copies before deciding whether their resolution is sufficient. Do not repeatedly recompress without visual comparison.

## Repository image paths

### Family

```text
cat-trainer/assets/sirus.png
cat-trainer/assets/mom.png
cat-trainer/assets/abba.png
cat-trainer/assets/arlo.png
cat-trainer/assets/wesley.png
```

### Cats

```text
cat-trainer/assets/nova.png
cat-trainer/assets/ember.png
cat-trainer/assets/moss.png
```

### Hero Forms

```text
cat-trainer/assets/nova-hero.png
cat-trainer/assets/ember-hero.png
cat-trainer/assets/moss-hero.png
```

### Café

```text
cat-trainer/assets/cafe-room.png
cat-trainer/assets/bed-blue-stars.png
cat-trainer/assets/bed-pink-hearts.png
cat-trainer/assets/food-bowl-purple.png
cat-trainer/assets/water-bowl-teal.png
cat-trainer/assets/yarn-blue.png
cat-trainer/assets/yarn-pink.png
cat-trainer/assets/cat-tree.png
cat-trainer/assets/bookshelf.png
cat-trainer/assets/toy-basket.png
cat-trainer/assets/plant.png
cat-trainer/assets/collar-moon.png
```

### Quest icons

```text
cat-trainer/assets/morning-icon.png
cat-trainer/assets/brain-icon.png
cat-trainer/assets/move-icon.png
```

## Google Drive file IDs

### Family

```text
sirus.png — 1LKFjkcoNGjlRW_B3YhXIL1s9iBdpVtYh
mom.png — 1FQiKHrGoiG6R2RL9BVdAy2ZHlnOVSSJf
abba.png — 1P_JOYS0ueve7rDv1FN6HxmvGvc51mZO1
arlo.png — 1YsisM2--qsqwtnuK3YeM5eitopSWe99W
wesley.png — 1i2alZsJw1L3wy4d0vzHhvjVRlvZ9W3u-
```

### Cats

```text
nova.png — 1y3iUjbNUt0St4R3aAzRXnrF7UYM3dwgQ
ember.png — 1bs4_ezkF6FXcIrnIuN7BBa5j0Y5EMHhF
moss.png — 1llL7Sxmf_NB9ouJw3Zwj_vewh92Tc0Bt
```

### Hero Forms

```text
nova-hero.png — 1XEb5eHtzExWN4cNrxwEHCiwBTtDhd5O_
ember-hero.png — 1E9QCP0m2Q7b_ivs52a41i6ddee21qeWA
moss-hero.png — 1fzoPA6X182hYR1W8ZKtVD6ut7JiSYMZT
```

### Café

```text
cafe-room.png — 199cRgLIk6OqBaqGf93CXFDo8gdqZ-BL4
bed-blue-stars.png — 1J8kbtIv-sUzbxJcDiFWenmj4fQDggBcQ
bed-pink-hearts.png — 1nOzrSn_of7K9geVUprMF1hcfYmc7g6xl
food-bowl-purple.png — 14Q07Sl4XvLlhFmYWAQYGo0d2i0z8oJV0
water-bowl-teal.png — 1h7b4pLyGkTt1irUSTkf4wzL32OQVbL7T
yarn-blue.png — 1s6QJYLaZ173jYzavcfr2_i_Gi30cymT0
yarn-pink.png — 1dX-HNP1HhqbSErZvHfdZfP_osVqz9R3Z
cat-tree.png — 1_UP-BIUuZRxH5ul_muVG_8nTCETRcJwa
bookshelf.png — 13P9vVWX9E0EkGUwST2EglS2dufn7KN0P
toy-basket.png — 1mVyrCCmMWuBSST4roEOMKcSW6VhYN5ca
plant.png — 1jZtKrVCcxdVDC3YqL7-fnhdNqJrWv6E8
collar-moon.png — 1hh3dSXG3-BN3_Bmbl6sjCaPxQ1K-Y2Df
```

### Icons

```text
morning-icon.png — 1k01SEtDjniSe2hYjcMq4jHwC8wioB2Xu
brain-icon.png — 1HOCqBujxMOqf8ce-Y7vTkc4nHCsz1csC
move-icon.png — 1tHFfMpP5PWHCEt7_ASfkDbI6Um51PWxb
```

## Session-local paths

Previous GPT processing used:

```text
/mnt/data/cat_assets/
/mnt/data/cat_assets_small/
```

These are temporary session paths and may not exist in Claude’s environment. Durable locations are Google Drive and `xiateas-source/School/cat-trainer/assets/`.

All character, cat, decoration, and icon images should have transparent backgrounds. `cafe-room.png` is intentionally opaque.

---

# Clean code direction

Claude should evaluate the architecture rather than blindly follow it, but the rebuild should use a comprehensible structure such as:

```text
cat-trainer-v2/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── src/
│   ├── app.js
│   ├── auth.js
│   ├── sync.js
│   ├── store.js
│   ├── routes.js
│   ├── data/
│   ├── parent/
│   ├── child/
│   └── shared/
├── styles/
└── assets/
```

Avoid:

- Base64 image data hidden inside JavaScript
- Large generated one-file applications
- Multiple overlapping patch files
- Duplicate reward logic
- Client-side-only authorization
- Updating balances without a transaction record
- Depending on CSS to repair badly prepared artwork

---

# Suggested data model

Claude should propose and refine a secure model. Likely entities:

```text
families
users
family_members
child_profiles
devices
cats
child_cat_progress
quests
quest_completions
point_transactions
coin_transactions
cafe_items
owned_cafe_items
settings
```

A point transaction should record child, amount, reason code, label, source, creator, server timestamp, and local date.

A quest completion should record child, quest, local date, active cat, and the exact rewards applied.

Do not trust reward amounts supplied by the child device. Backend or secured server-side logic should derive them from stored quest definitions.

---

# Visual direction

The child experience should feel like a polished children’s cat-training game, not an administrative dashboard with cat pictures attached.

Use warm cream or pale storybook backgrounds, rounded controls, large readable text, large custom artwork, a clear screen-time balance, clear quest cards, gentle celebrations, and the Café room as a real visual scene.

Avoid dark dashboards, tiny text, dense statistics, excess currencies, shame-based animations, cluttered shop grids, and generic icons when custom art exists.

The parent dashboard should prioritize speed, clarity, undoability, current balance, quick controls, recent history, and reliable synchronization.

---

# Rebuild strategy

Do not immediately overwrite the functioning legacy app.

Preferred safe options:

```text
cat-trainer-v2/
```

or a dedicated branch such as:

```text
claude/cat-trainer-rebuild
```

Preserve the current live version until the rebuild is usable. Document the old localStorage schema, plan migration of points/cats/coins/purchases/progress, provide rollback instructions, use a new service-worker cache name, remove obsolete caches, and verify the old app cannot remain stuck in cache after deployment.

---

# Required brainstorm deliverable

Before coding, return a structured proposal containing:

1. Plain-language summary of the current app
2. All current behaviors found in code
3. Differences between this handoff and current implementation
4. Recommended backend and why
5. Parent/child authentication and pairing flow
6. Proposed database schema
7. Transaction and synchronization model
8. Screen map for Mom’s phone
9. Screen map for Sirus’s tablet
10. Quest completion flow
11. Point adjustment and redemption flow
12. Brain, Energy, Bond, and Hero Form logic
13. Café and Coin flow
14. Offline and reconnection behavior
15. Migration plan from `catTrainerMvpV1`
16. Deployment and rollback plan
17. Accessibility and child-safety considerations
18. Phased implementation plan
19. Risks, unresolved questions, and assumptions
20. Recommendation for what to build first

Do not begin implementation until the proposal is reviewed.

---

# Minimum acceptance criteria

The rebuild is not complete unless:

- Mom’s quick point changes save and appear on Sirus’s tablet.
- Positive actions apply the correct Bond reward.
- Negative actions reduce screen-time minutes without improperly removing cat progress.
- Custom positive and negative adjustments work and can be corrected.
- Daily quests apply points, Brain, Energy, Coins, and Bond exactly once.
- Duplicate completion attempts are rejected.
- A cat with at least 12 Brain and 12 Energy unlocks its dedicated Hero Form without spending those stats.
- Screen-time redemption creates a ledger transaction and updates the tablet.
- Cat Coins, never screen-time points, purchase Café items.
- Purchases persist across refreshes and devices.
- The child device cannot submit arbitrary points or edit parent settings.
- One family cannot read another family’s data.
- Duplicate requests do not create duplicate rewards.
- Closing, reopening, reinstalling, or clearing one device does not erase the shared family account.
- Temporary internet loss does not silently lose actions.

---

# Final product statement

> Cat Trainer is a synchronized family screen-time point system in which one point equals one minute of screen time. Mom manages points from her phone, Sirus sees the balance on his tablet, and real-life choices and daily quests train Nova, Ember, or Moss through Brain, Energy, Bond, Hero Forms, Cat Coins, and a customizable Cat Café.

The cats and Café make the existing system enjoyable. They do not replace the existing point system, introduce competing rewards, or turn accountability into shame.
