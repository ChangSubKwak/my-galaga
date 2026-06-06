# Design System — Galaga Clone

Created by `/design-consultation` (2026-05-27). This is a single-file procedurally-
rendered HTML5 canvas arcade shooter — no fonts, no CSS framework, no components.
The "design system" here is the **visual atmosphere**: palette, background, and the
chrome/ambient treatment. Read this before any visual/color change.

## Aesthetic Direction — NEON VECTOR BLOOM (current, 2026-06-06)
A second `/design-consultation` (2026-06-06) flipped the direction: the restrained
flat Ink Noir read as "too flat / drab / cheap" — the minimalism became lifelessness.
The pivot is **Neon Vector Bloom** (Geometry Wars / Rez / Resogun lineage).

- **Direction:** Neon Vector Bloom on a deep void.
- **Mood:** Electric. The deep-black void STAYS (it is what makes the glow read), but
  everything bright sheds light — a full-frame bloom post-process composites the frame
  onto itself blurred + additively, so neon bullets, explosions, engine glow, and HUD
  text all bloom halos. Vivid saturated neon, vector-emissive sprites, particle juice.
- **Relationship to noir:** This is not "make it bright." It KEEPS noir's dark canvas
  (the void, the crimson accent, the daylight ground biomes) — and adds the electric
  bloom + neon energy that flat noir was missing. Noir gave the stage; neon turns the
  lights on. The earlier per-screen noir chrome work (below) still stands as the
  baseline the bloom amplifies.
- **Why:** Directly answers the "too flat" critique. Bloom + neon is the biggest, most
  technically cheap lever (internal res is 224×288; the bloom is two `drawImage` passes)
  that turns crude `fillRect` pixels into glowing vector-light. The game already had 47
  `shadowBlur` glow sites — the look was latent; bloom unifies it.

### Earlier direction (history) — Ink Minimal Noir (2026-05-27)
- **Mood:** A near-black void with restrained, deliberate color. White does the work;
  a single crimson accent carries danger/identity. Kept as the dark foundation the
  bloom builds on, but the *restraint* is no longer the goal — energy is.
- **Why (then):** Reinforced the sharpened "tight skill Galaga" identity + the "clean
  UI" (깔끔) north star. Still valid for chrome legibility; superseded for atmosphere.

## Bloom / glow (the headline system)
- **Full-frame bloom** lives at the tail of `draw()` (after the transform restore, in
  device pixels): `globalCompositeOperation='lighter'` + `ctx.filter='blur(Npx)'`, two
  passes — wide soft glow (`blur ≈ SCALE×2.4`, α 0.40) + tight halo (`blur ≈ SCALE×0.9`,
  α 0.28) — `drawImage(canvas, …)` onto itself. Black adds ~0 under `lighter`, so the
  void stays deep while lights bloom. Gated on `bloomEnabled` (`galagaBloomOff` persist)
  and a `ctx.filter` support check; the logic-test stub ctx has no `filter` so tests skip it.
- **Design implication:** anything you want to glow just needs to be BRIGHT and ideally
  drawn with additive/`shadowBlur`. Don't fight the bloom with heavy outlines on bright
  shapes — let the bloom be the outline. Keep the background dark so neon reads.
- **Neon passes shipped (verify-by-play, mapped by a read-only Explore workflow):**
  1. Full-frame bloom (headline).
  2. Projectiles — `BULLET_COLORS` vivid neon + `drawEnemyBullet` additive trail/halo;
     `drawPlayerBullet` neon bodies + additive trails (lvl1 up-trail, lvl2/3 flipped,
     laser/homing/wave halos), hues kept (cyan/magenta/tier semantics).
  3. Player ship — additive engine flame glow, hull neon rim (from `body` hue),
     P-ring additive magenta, dualFighter tether additive.
  4. Explosions/particles — `drawExplosion`/`drawHitSpark`/`drawShockwaves`/
     `drawItemBurst` additive light-bursts (alphas capped for bloom).
- **Still pending (lower priority — enemies already glow via the bloom):** per-sprite
  vector rims on enemy bodies (`drawBee`/`drawButterfly`/`drawMegaBoss`… — shadowBlur
  rims, hot-path cost, preserve elite-outline/ghost-stealth/hit-flash at the
  dispatcher), optional shared `COL` palette neon-lift (touches all UI — do carefully),
  and a bloom on/off options-menu toggle (`galagaBloomOff` already persists).

## Core principle — atmosphere noir, gameplay color preserved
A pure monochrome would break gameplay legibility and the colorblind redundancy the
game carefully built (power-up letters, enemy types, grades, elite/ghost markers all
encode information in color). So the noir treatment applies to the **ambient + chrome**
layers; **gameplay-functional colors stay** (optionally muted later).

## Palette
- **Void / background:** near-black with a whisper of crimson warmth — page gradient
  `#140a0c → #070508 → #000` (was blue `#001428…`).
- **Primary / ink:** white `#f0f0f0`–`#fff` (text, stars, structure).
- **Accent / danger:** crimson `#ff3b3b` (frame glow, UI accent target, last-life).
- **Neutrals:** cool grays `#ddd / #ccc / #bbb / #888` (dimmed stars, muted chrome).
- **Nebula:** desaturated ink grays `#1a1416 / #141214 / #181315 / #161217 / #121214`
  (was blues/purples) — faint clouds, not blue gas.
- **Gameplay-functional (PRESERVED — do not noir these):** `COL` primaries (enemy/
  power-up/grade color-coding), `POWERUP_COL`, `GRADE_COL`, biome identity tints,
  shield green, dash/witch-time cyan, elite red, ghost. These encode game state.

