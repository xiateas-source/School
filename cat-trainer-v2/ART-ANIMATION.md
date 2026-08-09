# Cat Trainer — Café Animation Plan

> Companion to `ART-PROMPTS.md` / `PIXEL-PROMPTS.md` (art generation) and
> `CAFE-GOAL.md` (the café build). This defines **the animation gap, the frames
> to generate, and how the app will wire them** — so the café cat can actually
> eat, play, and walk instead of swapping between single frozen poses.

## 1. The gap (from device testing, Aug 2026)

The café cat is **single static frames** — `sit`, `play`, `eat`, `sleep`,
`celebrate`, `hero`, and a cat-on-bed nap, one 256×256 PNG each. That's why:

- the cat **can't walk** — sliding a static sit-pose across the floor reads as
  gliding, so Slice 2.1 removed autonomous travel;
- interactions can only **swap to a pose and back**, which reads as a flinch, not
  an action (eat, play);
- "life" today is only CSS micro-motion (breathe / wiggle / hop) on the still
  sprite.

To make the cat *do things*, each key action needs **at least a second frame** so
it can loop A↔B and read as motion.

## 2. Approach — individual frame PNGs + a JS frame-swapper

**Decision: keep one 256×256 transparent PNG per frame and cycle `img.src` in
code. Do NOT switch to sprite sheets.** Why:

- It matches the existing pipeline exactly — ChatGPT makes **one image per
  request**, saved to Drive, renamed, committed (`ART-PROMPTS.md` §1). A packed
  sprite sheet with perfectly aligned frames is hard to generate that way.
- It matches the existing code — the café already sets `el('c-cafe-cat').src` to
  a pose. A frame-swapper is a tiny extension, not a rewrite.
- It degrades gracefully — a pose with only frame A still works (just doesn't
  animate), so **frames can land one at a time and light up as they arrive**.

Two frames at ~3 fps (a ~330 ms A↔B toggle) is enough to sell eat/play/walk in
this chunky style. Three frames is a nice-to-have, not required.

## 3. Frames to generate — prioritized manifest

Naming extends the current convention: the existing pose is **frame A**; add a
**`-b`** second frame. Brand-new poses (walk) get `-a` / `-b`. All the usual
rules: 256×256, fully transparent, no shadow/gradient, front 3/4, same cat/style
as the approved reference.

### Tier 1 — makes eat & play actually animate (6 PNGs) ⭐ highest value
The single `eat`/`play` frames already exist; we only need the second frame.

| New file | Second frame of… |
|---|---|
| `nova-eat-b.png` · `ember-eat-b.png` · `moss-eat-b.png` | **Eat** — head **up mid-chew** (frame A is head-down at the bowl) |
| `nova-play-b.png` · `ember-play-b.png` · `moss-play-b.png` | **Play** — paws **down / pounced** (frame A is paws-up batting) |

Loop A↔B → the cat visibly chews and bats. 6 images.

### Tier 2 — the walk cycle (6 PNGs) → unlocks "walk to the bowl"
A brand-new two-frame pose per cat; the app translates the cat horizontally while
cycling the two frames.

| New file | Depiction |
|---|---|
| `nova-walk-a.png` · `ember-walk-a.png` · `moss-walk-a.png` | Standing, **front-left + back-right legs forward** (mid-stride), side-on ¾ |
| `nova-walk-b.png` · `ember-walk-b.png` · `moss-walk-b.png` | The **opposite stride** (other legs forward) |

Cycling a↔b while moving `left` reads as walking. 6 images. Enables the Slice 3
`APPROACH_OBJECT` state to be a real walk instead of a hop.

### Tier 3 — polish (6 PNGs, optional)
| New file | Depiction |
|---|---|
| `nova-blink.png` · `ember-blink.png` · `moss-blink.png` | Idle **eyes-closed** blink (frame B for the resting sit) |
| `nova-sleep-b.png` · `ember-sleep-b.png` · `moss-sleep-b.png` | Curled asleep, **breath out** (bigger “z”, slightly puffed) — a 2-frame nap for Slice 4 |

### Totals
- **Tier 1: 6 PNGs** — do these first; biggest life-per-frame.
- Tier 2: 6 PNGs — do when Slice 3 needs walking.
- Tier 3: 6 PNGs — nice-to-have.
- Full set = **18 new PNGs**.

## 4. Ready-to-paste generation prompts

Run per cat, **attaching that cat's approved reference image** so the character
stays identical (same flow as `PIXEL-PROMPTS.md`). Repeat for Ember and Moss,
swapping the name/identity and filenames.

