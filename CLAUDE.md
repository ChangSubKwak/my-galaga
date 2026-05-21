# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

The entire game is a single static file. To play:

- Open `index.html` directly in a browser, or
- Serve the directory: `python3 -m http.server 8000` then visit `http://localhost:8000/`

There is no build step, no package manager, and no lint config. All game code goes into `index.html`. After every meaningful change, run the full verification (JS parse + logic tests) in one command:

```bash
bash test/run.sh        # JS parse check + logic tests; exit 0 only if both pass
```

Or run either half on its own:

```bash
# 1) syntax check the inline <script>
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('JS parse OK');"
# 2) logic tests only
node test/logic.test.js   # exit 0 = pass, 1 = failure
```

### Logic tests

A standalone Node harness lives at `test/logic.test.js` (430+ assertions, no test
framework or dependencies). It extracts the inline `<script>`, runs it inside a
`vm` sandbox with hand-rolled browser-API stubs (canvas/2d ctx, `localStorage`,
`document`, `window`, `AudioContext` — including `createStereoPanner` / node
`detune`, RAF), and asserts pure-ish logic plus registry-consistency invariants:
`computePilotMomentum`, `evalBonusResult`, `bonusSkillStop`, `checkPbHalfMark`,
`killPlayer` revenge-seeding, `addScore` extra-life/cap, `comboMultiplier`/
`bumpCombo`, `bezierPoint` + `createEntryPath`/`createLoopPath`, `eliteRateForStage`/
`powerUpDropRate`, `fmtScore`/`fmtFrameTime`/`fmtMS`, `computeAccuracy`,
`computeRunGradeScore`/`runGradeLetter`, `comboTierName`, `stageModeFor`,
`isCombatState`, `computeBgmIntensity`/`computeBgmPitch`/`bgmForGameState`,
`computeMoraleScore`, `computeDailyStreak`, the pilot rank ladder + composite
completion, daily-mode determinism, `panForX`/`SFX_VARY` (spatial-audio curve +
pitch-wobble set), the stats-overlay page model (`statsAchGridPages`/
`statsTotalPages`), corrupt-storage robustness, and **data-registry guards** that
each entry stays wired on both sides — INTERCEPT_MSG, MORALE_STATES,
PILOT_MOMENTUM, STAGE_MUTATIONS (id↔read-site), ACT_TITLES (contiguous ranges),
ENDURANCE_TIERS (ascending), COMBO_ARSENAL (buff↔timer), plus STATE / PERK /
boss-archetype / biome / weather / ship / enemy entries (so extending a registry
can't silently half-break).

Note: top-level `let`/`const` bindings (e.g. `game`, `stagePBs`, `SHIPS`) are not
visible on the vm context global — the harness appends accessor shims (`__getGame`,
`__getStagePBs`, `__getShips`...) to reach them. Add new shims there if a test
needs another closure binding. This covers logic only; visual/feel changes still
need a browser.

## Architecture

### Single-file structure

`index.html` (~22,700 lines) contains the entire game: HTML shell, CSS, and an inline `<script>` block that holds all game logic. The two `*.svg` files (`bullet_concepts.svg`, `bullet_readability.svg`) are design references for player-bullet visuals and are not loaded by the game.

### Fixed-timestep loop with internal resolution

The game renders at a fixed internal resolution of `BASE_W=224 × BASE_H=288` and is upscaled to fit the window via a `SCALE` factor applied with `ctx.setTransform(...)` inside `draw()`. The main loop (`gameLoop`) uses an accumulator pattern locked to `FPS=60` (`TICK = 1000/60`), so `update()` runs at a fixed rate independent of the render cadence. **All timer-driven visual effects must tick in `update()`, not `draw()`** — otherwise they run at the monitor's refresh rate (60/120/144Hz) instead of the simulation rate.

### State machine

Every frame is dispatched through a single `STATE` enum: `TITLE | STAGE_INTRO | PLAYING | CHALLENGING | BOSS_STAGE | CAPTURED | RESPAWN | GAME_OVER | PAUSED | BONUS_GAME`. Both `update()` and `draw()` switch on `game.state`. When adding new screens or modes, add them in **both** switches and ensure transitions go through `game.state = STATE.X` rather than calling draw/update functions directly.

`startStage()` decides which mode the next stage runs in via the shared
`stageModeFor(stage)` helper (one source of truth — use it, don't re-inline the
cadence test):
- `stage % BOSS_STAGE_INTERVAL === 0` → `'boss'` → `BOSS_STAGE` (mega-boss). `BOSS_STAGE_INTERVAL` is `10` (production cadence).
- otherwise `stage % 4 === 0` → `'challenge'` → `CHALLENGING` (scripted bonus waves)
- otherwise → `'normal'` → `PLAYING` formation

`startStage()` also rolls `game.stageMutation` (30% chance, normal stages only) and `game.ambientEvent` (35% chance, stage > 3) before branching — both helpers self-gate by stage type.

### Single global `game` object

All mutable state lives on one object built by `resetGame()`. There are no classes; enemies, bullets, power-ups, explosions are plain objects pushed onto arrays on `game`. When adding a new entity type, add the array in `resetGame()`, an updater called from the relevant state branch in `update()`, and a draw pass in the matching `draw*` function.

### Enemy lifecycle (formation mode)

A normal stage's enemies move through `entering → formation → diving → returning → formation` (with `capturing` as a boss-only branch). Movement during `entering`/`returning`/`diving` is driven by cubic Bézier paths built from `createEntryPath` / `createLoopPath` and evaluated with `bezierPoint`. Diving uses multi-segment paths (`pathSegments` + `pathSegIndex`); the others use a single segment. When all enemies finish entering, `game.allEntered` flips and the dive-trigger logic in `updateEnemies()` activates.

`CHALLENGING` stages are different: enemies are pre-built into `game.challengeWaves` (8 waves × 16 enemies) by `setupChallengingStage()`. Collision code in `updateCollisions()` switches its enemy source between `game.enemies` and the active challenge wave (`game.challengeWaves[game.challengeWaveIdx]`).

`BOSS_STAGE` runs on the `game.megaBosses` array. Higher stages spawn 2–3 mega-bosses simultaneously. Each boss has an `archetype` (`standard | horned | tendril | crystal`) assigned by `archetypeFor(stage)` — affects color, decorations, and the `signaturePattern` (split shot / laser sweep / fragment burst) fired by `sigTimer`. At 40% HP, `phase2` triggers METAMORPHOSIS: archetype morphs to the next in `morphMap`, `sigTimer` resets, BGM switches to `bossEnrage`, and a 24-frame freeze + ring burst cinematic plays. Each archetype has a `BOSS_TAUNTS` dialogue set; taunts fire at phase 2 entry / 25% HP / first dash.

### Enemy variety

12 enemy types in `ENEMY_INFO`: `bee` / `butterfly` / `boss` / `mirror` / `splitter` / `shielded` / `ufo` / `hoverer` / `kamikaze` / `goldenBee` / `minibee` / `warper` (warper teleports while diving; spawns stage 8+ in place of a bee/butterfly). Each has unique sprite, behavior, points, and (for several types: mirror/shielded/kamikaze/ufo) **type-specific death visuals** layered on top of base explosion. First kill of each type unlocks a `dexUnlocked` entry persisted to `galagaDexUnlocked` — viewable in the BESTIARY tab of stats overlay (last Tab page).

**Elite variants**: stage 5+ formation enemies of common types (bee/butterfly/mirror/kamikaze) have a 3-5% chance to spawn as `e.elite` — +1 HP, red pulsing outline + gold corner pips, 1.5× score, 35% drop rate (vs 20%), and a "ELITE!" floatText on kill. Tracked via `game.eliteKills`.

**Ghost variants**: deep-stage (60+) enemies have a 3% chance to spawn as `e.ghost` (mutually exclusive with elite). Ghosts render semi-invisible until the first hit flips `e.ghostRevealed`, score **2×** (the `ghost` factor in `killScore`), and fire the `ghostKill` intercept on death. Tracked toward the GHOST HUNTER / GHOST SLAYER achievements (5 / 25 ghost kills).

### Power-up system

Drops are 20% per kill / 35% for elites **at normal difficulty**, plus a guaranteed S+N+P trio from the mega-boss. The rate is computed by `powerUpDropRate(isElite, mode)` and shifts with difficulty (easy +5%, hard −5%, floored at 5%) — see "Difficulty shapes the economy". Power-up types:

| Type | Effect | Notes |
|------|--------|-------|
| S/N/P | Permanent level (`game.lvl`) | Capped by `MAX_POWER_LVL = {S:5, N:3, P:3}`. **Reset to 1/1/1 in `killPlayer()`** |
| T | `slowTimer` — enemy bullets 0.4× | 360 frames |
| R | `rapidTimer` — fire cooldown halved | 360 frames |
| W | `waveTimer` — bullets zigzag | 360 frames |
| H | `homingTimer` — bullets steer toward enemies | 360 frames |
| L | `laserTimer` — piercing beam, 1.4× speed, +1 dmg | 300 frames (rare) |
| B | BOMB — instant: clear bullets + 1 dmg all + 5% maxHp on mega-bosses | One-shot |
| E | SHIELD — +1 absorb charge, max `SHIELD_MAX=3` | Consumed in `killPlayer` before life loss |

Visual: ship sprite changes with S/N/P levels via `drawPlayer(x, y, color, levels)` 4th param — engine flame size, winglet extensions, cockpit ring glow.

### Defensive layers

Multiple save mechanisms applied in priority order on fatal hit (`tryTriggerWitchTime` checked at bullet/dive vs player collision):

1. `cheatInvincible` (backtick toggle) — debug invincibility, absorbs all hits
2. `shieldCharges` — consumed first if available, brief iframes + green ring
3. WITCH TIME — 30-frame slow-mo window (slowMul 0.2×); if `dashTimer > 0` within window → save (no death), else death resolves. `witchCooldown = 720` between activations.
4. Dash i-frames — manual evasion via Shift (12 invincible frames)

DASH PARRY: during `dashTimer > 0`, enemy bullets passing through the player are deflected: removed + 50 score + cyan spark + "PARRY +50" text + metallic ping. Tracked via `game.parryCount`. PARRY STREAK chains within 90f for escalating tiers (cyan→gold→white-gold ULTRA at 10). **CLUSTER PARRY**: deflecting 3+ bullets in a *single* dash frame fires a gold banner + size-scaled hit-stop (4–8f) + `game.clusterParryBest`. PERFECT PARRY: deflect within first 3 frames of dash → +50 + gold "PERFECT".

**Dual fighter as a life buffer**: when `game.dualFighter` is true, a fatal hit downgrades to single (`dualFighter = false`) and enters RESPAWN **without** spending a life or recording a death-cause tally — the wingman absorbs the cost. `stageDied` is still set (the stage is no longer clean), so grade/CLEAN STREAK treat it as a hit.

**REVENGE**: `killPlayer(srcX, srcY, cause, srcType)` seeds `game._revengeType` **only on a confirmed death** (after the cheat/shield early-returns), from the colliding enemy's type or the killing bullet's `fromType`. The next kill of that type fires "REVENGE!" + `revengeCount` (+ lifetime `galagaRevengeTotal`). Pairs with the respawn DEATH RECAP whisper (cause-specific coaching line).

### Combo system

`bumpCombo()` increments on kill. Multiplier tiers: c≥3 (1.25×), c≥5 (1.5×), c≥10 (2×), c≥15 (2.5×), c≥20 (3×, max). Decays after `COMBO_DECAY=90` frames without a kill.

**COMBO ARSENAL** auto-triggers at thresholds (25/50/75/100): grants free 3-sec RAPID / WAVE / HOMING / LASER respectively. Uses `Math.max` against existing timer so pickup-set timers aren't shortened. `comboArsenalClaimed` Set resets on combo break.

`COMBO_MILESTONE = 40` — extra ship granted every 40 combo (or +5000 in challenge mode).

**GRAZE COMBO GRACE**: a near-miss (graze) while combo ≥ 5 refreshes `comboTimer` by +20f (capped at `COMBO_DECAY`) so skilled dodging bridges kill gaps without dropping the multiplier. Only extends, never grows the combo (kills do that), and the 24f near-miss cooldown prevents farming. Surfaces "COMBO HELD" only when the timer was actually in danger (< 40).

### Dynamic systems (set per-stage, read per-frame)

- **`stageMutation`** (`rapidFire | fastDives | slowBullets | denseFire`, 30% / normal stages only) — flips one rule for the whole stage. Read sites: `updatePlayer` (rapidFire fire cd), `updateEnemies` diving branch (fastDives pathSpeed), `updateBullets` enemy slowMul (slowBullets), `diffFireMul` (denseFire).
- **`stageBiome`** (`biomeForStage(stage)`, stage 8+, 12-cycle, 4 stages each) — `planet | ruins | dawn | asteroid | desert | ice | gasGiant | corona | canyon | blackhole | nebula | starfield` (interleaves terrestrial biomes among the space ones). Drawn in `drawBiome()` between nebulae and stars; each has a `BIOME_NAMES` label/color and a `BIOME_WHISPERS` set.
- **`ambientEvent`** (`cargoShip | supernova | satellite | comet | pulsar | meteorShower`, 35% / stage > 3) — atmospheric one-shot. Ticked in `updateAmbientEvent`.
- **`worldCorruption`** (computed from stage) — scales 0→1 over stages 30-80. Adds edge noise / glitch bars / corner haze. Drawn after game content, before scanlines.
- **Difficulty shapes the economy** — beyond speed/fire scaling (`diffSpeedMul`/`diffFireMul`), difficulty shifts loot: `eliteRateForStage(stage, mode)` scales elite spawns (hard ×1.5 / easy ×0.5) and `powerUpDropRate(isElite, mode)` shifts drops (hard −5% / easy +5%, floored 5%). `difficultyDescriptor(mode)` surfaces the trade-off as G-toggle feedback so it's legible. Both rate fns are pure/extracted for testability.

### Narrative layer

- **`TRANSMISSION_LOGS`** — typed-out 3-line beats during STAGE_INTRO at stages 5/10/15/20/25/30/40/50/60/70/80.
- **`BOSS_NAMES`** — 8 unique names (THE OVERSEER, TWIN SOVEREIGNS, APEX, THE DEVOURER, IRON SWARM, NULLIFIER, OBSIDIAN PRIME, THE FINAL WALL), cycled past stage 90.
- **`BOSS_TAUNTS`** — dialogue dictionary keyed by archetype × situation (intro/phase2/lowHp/dash/death/finalStand). Only the 4 base archetypes have entries; `tauntFor(archetype, situation)` falls back to `standard` for `phantom`/`rune` and returns `null` for an absent situation (never throws). Speech bubble above boss, fades over 90 frames.
- **`EPITAPHS`** — 7 stage-tier buckets (rookie/scout/veteran/deepDive/apex/voidwalker/legend) × 3 variants. `pickEpitaph(stage, acc)` runs once at game over, stored on `game.runEpitaph`.
- **`pickRunHighlights()`** — top 3 stats (max combo / parries / graze chain / cluster parry / revenge / flawless boss / stages / bosses / accuracy / dual fighter / elites …) sorted by priority, displayed below epitaph.
- **Faction MORALE vs PILOT MOMENTUM** — two mirrored psychological gauges. `updateEnemyMorale()` swings enemy state (CONFIDENT/NORMAL/SHAKEN/ROUTED) off player performance — surfaced via the HUD morale chip + shift banner and, audibly, **MORALE TONE** (`moraleDiveDetune`, tested): formation/kamikaze dive SFX detune by morale (CONFIDENT lower/menacing → ROUTED higher/frantic; boss attacks omit it); `computePilotMomentum()` reads the player's own composure (ASCENDING = combo ≥ 20 + clean streak ≥ 3 / CORNERED = last life / STRAINED = post-death low combo / STEADY). PILOT MOMENTUM expresses across **6 channels**: STAGE_INTRO chip, HUD chip, ASCENDING ship spark-aura, ASCENDING BGM intensity lift (`computeBgmIntensity`), CORNERED nebula red-tint, and a transition banner (`updatePilotMomentum`, mirrors the MORALE shift banner).

### Player identity

`playerCallsign` — 3-letter monogram persisted to `galagaCallsign`. Editor at TITLE via 'U' (arrows + Enter). Displayed on TITLE, HUD (1UP corner), and RUN HIGHLIGHTS header.

### Audio

Sound is generated live through Web Audio (`AudioContext`). `playSound(type, panX)` synthesizes one-shot SFX from oscillators / noise buffers. BGM is a self-rescheduling note scheduler (`scheduleBGMNotes`) that looks ahead 0.4s and re-arms via `setTimeout` every 120 ms — there are no audio files. `ensureAudio()` lazy-creates the context on first user input to satisfy autoplay policies; preserve that gate when adding new sound triggers.

**SPATIAL SFX** — `playSound`'s optional `panX` (a screen x) routes the sound through a per-shot `StereoPanner` placed by `panForX(x)` (pure: `0..BASE_W` → `[-0.85, 0.85]`, softened, clamps, non-numeric → 0 centered). Omitting `panX` keeps the sound centered (UI / player-frame / global cues), and the panner is gated on `createStereoPanner` support. Positional combat events pass it (enemy explode/hit/crit, formation & kamikaze dives, all 6 boss signature attacks via `mb.x`, and the positional `graze`-ping events — near-miss/parry-deflect via `b.x`, revenge/ghost-reveal via `e.x`); player fire, pickups, milestones, dash-ready/supply-drop cues, and the player's own death stay centered. **PER-SHOT PITCH VARIATION** — types in the `SFX_VARY` set (`shoot/hit/explode/crit/enemyDive/graze`) get a `±SFX_DETUNE_CENTS` (55) random `o.detune` per trigger so rapid repeats aren't mechanically identical; melodic/sequenced cues (milestone/fanfare/comboStep) are deliberately excluded so they stay in tune. `panForX` / `SFX_VARY` / the `playSound` branches are covered by the logic tests. **COMBO HARMONICS** — `playSound`'s optional 3rd arg `detuneAdd` (cents) composes additively with the `SFX_VARY` wobble; the three enemy-kill SFX sites (`explode`/`crit`) pass `comboKillDetune(game.combo)` (pure, tested: linear ramp to a +300-cent cap at combo 30), so a kill chain audibly rises in pitch and drops back on combo break. Player-death / boss / bomb explosions omit it and stay at base pitch.

BGM tracks have 5 voices: `lead` (square/saw, detuned chorus) + `bass` (triangle) + `pad` (sine, polyphonic root+fifth+octave) + `kick` + `hat`. The bus has a feedback delay (250ms, 0.32 fb, 0.30 wet) for spatial depth.

**DYNAMIC BGM INTENSITY** (`computeBgmIntensity()`) — multiplies lead voice volume by 1.0×–1.55× based on combo level, boss phase 2, and last-life urgency. Force-enables hat layer when intensity ≥ 1.30. Snapshotted once per scheduler tick (~120ms) for phrase coherence.

`bgmForGameState(state)` selects track: `normal | boss | bossEnrage | bossSuper | title`.

### Persistence

`localStorage` holds 60+ keys, all prefixed `galaga*`:
- Scoring: `galagaHigh`, `galagaTopScoresNormal/Challenge/Daily`, `galagaCumStats[Challenge]`, `galagaBestTimes`, `galagaBonusWins`
- Mode/settings: `galagaDaily`, `galagaChallenge`, `galagaShip`, `galagaDifficulty`, `galagaMute`, `galagaBGMOff`, `galagaSFXOff`, `galagaVol`, `galagaShake`, `galagaRumble`, `galagaColorBlind`, `galagaNightOff`, `galagaCheckpoint`, `galagaIntroSeen`
- Progression: `galagaAchievements`, `galagaDexUnlocked`, `galagaCallsign`, `galagaDailyDays`, `galagaShipsUsed`, `galagaDifficultiesUsed`
- Lifetime skill stats (each a running total/peak): `galagaParryTotal`, `galagaNearMissTotal`, `galagaGrazeChainBest`, `galagaCleanStreakBest`, `galagaRevengeTotal`, `galagaFlawlessBosses`, `galagaWitchSaves`, `galagaPBBeats`, `galagaEliteKills`, `galagaStageGrades`, `galagaKillsByType`, `galagaPickupTotals`, `galagaBiomeVisits`, `galagaDeathCauses`, … (grep `galaga` for the full set)

Each read site uses `try/catch` and falls back to a default — corrupt storage is non-fatal.

### Input

- Keyboard: `ArrowLeft/Right` / `A/D` (move), `Space` (fire/start), `Shift` (dash), `P`/`Esc` (pause). Normalized via `normalizeKey(e)` using `e.code` so layout (Hangul/Cyrillic etc.) doesn't break letter hotkeys.
- Gamepad: left stick / D-pad horizontal, A-button fire, Start pause — polled in `pollGamepad()` at the top of `update()`. Synthesizes the same `keys` map keyboard uses.
- Touch: `#touchControls` shown only when `'ontouchstart' in window`. Joystick on the left, fire/pause buttons on the right. Synthesizes same `keys` map.

Player firing is rate-capped via `game.fireCooldown` (6 frames base, halved by R rapid pickup, further reduced by stageMutation 'rapidFire', min 2 frames).

**Fire-as-action in non-PLAYING states** (BONUS_GAME skill-stop, STAGE_INTRO skip) is detected by **polling `keys[' ']`/`keys['Enter']` with rising-edge tracking inside `update()`**, NOT in the keydown handler. Keep it that way: keyboard, touch (`btnFire` → `keys[' ']`), and gamepad (`pollGamepad`) all feed the same `keys` map, so polling makes these actions work on every input device for free, and the edge-tracking flag (e.g. `_introSkipPrev`, `bonusGame._firePrev`) ensures a held fire button triggers the action only once.

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

- **Shared single-source helpers — use these, don't re-inline the formula** (each is logic-tested): `stageModeFor(stage)` (boss/challenge/normal dispatch), `isCombatState()` (the `PLAYING || CHALLENGING || BOSS_STAGE` gate, used by per-frame timers/morale/BGM), `computeAccuracy(stats)` (hit %, zero-shot-safe) + `computeStageAccuracy()` (same on the current stage's tallies — used by per-stage grade/bonus/HUD), `computeRunGradeScore` + `runGradeLetter` (GAME_OVER grade letter and its audio cue), `comboTierName(combo)` (combo medal label for HUD + carry banner), `comboTierColor(mult)` (combo multiplier tier color — HUD readout / score-pop / carry banner share it), `panForX(x)` (spatial-SFX stereo pan), and the `EXTRA_LIFE_SCORE` constant. These were extracted from 2–35 duplicated inline sites; re-inlining reintroduces drift.
- Game tuning constants are mostly at the top of the script (`PLAYER_SPEED`, `BULLET_SPEED`, `BOSS_STAGE_INTERVAL`, `EXTRA_LIFE_SCORE`, `STAR_COUNT`, `MILESTONE_STAGES`) or grouped near the relevant function (`SHIELD_MAX`, `SLOW/RAPID/WAVE/HOMING/LASER_DURATION`, `WITCH_WINDOW=30`, `WITCH_COOLDOWN=720`, `COMBO_DECAY=90`, `COMBO_MILESTONE=40`). Per-ship caps live on `SHIPS[*].bulletCap` and difficulty scales speed/fire-rate via `diffSpeedMul()` / `diffFireMul()`. Difficulty scaling typically multiplies by `game.stage`.
- Sprite art is drawn procedurally via `ctx.fillRect` calls in `drawPlayer` / `drawBee` / `drawButterfly` / `drawBoss` / `drawMegaBoss` / `drawPlayerBullet` / etc. There are no image assets.
- Hit detection is AABB with hardcoded half-extents (commonly `8 × 8` for bullets-vs-enemies, `7` or `16` for the player depending on `dualFighter`). When changing sprite size, update the corresponding collision constants too.
- **Draw functions must NOT mutate game state.** Camera/effect timers (`zoomPulse`, `cinematicBars`, `camNudgeX/Y`, `comboLostFlashTimer`, `highScoreGlow`, `worldCorruption`-driven counters) all tick in `update()` under a PAUSED guard. If you add a timer-driven visual, add its decrement next to those.
- `BOSS_STAGE_INTERVAL = 10` is the production cadence — confirm with the user before changing stage cadence.
- The `bgmTimerId` global tracks the in-flight scheduler timer; `stopBGM` clears it. When changing tracks via `startBGM`, the old scheduler chain is severed and the audio bus fades over `BGM_FADE = 0.35s` before disconnecting.
