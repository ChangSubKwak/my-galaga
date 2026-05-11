# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

The entire game is a single static file. To play:

- Open `index.html` directly in a browser, or
- Serve the directory: `python3 -m http.server 8000` then visit `http://localhost:8000/`

There is no build step, no package manager, no test suite, and no lint config. All edits go into `index.html`. After every meaningful change, run a syntax check:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('JS parse OK');"
```

## Architecture

### Single-file structure

`index.html` (~10,000 lines) contains the entire game: HTML shell, CSS, and an inline `<script>` block that holds all game logic. The two `*.svg` files (`bullet_concepts.svg`, `bullet_readability.svg`) are design references for player-bullet visuals and are not loaded by the game.

### Fixed-timestep loop with internal resolution

The game renders at a fixed internal resolution of `BASE_W=224 × BASE_H=288` and is upscaled to fit the window via a `SCALE` factor applied with `ctx.setTransform(...)` inside `draw()`. The main loop (`gameLoop`) uses an accumulator pattern locked to `FPS=60` (`TICK = 1000/60`), so `update()` runs at a fixed rate independent of the render cadence. **All timer-driven visual effects must tick in `update()`, not `draw()`** — otherwise they run at the monitor's refresh rate (60/120/144Hz) instead of the simulation rate.

### State machine

Every frame is dispatched through a single `STATE` enum: `TITLE | STAGE_INTRO | PLAYING | CHALLENGING | BOSS_STAGE | CAPTURED | RESPAWN | GAME_OVER | PAUSED | BONUS_GAME`. Both `update()` and `draw()` switch on `game.state`. When adding new screens or modes, add them in **both** switches and ensure transitions go through `game.state = STATE.X` rather than calling draw/update functions directly.

`startStage()` decides which mode the next stage runs in:
- `stage % BOSS_STAGE_INTERVAL === 0` → `BOSS_STAGE` (mega-boss). `BOSS_STAGE_INTERVAL` is `10` (production cadence).
- otherwise `stage % 4 === 0` → `CHALLENGING` (scripted bonus waves)
- otherwise → normal `PLAYING` formation

`startStage()` also rolls `game.stageMutation` (30% chance, normal stages only) and `game.ambientEvent` (35% chance, stage > 3) before branching — both helpers self-gate by stage type.

### Single global `game` object

All mutable state lives on one object built by `resetGame()`. There are no classes; enemies, bullets, power-ups, explosions are plain objects pushed onto arrays on `game`. When adding a new entity type, add the array in `resetGame()`, an updater called from the relevant state branch in `update()`, and a draw pass in the matching `draw*` function.

### Enemy lifecycle (formation mode)

A normal stage's enemies move through `entering → formation → diving → returning → formation` (with `capturing` as a boss-only branch). Movement during `entering`/`returning`/`diving` is driven by cubic Bézier paths built from `createEntryPath` / `createDivePath` / `createLoopPath` and evaluated with `bezierPoint`. Diving uses multi-segment paths (`pathSegments` + `pathSegIndex`); the others use a single segment. When all enemies finish entering, `game.allEntered` flips and the dive-trigger logic in `updateEnemies()` activates.

`CHALLENGING` stages are different: enemies are pre-built into `game.challengeWaves` (8 waves × 16 enemies) by `setupChallengingStage()`. Collision code in `updateCollisions()` switches its enemy source between `game.enemies` and the active challenge wave (`game.challengeWaves[game.challengeWaveIdx]`).

`BOSS_STAGE` runs on the `game.megaBosses` array. Higher stages spawn 2–3 mega-bosses simultaneously. Each boss has an `archetype` (`standard | horned | tendril | crystal`) assigned by `archetypeFor(stage)` — affects color, decorations, and the `signaturePattern` (split shot / laser sweep / fragment burst) fired by `sigTimer`. At 40% HP, `phase2` triggers METAMORPHOSIS: archetype morphs to the next in `morphMap`, `sigTimer` resets, BGM switches to `bossEnrage`, and a 24-frame freeze + ring burst cinematic plays. Each archetype has a `BOSS_TAUNTS` dialogue set; taunts fire at phase 2 entry / 25% HP / first dash.

### Enemy variety

11 enemy types in `ENEMY_INFO`: `bee` / `butterfly` / `boss` / `mirror` / `splitter` / `shielded` / `ufo` / `hoverer` / `kamikaze` / `goldenBee` / `minibee`. Each has unique sprite, behavior, points, and (for 4 types: mirror/shielded/kamikaze/ufo) **type-specific death visuals** layered on top of base explosion. First kill of each type unlocks a `dexUnlocked` entry persisted to `galagaDexUnlocked` — viewable in the BESTIARY tab of stats overlay (last Tab page).

**Elite variants**: stage 5+ formation enemies of common types (bee/butterfly/mirror/kamikaze) have a 3-5% chance to spawn as `e.elite` — +1 HP, red pulsing outline + gold corner pips, 1.5× score, 35% drop rate (vs 20%), and a "ELITE!" floatText on kill. Tracked via `game.eliteKills`.

### Power-up system

Drops are 20% chance per kill (35% for elites), plus a guaranteed S+N+P trio from the mega-boss. Power-up types:

| Type | Effect | Notes |
|------|--------|-------|
| S/N/P | Permanent level (`game.lvl`) | Capped by `MAX_POWER_LVL = {S:5, N:3, P:3}`. **Reset to 1/1/1 in `killPlayer()`** |
| T | `slowTimer` — enemy bullets 0.4× | 360 frames |
| R | `rapidTimer` — fire cooldown halved | 360 frames |
| W | `waveTimer` — bullets zigzag | 360 frames |
| H | `homingTimer` — bullets steer toward enemies | 360 frames |
| L | `laserTimer` — piercing beam, 1.4× speed, +1 dmg | 300 frames (rare) |
| B | BOMB — instant: clear bullets + 1 dmg all + 5% maxHp on mega-bosses | One-shot |
| E | SHIELD — +1 absorb charge, max `SHIELD_MAX=2` | Consumed in `killPlayer` before life loss |

Visual: ship sprite changes with S/N/P levels via `drawPlayer(x, y, color, levels)` 4th param — engine flame size, winglet extensions, cockpit ring glow.

### Defensive layers

Multiple save mechanisms applied in priority order on fatal hit (`tryTriggerWitchTime` checked at bullet/dive vs player collision):

1. `cheatInvincible` (backtick toggle) — debug invincibility, absorbs all hits
2. `shieldCharges` — consumed first if available, brief iframes + green ring
3. WITCH TIME — 30-frame slow-mo window (slowMul 0.2×); if `dashTimer > 0` within window → save (no death), else death resolves. `witchCooldown = 720` between activations.
4. Dash i-frames — manual evasion via Shift (12 invincible frames)

DASH PARRY: during `dashTimer > 0`, enemy bullets passing through the player are deflected: removed + 50 score + cyan spark + "PARRY +50" text + metallic ping. Tracked via `game.parryCount`.

### Combo system

`bumpCombo()` increments on kill. Multiplier tiers: c≥3 (1.25×), c≥5 (1.5×), c≥10 (2×), c≥15 (2.5×), c≥20 (3×, max). Decays after `COMBO_DECAY=90` frames without a kill.

**COMBO ARSENAL** auto-triggers at thresholds (25/50/75/100): grants free 3-sec RAPID / WAVE / HOMING / LASER respectively. Uses `Math.max` against existing timer so pickup-set timers aren't shortened. `comboArsenalClaimed` Set resets on combo break.

`COMBO_MILESTONE = 40` — extra ship granted every 40 combo (or +5000 in challenge mode).

### Dynamic systems (set per-stage, read per-frame)

- **`stageMutation`** (`rapidFire | fastDives | slowBullets | denseFire`, 30% / normal stages only) — flips one rule for the whole stage. Read sites: `updatePlayer` (rapidFire fire cd), `updateEnemies` diving branch (fastDives pathSpeed), `updateBullets` enemy slowMul (slowBullets), `diffFireMul` (denseFire).
- **`stageBiome`** (`biomeForStage(stage)`, stage 8+, 8-cycle alternating dark/bright) — `planet | dawn | asteroid | ice | gasGiant | corona | blackhole | starfield`. Drawn in `drawBiome()` between nebulae and stars.
- **`ambientEvent`** (`cargoShip | supernova`, 35% / stage > 3) — atmospheric one-shot. Ticked in `updateAmbientEvent`.
- **`worldCorruption`** (computed from stage) — scales 0→1 over stages 30-80. Adds edge noise / glitch bars / corner haze. Drawn after game content, before scanlines.

### Narrative layer

- **`TRANSMISSION_LOGS`** — typed-out 3-line beats during STAGE_INTRO at stages 5/10/15/20/25/30/40/50/60/70/80.
- **`BOSS_NAMES`** — 8 unique names (THE OVERSEER, TWIN SOVEREIGNS, APEX, THE DEVOURER, IRON SWARM, NULLIFIER, OBSIDIAN PRIME, THE FINAL WALL), cycled past stage 90.
- **`BOSS_TAUNTS`** — 4 archetype × 5 situations dialogue dictionary. Speech bubble above boss, fades over 90 frames.
- **`EPITAPHS`** — 6 stage-tier buckets × 3 variants. `pickEpitaph()` runs once at game over, stored on `game.runEpitaph`.
- **`pickRunHighlights()`** — top 3 stats (max combo / parries / stages / bosses / accuracy / dual fighter / elites) sorted by priority, displayed below epitaph.

### Player identity

`playerCallsign` — 3-letter monogram persisted to `galagaCallsign`. Editor at TITLE via 'U' (arrows + Enter). Displayed on TITLE, HUD (1UP corner), and RUN HIGHLIGHTS header.

### Audio

Sound is generated live through Web Audio (`AudioContext`). `playSound(type)` synthesizes one-shot SFX from oscillators / noise buffers. BGM is a self-rescheduling note scheduler (`scheduleBGMNotes`) that looks ahead 0.4s and re-arms via `setTimeout` every 120 ms — there are no audio files. `ensureAudio()` lazy-creates the context on first user input to satisfy autoplay policies; preserve that gate when adding new sound triggers.

BGM tracks have 5 voices: `lead` (square/saw, detuned chorus) + `bass` (triangle) + `pad` (sine, polyphonic root+fifth+octave) + `kick` + `hat`. The bus has a feedback delay (250ms, 0.32 fb, 0.30 wet) for spatial depth.

**DYNAMIC BGM INTENSITY** (`computeBgmIntensity()`) — multiplies lead voice volume by 1.0×–1.55× based on combo level, boss phase 2, and last-life urgency. Force-enables hat layer when intensity ≥ 1.30. Snapshotted once per scheduler tick (~120ms) for phrase coherence.

`bgmForGameState(state)` selects track: `normal | boss | bossEnrage | bossSuper | title`.

### Persistence

`localStorage` holds 25 keys, all prefixed `galaga*`:
- Scoring: `galagaHigh`, `galagaTopScoresNormal/Challenge/Daily`, `galagaCumStats[Challenge]`, `galagaBestTimes`, `galagaBonusWins`
- Mode/settings: `galagaDaily`, `galagaChallenge`, `galagaShip`, `galagaDifficulty`, `galagaMute`, `galagaBGMOff`, `galagaSFXOff`, `galagaVol`, `galagaShake`, `galagaRumble`, `galagaColorBlind`, `galagaNightOff`, `galagaCheckpoint`, `galagaIntroSeen`
- Progression: `galagaAchievements`, `galagaDexUnlocked`, `galagaCallsign`, `galagaDailyDays`, `galagaShipsUsed`, `galagaDifficultiesUsed`

Each read site uses `try/catch` and falls back to a default — corrupt storage is non-fatal.

### Input

- Keyboard: `ArrowLeft/Right` / `A/D` (move), `Space` (fire/start), `Shift` (dash), `P`/`Esc` (pause). Normalized via `normalizeKey(e)` using `e.code` so layout (Hangul/Cyrillic etc.) doesn't break letter hotkeys.
- Gamepad: left stick / D-pad horizontal, A-button fire, Start pause — polled in `pollGamepad()` at the top of `update()`. Synthesizes the same `keys` map keyboard uses.
- Touch: `#touchControls` shown only when `'ontouchstart' in window`. Joystick on the left, fire/pause buttons on the right. Synthesizes same `keys` map.

