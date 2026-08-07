# Cat Trainer v2

A synchronized family screen-time point system, wrapped in a cozy cat-training
game. **1 point = 1 minute of screen time.** Mom manages points from her phone;
Sirus sees his balance live on his tablet and trains his cats (Nova, Ember, Moss)
through Brain, Energy, Bond, Hero Forms, Cat Coins, and a customizable Cat Café.

**Live:** https://xiateas-source.github.io/School/cat-trainer-v2/

## Tech at a glance
- Static site on **GitHub Pages** (no build step) — plain ES modules + Firebase CDN.
- **Firebase** backend: Firestore (realtime sync) + Auth (parent email/password,
  anonymous child device paired by a 6-digit code).
- Reward/point logic is transaction-safe; the ledger records every change; security
  is enforced by Firestore rules (parent vs. child roles, family isolation).

## Two roles
- **Mom (phone):** dashboard with quick point buttons, custom adjustments, undo,
  per-entry delete, screen-time redemption, quests, cats, café, and device pairing.
- **Sirus (tablet):** home with his cat + screen-time balance, daily quests, cats,
  café, and a **read-only point log**. He can't edit points or settings.

## Working on it?
Read **[HANDOFF.md](./HANDOFF.md)** — it has the architecture, data model, security
rules, decisions, deploy steps, known issues, and the feature backlog. Setup steps
for the Firebase console are in **[FIREBASE-SETUP.md](./FIREBASE-SETUP.md)**.

Deploy: edit under `cat-trainer-v2/` on the dev branch → PR into the Pages branch →
merge. If `firestore.rules` changed, re-publish it in the Firebase console.
