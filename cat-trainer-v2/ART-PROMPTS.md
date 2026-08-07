# Cat Trainer — Pixel-Art Prompts & Asset Manifest

Style guide + exact filename checklist for redoing the app art as **chunky
retro pixel sprites**. Two audiences: **ChatGPT** (generate against this) and
**whoever wires it in** (the app loads these *exact* filenames — see §5).

---

## 1. How to run it with ChatGPT

ChatGPT makes **one image per request** — this file is a menu, not a batch
order. Paste this kickoff once, then work through the manifest one asset at a time:

> "Here's the full art style guide and asset list for my app. We'll generate
> these **one at a time** — don't make anything yet. Confirm you have the style
> rules, then we'll start with **Nova, the black moon cat**, sitting."

Rules that keep 60+ assets looking like one set:
- **Reference-first.** Nail Nova/Ember/Moss as single sitting cats first, then
  attach that image on every later request ("same style and character").
- **One subject per image**, centered, generous margin.
- **Transparent background (alpha)** — never a cream fill. On the café room a
  cream square will show.
- **Deliver to Google Drive** → the **"Cat Trainer Artwork"** folder, ideally a
  `pixel-v1/` subfolder so the new set stays separate from the 74 originals.
  Then say the word and the art gets pulled from Drive, integrity-checked
  (transparent + not corrupt), renamed to §5, and committed.

## 2. Master style block — paste at the top of EVERY request

```
Cozy storybook pixel art, chunky retro 16-bit sprite. Base size 64x64, exported
at 4x (256x256) with nearest-neighbor (no blur). Large visible pixels, crisp
hard edges, NO anti-aliasing, NO gradients, limited ~16-color palette.
Warm palette to match a cream #fffaf2 UI: cream, muted teal, warm orange, dusty
pink, sage green; dark-brown 1px outline; flat cel shading with one soft
highlight. Front 3/4 view, one subject centered with margin, fully TRANSPARENT
background (alpha), no text, no watermark, no drop shadow, no ground line.
```

## 3. Locked cat identities (from the approved style test)

| Cat | Identity | Look |
|---|---|---|
| **Nova** | Curious Moon Cat | **Black** cat, big warm eyes, a gold **crescent-moon** charm; curious. |
| **Ember** | Brave Orange Cat | **Orange tabby**, bold happy grin, **teal collar + heart** charm; brave. |
| **Moss** | Steady Calico Cat | **Calico** (white / orange / charcoal), gentle calm eyes; steady. |

Hero forms = same cat, clearly "leveled up": aura of sparkles, small cape/regal
touch. **Ember Hero = the golden-lightning version** (the old ember-hero was too
plain — make it dramatic).

## 4. Scope note (decide before reskinning the UI)

