# Cat Trainer Asset Inventory

The generated artwork was visually inspected, alpha-checked, trimmed, resized, and packed into compressed WebP atlases. The browser build carries those atlases inside the versioned `v4-pack-*.js` files so the artwork remains available offline without relying on missing external image paths.

## Named assets

### People
- `sirus`
- `mom`
- `abba`
- `arlo`
- `wesley`

### Cats and poses
- Nova: base, hero, sit, sleep, play, eat, bed, celebrate
- Ember: base, hero, sit, sleep, play, eat, bed, celebrate
- Moss: base, hero, sit, sleep, play, eat, bed, celebrate

### Café decor
- mint pillow
- blue star bed
- green paw bed
- pink heart bed
- purple food bowl
- teal water bowl
- blue yarn
- pink yarn
- cat tree
- plant
- bookshelf
- toy basket
- pet house
- bunting
- crown
- purple collar
- teal collar

### Interface artwork
- game-time reward symbol
- cat coin
- Morning Routine icon
- Brain Quest icon
- Move Quest icon
- Tidy and Help icon
- Night Routine icon
- golden stars effect
- confetti effect
- sparkle-cloud effect
- paw-print trail effect
- Cat Café room background

## Quality and compatibility checks

- Transparent character, cat, decor, icon, and effect artwork retains alpha transparency.
- The café room is intentionally opaque.
- The existing `catTrainerMvpV1` local-storage key remains unchanged so points, quests, cats, coins, and purchases are preserved.
- The embedded loader remaps every packed atlas reference before the app renders.
- The service worker uses a new cache name and precaches the complete art pack for offline use.
