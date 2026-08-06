# Clean PNG artwork — v46

Cat Trainer now uses the individual transparent PNG files in `assets/` for family portraits, cats, hero forms, café decorations, and the available quest icons. The café room is the only intentionally opaque image.

The PNGs were resized losslessly for the mobile interface while preserving alpha transparency. The original Drive files total about 42.5 MB; the installed mobile set is about 7.5 MB.

`asset-overrides.js` replaces the old sprite-sheet renderer without changing the `catTrainerMvpV1` storage key. Existing progress and the four original décor ownership IDs remain compatible.
