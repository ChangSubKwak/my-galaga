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
