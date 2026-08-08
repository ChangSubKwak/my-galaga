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
  5. **REACTIVE VECTOR GRID (headline layer)** — a spring-mounted neon lattice
     (`buildVectorGrid`/`updateVectorGrid`/`drawVectorGrid`/`gridRipple`, `vgrid`)
     drawn as additive lines just after `drawBiome()` (above void/nebula, below
     stars + sprites). Explosions shove it outward then it springs back, so the
     dead void becomes a living Geometry-Wars floor. Physics ticks in `update()`
     (next to `updateStars`); draw only reads displacement + a stateless idle
     wave. Ripples are fanned from a SINGLE hook that scans `game.explosions`
     (`_rippled` flag), covering every explosion source without touching push-sites.
     Self-gates OFF on the bright daylight biomes (`game._brightBiome`); mood
     shifts indigo→crimson on boss phase-2 / last-life (mirrors the starfield mood).
     Base pass is one path/one stroke; only ripple-energized segments overdraw
     brighter. Logic-tested (lattice coverage, ripple impulse, spring settle, MAXD
     clamp, explosion-scan hook).
  6. **SPECTRAL LENS GRADE (headline post pass)** — the whole composited frame now
     passes through one cinematic lens at the bloom tail. A pure **combat-heat** scalar
     (`bloomHeat`, from combo / last-life / boss phase2 — the same signals the grid &
     starfield mood read) drives two effects: (a) **chromatic-aberration spectral bloom**
     — a warm ghost shifted one way + a cool ghost the other (`chromaSplitForHeat` /
     `chromaAlphaForHeat`, recolored via `sepia+hue-rotate` so bright edges split into
     prismatic fringe — the Rez/Tetris-Effect look; ghosts stay low-alpha + colored so
     they add hue not white, guarding the whiteout fix; skipped under `reduceMotion`),
     and (b) a **dynamic vignette grade** (`vignetteAlphaForHeat`) tinting the edges in
     the indigo-calm→crimson-danger mood, focusing the eye + deepening atmosphere
     (hard-reduced on bright daylight biomes so daytime stays bright). Rides the SAME
     `bloomEnabled`/`_perfBloomOff` perf valve — full lens stack shuts off under load.
     The two base bloom passes were trimmed (0.36/0.24 → 0.34/0.22) to offset the added
     additive ghosts. Four pure drivers logic-tested.
  7. **BIOME ATMOSPHERIC GRADE (per-biome lens identity)** — the SPECTRAL LENS
     vignette is no longer one fixed mood: a pure `biomeGrade(id)` (BIOME_GRADE map
     + neutral-indigo fallback) tints the whole frame's edge-darkening in each
     biome's mood — molten corona burns red-orange, the ice field chills cyan, the
     star nursery glows violet, the black hole goes cold void-violet. A whisper of
     the hue also rides the vignette centre (skipped on bright daylight biomes so
     daytime stays bright). Danger (boss phase2 / last-life) still overrides the
     whole grade to crimson — survival mood trumps scenery. So the 12 biomes now
     differ in full-frame colour identity, not just background art. Logic-tested
     (12 distinct dark grades, registry wired both sides via biomeForStage, null
     fallback).
- **Still pending (lower priority — enemies already glow via the bloom):** per-sprite
  vector rims on enemy bodies (`drawBee`/`drawButterfly`/`drawMegaBoss`… — shadowBlur
  rims, hot-path cost, preserve elite-outline/ghost-stealth/hit-flash at the
  dispatcher), optional shared `COL` palette neon-lift (touches all UI — do carefully),
  and — **done 2026-08-08** — a bloom on/off toggle, now on **E** (`galagaBloomOff`
  had been read at startup for a long time with nothing ever writing it, so the
  headline visual system had no off switch; only the automatic perf valve could
  disable it. Bloom is a full-frame additive glow, so "too bright / too hazy" is a
  real comfort complaint and now has a remedy).

## SIMPLE-BY-DEFAULT GUI (2026-07-03)
User directive: "make the overall GUI VERY simple." The default view now shows only
VITAL elements (score/lives/stage, buff strip, combo box, boss HP, danger telegraphs,
shield/dash/witch cues, one line per event); ~120 INFO elements (chips, stat banners,
speedrun cluster, radar, meta counters, score chatter) lived behind an **M toggle**
(`minimalHud`, default ON). **UPDATE 2026-08-08: that hidden tier is now deleted, not
toggled** — it was a second HUD almost nobody saw, so there is one HUD and no M key.
DECOR was deleted outright
(duplicate chips, marquees, stacked red layers, extra vignettes/scanlines, subtitle
lines, celebration bursts). Principles: **edges mean danger** (no permanent decorative
borders), **one text per event**, **one rendering per fact** (the AAR panel is the
sole stage summary), **absence needs no label**. Never-cut list honored: gameplay
color coding, danger telegraphs, colorblind markers, reduceMotion, boss HP, buff
timers. Shipped as 8 commits (45cc9c7..4db0dcd); the per-screen keep/gate/delete
spec came from a 6-auditor + judge workflow.

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