Pixel-art the **game surfaces** (Sirus's cat / café / play screens). Keep
**Mom's dashboard, forms, and the ledger clean and legible** — a full pixel-font
UI hurts readability and the accessibility work on the parent data-entry side.
Reskin the chrome only as a deliberate, separate decision.

## 5. Asset manifest — the exact filenames the app loads

All under `cat-trainer-v2/assets/`. Transparent PNG unless noted.

### Cats — primary portrait + café poses (18)
`nova.png` is the main idle portrait; `-sit` is the café resting pose (can match).

| Filename | Depiction |
|---|---|
| `nova.png` / `nova-sit.png` | Nova sitting, calm/idle |
| `nova-play.png` | Nova pouncing / batting a toy, paws up |
| `nova-eat.png` | Nova head-down at a food bowl |
| `nova-sleep.png` | Nova curled asleep, eyes closed, tiny "z z" |
| `nova-celebrate.png` | Nova hopping, front paws raised, joyful |
| `ember.png` / `ember-sit.png` | Ember sitting |
| `ember-play.png` / `ember-eat.png` / `ember-sleep.png` / `ember-celebrate.png` | same poses, Ember |
| `moss.png` / `moss-sit.png` | Moss sitting |
| `moss-play.png` / `moss-eat.png` / `moss-sleep.png` / `moss-celebrate.png` | same poses, Moss |

### Hero forms (3)
| Filename | Depiction |
|---|---|
| `nova-hero.png` | Nova evolved — moon-magic aura, regal |
| `ember-hero.png` | Ember evolved — **golden-lightning** aura, cape, dramatic |
| `moss-hero.png` | Moss evolved — cozy guardian aura |

### Cat-on-bed nap poses (3) — cat curled asleep ON its signature bed
| Filename | Depiction |
|---|---|
| `nova-blue-star-bed.png` | Nova asleep on a blue bed with a star |
| `ember-green-paw-bed.png` | Ember asleep on a green bed with a paw print |
| `moss-pink-heart-bed.png` | Moss asleep on a pink bed with a heart |

### Café items (17) — single cozy object, centered, transparent
| Filename | Item |
|---|---|
| `yarn-blue.png` | Blue ball of yarn |
| `yarn-pink.png` | Pink ball of yarn |
| `bed-blue-stars.png` | Blue pet bed with stars |
| `bed-pink-hearts.png` | Pink pet bed with hearts |
| `bed-green-paws.png` | Green pet bed with paw prints |
| `pet-pillow-mint.png` | Mint round pet pillow |
| `pet-house-green.png` | Small green cat house |
| `plant.png` | Potted plant with a paw-print pot |
| `cat-tree.png` | Cat tree / tower |
| `bookshelf.png` | Small bookshelf |
| `toy-basket.png` | Basket of cat toys |
| `food-bowl-purple.png` | Purple food bowl (with kibble) |
| `water-bowl-teal.png` | Teal water bowl |
| `collar-moon.png` | Collar with a gold crescent-moon charm (Nova's) |
| `collar-teal-heart.png` | Teal collar with a heart charm (Ember's) |
| `crown-gold-heart.png` | Small gold crown with a heart |
| `bunting-pastel.png` | String of pastel party bunting flags |

### Effects (4) — small, simple, transparent, no outline
| Filename | Depiction |
|---|---|
| `fx-sparkle.png` | Tiny 4-point star sparkles |
| `fx-starburst.png` | Bright starburst flash |
| `fx-confetti.png` | Scattered confetti pieces (warm palette) |
| `fx-paw.png` | Single small paw print |

### Currency, section & reward icons (7)
| Filename | Depiction |
|---|---|
| `coin.png` | Gold coin with a paw print stamped on it |
| `morning-icon.png` | Sun (Morning quests) |
| `brain-icon.png` | Star / brain spark (Brain quests) |
| `move-icon.png` | Lightning bolt (Move quests) |
| `tidy-and-help-icon.png` | Broom with a sparkle (Tidy quests) |
| `night-routine-icon.png` | Moon + stars (Night quests) |
| `game-time-star.png` | Star / game badge (game-time reward) |

### Avatars & pets (5) — friendly stylized pixel characters (not photoreal)
Tune hair/colors to resemble the family; keep them simple and warm.
| Filename | Who |
|---|---|
| `mom.png` | Mom avatar |
| `abba.png` | Abba avatar |
| `sirus.png` | Sirus (child) avatar |
| `wesley.png` | Wesley the dog |
| `arlo.png` | Arlo (pet/family — confirm) |

### App icons & room (4)
| Filename | Depiction | Note |
|---|---|---|
| `icon-192.png` | Hero-cat face in a rounded tile | **Opaque OK**, 192×192, readable small |
| `icon-512.png` | Same, 512×512 | **Opaque OK** |
| `apple-touch-icon.png` | Same, Apple home-screen | **Opaque OK**, 180×180 |
| `cafe-room.png` | Cozy café interior: warm floor, pastel wall, window, open floor for décor | **OPAQUE**, wide landscape, no cats/text |

## 6. Integration notes

- Deliver **transparent PNGs** (except the icons + `cafe-room.png`), named per §5.
- Once the new sprites are pixel art, the app will add `image-rendering:
  pixelated` so they stay crisp when scaled up.
- If you make **2–3 frames per pose**, the café cat's idle can switch from the
  current CSS "breathing" to real frame animation.
- Keep the 74 originals untouched — the pixel set is a separate `pixel-v1/`.