**Tier 1 — Nova eat + play second frames** *(attach approved `nova-sit.png`)*:
```
Same cat and style as the attached image (Nova, the black Curious Moon Cat).
Give me EACH as its own SEPARATE transparent 256x256 PNG — chunky retro 16-bit
pixel art, base 64x64 at 4x nearest-neighbor, ~16-color palette, dark-brown 1px
outline, flat cel shading, front 3/4 view, fully TRANSPARENT background, no
shadow, no gradient. These are the SECOND FRAME of a 2-frame loop, so keep the
pose, size, and position nearly identical to the existing frame with only the
described change. Save to Google Drive "Cat Trainer Artwork/pixel-v1":
- nova-eat-b.png  (head UP mid-chew; the existing nova-eat.png is head-down at
  the bowl — same body/position, just the head raised a little, cheeks full)
- nova-play-b.png (paws DOWN / just-pounced; the existing nova-play.png is
  paws-up batting — same spot, mid-bounce landed)
```

**Tier 2 — Nova walk cycle** *(attach approved `nova-sit.png`)*:
```
Same cat and style as the attached image (Nova). Two SEPARATE transparent
256x256 PNGs, a 2-frame WALK cycle, side-facing 3/4, centered, same rules
(transparent, no shadow/gradient, chunky pixel, ~16 colors). Save to Google
Drive "Cat Trainer Artwork/pixel-v1":
- nova-walk-a.png (walking, front-left and back-right legs forward, mid-stride,
  tail up, looking ahead)
- nova-walk-b.png (the opposite stride — front-right and back-left legs forward)
Keep the body size and vertical placement identical between the two so they
don't jump when swapped.
```

**Tier 3 — Nova blink + sleep-b** *(attach approved `nova-sit.png` / `nova-sleep.png`)*:
```
Same cat and style. Two SEPARATE transparent 256x256 PNGs, same rules. Save to
Drive "Cat Trainer Artwork/pixel-v1":
- nova-blink.png   (identical to nova-sit.png but eyes closed — a blink frame)
- nova-sleep-b.png (identical to nova-sleep.png but a breath-out: chest slightly
  puffed, a bigger "z")
```

## 5. How the app will wire it

Small, additive changes when frames land — nothing here breaks the current
single-frame behavior.

**a. Poses become frame lists (`src/data/cats.js`).** Add an optional `frames`
map alongside `poses`, e.g.

```js
nova: {
  …,
  poses:  { sit:'assets/nova-sit.png', play:'assets/nova-play.png', eat:'assets/nova-eat.png', … },
  frames: {                       // 2-frame loops; omit a key to stay single-frame
    eat:  ['assets/nova-eat.png',  'assets/nova-eat-b.png'],
    play: ['assets/nova-play.png', 'assets/nova-play-b.png'],
    walk: ['assets/nova-walk-a.png','assets/nova-walk-b.png'],
    idle: ['assets/nova-sit.png',  'assets/nova-blink.png'],
    sleep:['assets/nova-sleep.png','assets/nova-sleep-b.png']
  }
}
```

**b. A tiny frame-swapper (`src/app.js`).** One animator, owned by the behavior
state machine (Slice 2), so it stops cleanly on any transition:

```js
let catAnimTimer = null;
function playSprite(poseKey, { fps = 3, holdMs } = {}) {
  const { def, catEl } = catCtx();
  clearInterval(catAnimTimer);
  const frames = def.frames && def.frames[poseKey];
  if (!frames || frames.length < 2 || prefersReducedMotion()) {   // graceful fallback
    catEl.src = cafePoseArt(def, poseKey);                        // single frame, as today
    return;
  }
  let i = 0; catEl.src = frames[0];
  catAnimTimer = setInterval(() => { i = (i + 1) % frames.length; catEl.src = frames[i]; }, 1000 / fps);
  if (holdMs) setTimeout(() => clearInterval(catAnimTimer), holdMs);
}
```

- Every state transition already calls `catTransient(...)`; add `clearInterval(catAnimTimer)` to `settleCatToRest()` so a loop never outlives its state.
- **Reduced-motion**: `playSprite` falls back to the single frame — no cycling.
- **Preload** the `-b` frames on café entry so the first swap doesn't flash.

**c. Behavior states use it (Slice 3).**
- `EAT` → `playSprite('eat', { holdMs: 6000 })` then settle (finally renders the
  animated eat — the pose that's been dead code).
- `PLAY` → `playSprite('play', { holdMs: 6000 })`.
- `APPROACH_OBJECT` (Tier 2) → translate the cat's `left` toward the object while
  `playSprite('walk')`, stop the walk on arrival, then enter EAT/PLAY.
- Idle beat (optional, Tier 3) → occasional `idle` blink loop for a beat.

## 6. Suggested order

1. **Generate Tier 1 (6 PNGs)** → wire the frame-swapper + `frames` map → eat &
   play animate. This is the cheapest, most visible win and can ship before the
   rest of Slice 3.
2. **Generate Tier 2 (6 PNGs)** → wire `APPROACH_OBJECT` walk → the cat walks to
   the bowl/toy. Do this with Slice 3's object interactions.
3. **Tier 3** whenever — blink/idle life and the 2-frame nap (pairs with the
   Slice 4 Rest need).

Integrity rules on delivery are unchanged from `ART-PROMPTS.md`: transparent,
not corrupt, 256×256, exact filenames, committed after a cache-bust stamp.
