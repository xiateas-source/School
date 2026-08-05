# Cat Trainer MVP

A mobile-first, local-only collectible-cat game powered by Sirus's real-life point system.

## Family cast

Use these exact roles and names in future story/support-character art:

- **Mom** — parent and primary grown-up controller
- **Abba** — Mom's partner
- **Sirus** — Cat Trainer and child player
- **Arlo** — Sirus's younger brother
- **Wesley** — family dog

Do not rename Mom to Lor in the app. Do not invent replacement family appearances. Integrate the previously approved family character designs when their exact visual references are available.

## Current gameplay loop

1. Sirus completes a real-life quest or Mom awards/deducts points.
2. One point equals one minute of game time.
3. Positive quests also build Brain, Energy, Bond, and Cat Coins.
4. Cats evolve when Brain and Energy both reach 12.
5. Cat Coins buy decorations for the Cat Café.
6. A new day resets points, completions, and history while preserving cats, coins, quests, and café items.

## Parent controls

The default parent PIN is `2468`. Change it in the parent dashboard.

Quick controls include:

- +1 Good choice
- +1 Yes, ma'am/sir
- -2 Rebuttal
- -2 Refused breaths
- -2 Used body instead of words
- +1 Hero's Reset
- Custom adjustment
- Undo last action

## Privacy

All data is stored in the browser's local storage. No analytics, accounts, remote database, or child-data upload is included. The parent dashboard can export a JSON backup.

## Development

This app lives in `/cat-trainer/` and is isolated from the assessment site. The feature branch is `feature/cat-trainer-mvp`.