## Legibility floor (2026-08-08) — the dim end of the palette has a hard bottom
A measured WCAG 2.1 §1.4.3 audit (every `drawRetroText` colour vs the pure-black
void) found ~15 chrome labels sitting at **2.2–3.7:1** — `#333`/`#444`/`#446`/
`#555`/`#666` on AAR panel labels, the ACH readout, the radar idle count, the
bestiary hint, the PILOT LOG empty state. Fine on a bright editor; invisible on a
dim laptop at arm's length.

The fix deliberately did **not** flatten everything to white — the dim/bright split
is real visual hierarchy (labels recede so values pop). Instead the *floor* rose and
the hierarchy stayed:

- `COL.label` `#8a8a8a` — **6.08:1** — de-emphasized labels/captions that carry info.
- `COL.faint` `#777`    — **4.69:1** — the dimmest text the game is allowed to draw.

Anything dimmer is reserved for genuinely **inactive** state (a locked bestiary row,
a disabled BGM toggle), which WCAG exempts and where the dimness *is* the message.
Dark-on-bright text (a power-up letter on its filled chip) is correct and exempt.
Locked bestiary rows were still lifted `#444 → #666` — "undiscovered" should read as
locked, not as absent.

**Locked by test**: the logic suite asserts `COL.label`/`COL.faint`/`COL.gray` and every
bright semantic colour clear 4.5:1 on the void, and that `label` stays brighter than
`faint`. Re-introducing a sub-floor chrome colour now fails the build.

Validated against the `ui-ux-pro-max` design skill, whose recommendation for this
product type (retro arcade / entertainment / dark neon) independently returns **Pixel
Art on a dark ground with neon accents** — i.e. it endorses the existing NEON VECTOR
BLOOM direction and flags exactly one risk: *"Accessibility: Good **if contrast ok**"*
and *"Avoid: poor contrast ratios."* That is the gap this section closes.

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

## Pixel typeface (2026-08-08) — embedded, paired, size-gated
The game rendered every glyph in the browser's **default monospace** — the one
un-designed surface left in a procedurally-drawn arcade game. Two pixel faces are
now embedded as **base64 woff2 inside `<style>`** (+40KB), so the single-file /
offline-from-`file://` contract holds — no Google Fonts request, ever.

- **PressStart2P** — display face, blocky arcade. Used at **size ≥ 12 only**.
- **VT323** — body face, narrow terminal. Everything else.
- Both **SIL OFL 1.1**, unmodified, attributed in the CSS comment.

**Why a pairing, not one face.** A census of all 213 `drawRetroText` sites found
**194 at size ≤ 7**. PressStart2P advances a full **1.0em** per glyph vs the default
monospace's ~0.6em — using it everywhere would blow every HUD panel and stats row
~67% wider. VT323 advances **0.40em**, *narrower* than what it replaces, so the body
face cannot overflow a layout that already fits.

**Metrics were measured, not assumed** (parsed out of the shipped base64):

| face | advance | cap height |
|---|---|---|
| PressStart2P | 1.000em | 0.875em |
| VT323 | 0.400em | 0.560em |
| Courier New (Windows default, the one replaced) | ~0.600em | 0.571em |
| DejaVu Sans Mono / Menlo | ~0.600em | 0.72–0.73em |

VT323's cap height matches Courier New within **2%**, so on the reference platform the
swap changes the *typeface* without changing the optical size — one variable, not two.
Hence `PIXEL_BODY_SCALE = 1.0`; it exists only to re-tune if the reference platform
changes (mac/Linux monospace runs ~20% taller, so ~1.2 would match those).

**Overflow safety is exact, not hoped-for.** Both faces are monospaced, so a line is
precisely `chars × advance`; the advance is measured once per font string and cached,
so the fit test costs a multiply — no `measureText` in a function that runs dozens of
times a frame. A display line that would not fit **falls back to the body face**. All
nine worst-case display strings (incl. `TWIN SOVEREIGNS` at 210px) were verified to fit.

**Known, accepted:** neither face ships `★ → ✓` (nor `↑` in VT323). Those fall back
per-glyph to the `monospace` in the stack — they still render, in the fallback face.
This also keeps the fit test conservative: a fallback glyph is narrower than the 1.0em
the test assumes, so a mixed line can only come out *shorter* than predicted.

**Escape hatch + guards.** `Y` toggles the typeface (persisted `galagaPixelFontOff`),
matching bloom/shake/colorblind. Loading is gated on `document.fonts.load` for BOTH
faces, so a blocked or slow font never draws a frame with wrong metrics — it just stays
monospace. Tests assert both payloads decode with the `wOF2` magic number, that no
Google Fonts URL or remote `@import` returns, and that both stacks keep a monospace
fallback.

