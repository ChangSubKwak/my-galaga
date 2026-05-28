# Design System — Galaga Clone

Created by `/design-consultation` (2026-05-27). This is a single-file procedurally-
rendered HTML5 canvas arcade shooter — no fonts, no CSS framework, no components.
The "design system" here is the **visual atmosphere**: palette, background, and the
chrome/ambient treatment. Read this before any visual/color change.

## Aesthetic Direction
- **Direction:** Ink Minimal Noir
- **Mood:** A near-black void with restrained, deliberate color. White does the work;
  a single crimson accent carries danger/identity. The opposite of the generic
  "cool-blue neon arcade" look most shmup clones converge on.
- **Why:** Reinforces the sharpened product identity (*"a tight skill Galaga"*, see
  the CEO-review subtraction) and the user's standing "clean UI" (깔끔) north star.
  Less chromatic noise → gameplay-functional color reads louder.

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
