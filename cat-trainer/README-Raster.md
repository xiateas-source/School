# Clean PNG artwork — v46

Cat Trainer uses individual transparent PNG files in `assets/` for family portraits, cats, hero forms, café decorations, and the available quest icons. The café room is the only intentionally opaque image.

The images were resized and compressed for the mobile interface while preserving their alpha transparency. The complete installed PNG set is 99,289 bytes, so it remains practical for phone loading and offline caching.

`asset-overrides.js` replaces the old sprite-sheet renderer without changing the `catTrainerMvpV1` storage key. Existing progress and the four original décor ownership IDs remain compatible.