## Page chrome audit vs the ui-ux-pro-max Pixel Art checklist (2026-08-08)
Ran the skill's Pixel Art checklist against the shipped file. **Most of it was already
satisfied** — `image-rendering: pixelated` + `ctx.imageSmoothingEnabled = false` (the
bloom deliberately keeps smoothing ON, which is correct), CRT scanline overlay, retro
palette, and — as of today — pixelated fonts and a contrast-clean palette. Three real
gaps remained:

- **`theme-color` was still `#000814`** — a leftover from the pre-noir BLUE palette. The
  page ground moved to crimson-warm noir long ago; the mobile URL-bar colour never did.
  Now `#0a0507`.
- **`border-radius: 2px` on the canvas** → `0`. Sharp edges is the whole doctrine; a
  rounded corner softens the one hard rectangle the aesthetic is built on.
- **Scanlines were not on the pixel grid.** The overlay used a fixed 3px period while the
  game upscales by a usually-fractional `SCALE` (3.75× at 1080p), so the lines *beat*
  against the pixel rows — the classic CRT-shader moiré mistake. `resize()` now publishes
  `--scan` (= `SCALE`, floored at 2px) and the gradient uses one **game pixel** as its
  period. Coverage stays 1/3, so overall darkness is unchanged — only the alignment.

**Deliberately NOT changed:**
- **Touch-button font stays `sans-serif`.** Switching it to the pixel face was checked
  against the embedded cmaps first: `●` (U+25CF) and `❙` (U+2759) are absent from *both*
  faces, so two of the three buttons would have silently fallen back — a mixed, worse
  result. Verified, not assumed.
- **No arcade bezel.** `SCALE = min(w/224, h/288)` means the canvas fills the full
  viewport height on a normal landscape display, so a bezel has no room without shrinking
  the play area. That is a legibility trade-off the player should choose, not a blind edit.

## Item language (2026-08-08) — SPINNING VECTOR CORE
User verdict on the pickups: *"아이템 디자인이 너무 멋이 없습니다"* (the item design has
no style). The diagnosis was not taste, it was that the items broke rules this document
already states:

- **They fought the bloom.** The gem carried a full **white outline** while the direction
  above says, in as many words, *don't fight the bloom with heavy outlines on bright
  shapes — let the bloom be the outline.* An outlined gem reads as a flat sticker pasted
  on the void instead of something emitting light.
- **They were the only static object** in a game whose entire look is moving neon.
- **Identity was illegible** — twelve bespoke 6×7px glyphs (lightning bolt, hourglass with
  falling sand, sine ripple) at an internal resolution giving each about five pixels of ink.
- **All twelve shared one cross-beam halo**, so at a glance every pickup looked the same.
- The supply crate was **flat grey** — the one colour that cannot bloom — and encoded its
  damage state as a **tint only**, which the colorblind rule forbids.

**The language every collectible now shares** (power-up, supply crate, the magpie's
carried loot; salvage shards already fit it):

| layer | rule |
|---|---|
| additive flare | rotating, in the object's semantic colour — the object *throws* light so the full-frame bloom spreads it |
| dark inner well | small; keeps the mark readable on the bright daylight biomes (same trick as the HUD backing) |
| vector housing | thin rotating outline, **stroked and never filled** — the bloom supplies the glow |
| emissive core | additive, pulsing |
| the mark | **the letter**, upright, white, never rotated — it is the canonical identity (the help panel names every pickup by letter) *and* the colorblind redundancy, in one legible glyph |

**Rules that fall out of this, for anything new:**
1. A collectible is never grey and never outlined in white. If it should feel valuable, it
   emits; the bloom does the rest.
2. Damage/charge state must be readable as **shape** (the crate sheds a frame corner per
   hit), not as tint alone.
3. Wherever the same item is drawn a second time — carried by an enemy, shown in a HUD
   chip — it is drawn as a **miniature of the real thing**, not its own shape.
4. Rotation slows under `reduceMotion`.

Side effect: `drawPowerUp` went 281 → 161 lines, since one letter replaced twelve glyph
routines. **Verify by eye** — the layout audit proves text fits and nothing throws, but it
cannot judge whether the result looks good.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Ink Minimal Noir direction chosen; ambient field converted (pass 1) | User picked it via /design-consultation; serves the "clean" identity. Gameplay color-coding preserved for legibility. |
| 2026-06-06 | Bright daylight ground biomes (planet/dawn/desert/canyon) | User asked to consider a bright Earth-land backdrop; chose per-biome brightness over a global pivot. Noir keeps space + chrome; daylight gets the ground stages → space↔ground contrast, reusing the biome cycle. |
| 2026-06-06 | **Direction pivot → Neon Vector Bloom** (full-frame bloom pass 1 shipped) | User: flat Ink Noir read as "too flat/drab/cheap." 2nd /design-consultation chose Neon Vector Bloom. Keeps the dark void (glow needs black) but adds an electric full-frame bloom + neon energy. Noir = foundation, neon = the lights. Remaining sprite/palette neon passes staged. |