Player firing is rate-capped via `game.fireCooldown` (6 frames base, halved by R rapid pickup, further reduced by stageMutation 'rapidFire', min 2 frames).

#### Hidden hotkeys (debug)
- **`` ` ``** (backtick) — cheat invincibility toggle ("GOD MODE")
- **`,` / `.`** — previous / next stage (preserves score/lives/lvl)
- **`1`–`9`** — jump to stage 1/5/10/15/20/30/40/50/80 milestones

## Working methodology — Quantum Leap default

When the user requests "의미있는 작업 진행" / "기조로 작업" / "다음 의미있는 구현" or any iterative meaningful-work request, apply this 5-step framework as default:

1. **Quantum Leap** — paradigm shift, not incremental polish. Add a NEW dimension to game state (system / mechanic / layer), not just bug fix.
2. **Creative Leap** — break the existing frame. Reference how similar games solved it, but FUSE with existing systems (transmission logs / biome / boss archetype / etc.) for project-specific solutions.
3. **10 times iteration** — split work into ~10 progressive steps. Data def → trigger → apply → UI → edge cases → verify → JS parse check.
4. **Q/A 10 times** — 10 internal Q&A cycles BEFORE work. Output as "Q/A 10회 (다음 Quantum Leap)" header with 10 numbered items.
5. **카파시 (Karpathy-style) refinement** — iterative test-driven mindset. One step at a time, mental verification each step, edge case checks.

**Output format**:
- "**Q/A 10회 (다음 Quantum Leap)**" header + 10 numbered Q+A pairs
- "**Quantum Leap: <NAME>** — <one-line>" decision
- "**검증 (10 iteration)**" table with ✅ marks
- "**카파시 식 edge case**" verification section
- "**Vision Delta**" before/after comparison

**Constraints**:
- Score-inflation avoidance — new systems should prefer visual / audio / narrative dimensions; score additions must be deliberate.
- Existing-system fusion — new systems must connect to existing (transmission/biome/boss/etc.) for synergy, not become isolated islands.
- Single-file preservation — all changes in `index.html`. No external deps.
- Mandatory JS parse verification at turn end (see the `node -e` snippet above).

**Skip this framework** when the user's request is:
- Single specific bug fix
- Cosmetic change explicitly named
- Routine refactor / rename

## Working in this codebase

- Game tuning constants are mostly at the top of the script (`PLAYER_SPEED`, `BULLET_SPEED`, `BOSS_STAGE_INTERVAL`, `STAR_COUNT`, `MILESTONE_STAGES`) or grouped near the relevant function (`SHIELD_MAX`, `SLOW/RAPID/WAVE/HOMING/LASER_DURATION`, `WITCH_WINDOW=30`, `WITCH_COOLDOWN=720`, `COMBO_DECAY=90`, `COMBO_MILESTONE=40`). Per-ship caps live on `SHIPS[*].bulletCap` and difficulty scales speed/fire-rate via `diffSpeedMul()` / `diffFireMul()`. Difficulty scaling typically multiplies by `game.stage`.
- Sprite art is drawn procedurally via `ctx.fillRect` calls in `drawPlayer` / `drawBee` / `drawButterfly` / `drawBoss` / `drawMegaBoss` / `drawPlayerBullet` / etc. There are no image assets.
- Hit detection is AABB with hardcoded half-extents (commonly `8 × 8` for bullets-vs-enemies, `7` or `16` for the player depending on `dualFighter`). When changing sprite size, update the corresponding collision constants too.
- **Draw functions must NOT mutate game state.** Camera/effect timers (`zoomPulse`, `cinematicBars`, `camNudgeX/Y`, `comboLostFlashTimer`, `highScoreGlow`, `worldCorruption`-driven counters) all tick in `update()` under a PAUSED guard. If you add a timer-driven visual, add its decrement next to those.
- `BOSS_STAGE_INTERVAL = 10` is the production cadence — confirm with the user before changing stage cadence.
- The `bgmTimerId` global tracks the in-flight scheduler timer; `stopBGM` clears it. When changing tracks via `startBGM`, the old scheduler chain is severed and the audio bus fades over `BGM_FADE = 0.35s` before disconnecting.