## Applied so far (pass 1 — ambient field)
- Page background gradient → noir. Canvas frame glow: blue → crimson + white inset.
- `STAR_COLORS` → monochrome white/gray (dropped cyan/pink/yellow tints).
- `NEBULA_PALETTE` → desaturated ink grays.

## Applied — pass 2 (per-screen chrome audit, 2026-05-28)
Screen-by-screen audit. Most cyan/magenta sites turned out to be gameplay-semantic
(S/N/P power-letter coding, challenge-stage identity, BLINK synergy, accuracy tiers,
ship/biome color) and were KEPT. Only purely-decorative chrome was changed.

- **STAGE_INTRO 2A:** time-of-day micro-tint rainbow → noir cycle (dim gray /
  warm soft / white / soft crimson, gold for noon stays); 6-loop cyan decoration
  → white; PB-time chrome cyan → gold; TIP chrome cyan → muted gray; stage-
  progress-map "current-normal-stage" marker cyan → white (boss=red and
  challenge=magenta stay as semantic tier identity).
- **TITLE 2B:** time-of-day greeting rainbow (6 pastels) → same noir cycle as
  STAGE_INTRO; top dashed marquee `#0af` → white; trophy badges flattened to
  gold (top tier) / white (mid) / dim gray (low) instead of cyan/green/gold mix;
  completion-percent tier `#0ff`/`#0f8` chrome → white/dim.
- **GAME_OVER / PAUSED 2C:** boss-stage aurora streaks (3 blues `#48f`/`#8af`/`#a8f`)
  → noir crimson aurora `#933`/`#a55`/`#864`, matching the crimson frame glow.
  Witch-time tint `#5cf` is gameplay-semantic — KEPT.
- **TOUCH CONTROLS 2F (CSS):** pause button + move-pad/knob chrome (blue) → neutral
  white ring; the joystick knob carries the crimson identity accent. DASH button
  (`.touch-btn` base, cyan) and FIRE button (red) KEPT — they mirror the in-game
  dash=cyan / danger=red semantics, so the touch palette now reads as
  cyan=dash / red=fire / white=navigation.
- **STATS OVERLAY 2G (TAB):** panel chrome only — blue fill → near-black crimson-warm
  `rgba(16,9,11,.93)`; green neon frame + glow → white ink + crimson glow (matches
  canvas frame); page-title headers (BESTIARY / ACHIEVEMENTS / BOSSES) cyan → white.
  All per-stat tier colors (`#0ff`/`#0f8`/`#fc4` progress ramps), the BESTIARY
  unlocked-row + CODEX-bar green (completion-state encoding), and enemy `info.col`
  were KEPT as gameplay-functional.

## Applied — DAYLIGHT GROUND BIOMES (2026-06-06)
User asked to consider a **bright (non-dark) background with Earth's land**. Chosen
direction (via question): introduce brightness **per-biome**, not globally — keep the
noir void for space, but render the four terrestrial/sky biomes as a genuinely BRIGHT
daytime scene. This is a deliberate, scoped exception to the global noir void: noir
still governs space + chrome; daylight governs the ground stages, creating a
space(dark)↔ground(bright) environmental contrast that reuses the existing biome cycle.

- **Bright set:** `planet` (blue world horizon), `dawn` (warm sunrise), `desert` (hazy
  bright dunes), `canyon` (bright sky framed by red walls). `ruins` (somber bombed city)
  and the 7 space biomes stay on the noir void.
- **Render:** shared `drawBrightSky(pal)` paints a lit sky gradient (medium-tone zenith
  → luminous horizon, so combat up top stays legible), a horizon glow, a lit ground
  fill, and a forward-scrolling parallax speckle. Each biome keeps its signature detail.
- **Legibility (the bright-bg cost, handled):** `game._brightBiome` gates three fixes —
  starfield hidden (no stars in daylight), a dark gradient HUD backing (top score row +
  bottom lives/level), and a thin dark backing behind player bullets. Gameplay-functional
  colors (enemy types, power-ups, bullets) are unchanged.
- Verified by play (browser screenshots): planet stage 8/10 render bright sky + green
  ground with legible HUD/enemies/bullets; non-bright stages keep the dark void.

## Staged / pending (verify-by-play, user decision)
- **UI chrome accent:** the pervasive cyan `#0ff` in HUD/title/menu *chrome* → white +
  crimson. Risky to flip globally (COL.cyan is also gameplay-semantic: dash, witch
  time). Needs careful chrome-vs-gameplay separation, not a blind COL swap.
- **Biome backdrops:** desaturate the 12 biome ambient palettes toward noir while
  keeping each biome's identity readable.
- **Touch-control chrome (CSS):** the blue touch buttons/glow → crimson/white.
- **Sprite muting (optional):** slightly reduce saturation on decorative (non-
  functional) sprite detail.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Ink Minimal Noir direction chosen; ambient field converted (pass 1) | User picked it via /design-consultation; serves the "clean" identity. Gameplay color-coding preserved for legibility. |
| 2026-06-06 | Bright daylight ground biomes (planet/dawn/desert/canyon) | User asked to consider a bright Earth-land backdrop; chose per-biome brightness over a global pivot. Noir keeps space + chrome; daylight gets the ground stages → space↔ground contrast, reusing the biome cycle. |
| 2026-06-06 | **Direction pivot → Neon Vector Bloom** (full-frame bloom pass 1 shipped) | User: flat Ink Noir read as "too flat/drab/cheap." 2nd /design-consultation chose Neon Vector Bloom. Keeps the dark void (glow needs black) but adds an electric full-frame bloom + neon energy. Noir = foundation, neon = the lights. Remaining sprite/palette neon passes staged. |
