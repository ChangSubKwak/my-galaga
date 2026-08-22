# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visual design
Read **`DESIGN.md`** before any visual/color change. The current aesthetic direction is
**NEON VECTOR BLOOM** (Geometry Wars / Rez lineage): a deep-black void with an electric
full-frame **bloom** post-process (tail of `draw()`, device-pixel `'lighter'` +
`ctx.filter` blur, gated on `bloomEnabled`/`galagaBloomOff`) so every bright element
sheds a glow halo, plus vivid neon emissives. This *evolved from* the earlier **Ink
Minimal Noir** (near-black void + white + crimson) — the dark void, crimson accent,
noir chrome, and daylight ground biomes all STAY as the foundation; the pivot adds
energy (bloom + neon), because flat noir read as "too flat/drab." Keep the background
dark (glow needs black) and let the bloom be the outline — don't fight it with heavy
strokes on bright shapes. Gameplay-functional color-coding (enemy types, power-ups,
grades, elite/ghost, shield/dash/witch-time semantics) is PRESERVED for legibility.
See DESIGN.md for the palette, the bloom system, and the staged neon passes (bloom
shipped; combat-palette/sprite-emissive/trail passes pending).

## Running the game

The entire game is a single static file. To play:

- Open `index.html` directly in a browser, or
- Serve the directory: `python3 -m http.server 8000` then visit `http://localhost:8000/`

There is no build step, no package manager, and no lint config. All game code goes into `index.html`. After every meaningful change, run the full verification (JS parse + logic tests) in one command:

```bash
bash test/run.sh        # JS parse + logic tests + layout audit + fresh boot; exit 0 only if all pass
```

`test/fresh-boot.js` (step 4) covers the **first-time player**: it boots a sandbox whose
localStorage is genuinely empty, then runs init plus a real driven session. The game
reads storage in 112 places, each behind a try/catch and a default, and nothing checked
that a virgin profile actually starts — the main suite's sandbox accumulates keys as it
runs and the layout audit deliberately seeds a maxed profile, so the most common first
experience was the one path never exercised end to end. Mutation-verified: making a
single default dereference its null read fails the boot immediately.

It also boots a second sandbox with **every** `galaga*` key filled with garbage (broken
JSON, wrong type, empty string, a 4KB string) and plays from it. A corrupted profile is
the worse sibling of an empty one: the player is locked out *permanently*, since every
reload hits the same throw. The older corrupt-storage test covers 5 keys through 2
functions and cannot see the boot path, where ~36 keys are read by module-level
initialisers before any of that runs. Mutation-verified too — one loader that trusts
stored JSON is enough to fail it.

`test/layout-audit.js` (step 3) catches **text that renders permanently off-screen** —
the failure mode a canvas game with no layout engine cannot otherwise detect without a
browser. It runs the real `draw()` across all 18 screens/overlay pages, records every
text draw through a transform-tracking stub, and computes true pixel widths from the
measured font advances, under **both** font configurations (the monospace fallback shown
before the pixel faces load, and the loaded pixel pair). Three properties make it
trustworthy, each added after it produced a false result:
- it tracks the **full transform stack** (without it, everything drawn inside a
  `translate()` is reported as wildly off-screen);
- it judges a string by its **minimum overflow across the whole run, keyed by the string
  not the screen** — banners and toasts deliberately slide in from outside, so the real
  question is "was this ever fully visible?";
- it runs on a **seeded PRNG**, because an unseeded run samples different frames each
  time and can miss a real overflow (it did exactly that once).

Or run either half on its own:

```bash
# 1) syntax check the inline <script>
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('JS parse OK');"
# 2) logic tests only
node test/logic.test.js   # exit 0 = pass, 1 = failure
```

### Logic tests

A standalone Node harness lives at `test/logic.test.js` (1,140+ assertions, no test
framework or dependencies). It extracts the inline `<script>`, runs it inside a
`vm` sandbox with hand-rolled browser-API stubs (canvas/2d ctx, `localStorage`,
`document`, `window`, `AudioContext` — including `createStereoPanner` / node
`detune`, RAF), and asserts pure-ish logic plus registry-consistency invariants:
`evalBonusResult`, `bonusSkillStop`, `checkPbHalfMark`,
`killPlayer` revenge-seeding, `addScore` extra-life/cap, `comboMultiplier`/
`bumpCombo`, `bezierPoint` + `createEntryPath`/`createLoopPath`, `eliteRateForStage`/
`powerUpDropRate`, `fmtScore`/`fmtFrameTime`/`fmtMS`, `computeAccuracy`,
`computeRunGradeScore`/`runGradeLetter`, `comboTierName`, `stageModeFor`,
`isCombatState`, `computeBgmIntensity`/`computeBgmPitch`/`bgmForGameState`,
`computeDailyStreak`, the pilot rank ladder + composite
completion, daily-mode determinism, `panForX`/`SFX_VARY` (spatial-audio curve +
pitch-wobble set), the stats-overlay page model (`statsAchGridPages`/
`statsTotalPages`), corrupt-storage robustness, and **data-registry guards** that
each entry stays wired on both sides — INTERCEPT_MSG,
STAGE_MUTATIONS (id↔read-site), ACT_TITLES (contiguous ranges),
ENDURANCE_TIERS (ascending), COMBO_ARSENAL (buff↔timer), ACHIEVEMENTS
(every definition has an `unlockAchievement()` call and vice-versa — scanned from
source text so an unreachable or dead achievement can't slip in), plus STATE / PERK /
boss-archetype / biome / weather / ship / enemy entries (so extending a registry
can't silently half-break). Also covers the **four persistence paths**
(`submitTopScore`/`loadTopScores` leaderboard sort/cap/rank/galagaHigh-sync +
corrupt-JSON graceful, `commitGameToCumStats` demo-guard + accumulation + last-run,
`recordStagePB` strictly-faster-only, `unlockDex` valid-only/idempotent), the
shared `tryStartDash` gating (cooldown/i-frames/combat), the `comboTierColor` /
`comboKillDetune` / `flashAlpha` / `effectiveShakeMul` /
`blinkPhase` / `computeStageAccuracy` helpers, and `POWERUP_COL` / `GRADE_COL`
completeness guards. Also covers the pure math/random utility helpers
(`aabbHit` symmetric-box overlap, `clamp01` saturate-to-[0,1], `jitter` symmetric
random offset, `randInt` integer-in-[0,n), `magnitude` Euclidean length — each
with edge cases + a sample-based identity check against the inlined form it
replaced) and the **boss-taunt voice guard** (`tauntFor` — every one of the 6
archetypes has a complete, non-empty voice distinct from `standard`, while an
unknown archetype still falls back to `standard`).

Note: top-level `let`/`const` bindings (e.g. `game`, `stagePBs`, `SHIPS`) are not
visible on the vm context global — the harness appends accessor shims (`__getGame`,
`__getStagePBs`, `__getShips`...) to reach them. Add new shims there if a test
needs another closure binding. This covers logic only; visual/feel changes still
need a browser.

## Architecture

### Single-file structure

`index.html` (~22,500 lines) contains the entire game: HTML shell, CSS, and an inline `<script>` block that holds all game logic. The two `*.svg` files (`bullet_concepts.svg`, `bullet_readability.svg`) are design references for player-bullet visuals and are not loaded by the game.

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

Which enemy dives and which way its loop arcs are chosen by `mindPickDiver` /
`mindDiveSide` — with no read from THE SWARM MIND both degrade to the shipped behaviour
(uniform random pick, arc toward the playfield centre).

**WING TACTICS — the Dive Director**: on normal PLAYING stages the dive trigger sometimes launches a *coordinated maneuver* instead of a lone dive — a **PINCER** (2 flankers bracketing the player's *predicted* position) or a **WALL** (3 enemies descending line-abreast). Driven by pure, logic-tested helpers (`DIVE_TACTICS` registry, `chooseDiveTactic` / `predictIntercept` / `planPincerPair` / `planWallRun`; `launchDiveTactic` commits it). Coordination is a **legible state of the swarm**: likelier while the tactical commander is alive (`isCommander`) and **disabled entirely during formation panic** (`formationPanicked`) — so killing the commander or tripping the panic threshold visibly shatters coordination back to chaotic lone dives. Prediction uses `game.playerVX` (sim-rate, sampled after the clamp in `updatePlayer`) and is **playfield-clamped** (fairness — a pincer can never aim off-screen). Rides the EXISTING 30f→36f preview telegraph (`previewTimer`/`previewPath`/`previewMax`) + path-dots + swarm warning; `drawDivePreviewPaths` tints a maneuver's telegraph the biome colour and adds a colorblind-safe SHAPE marker (pincer chevron / wall bar). A `WING_COOLDOWN` after each maneuver prevents stacking (guards the mass-dive slowdown class). **ZERO new score** — coordinated dives only manufacture the multi-threat frames that parry / CLUSTER PARRY / witch-time / combo already reward. Fires a once-per-run-per-type enemy-comms intercept (`wingPincer`/`wingWall`), no banner. NOTE: `formationPanicked` is the independent panic mechanic — the old `enemyMorale`/`MORALE_STATES` were removed; WING TACTICS keys only off live panic + commander state.

`CHALLENGING` stages are different: enemies are pre-built into `game.challengeWaves` (8 waves × 16 enemies) by `setupChallengingStage()`. Collision code in `updateCollisions()` switches its enemy source between `game.enemies` and the active challenge wave (`game.challengeWaves[game.challengeWaveIdx]`).

`BOSS_STAGE` runs on the `game.megaBosses` array. Boss count scales by stage band (`setupBossStage`): 1 solo boss below stage 20, 2 reduced-HP bosses (0.65× each) at stages 20–29, and a single SUPER boss (2.5× HP, 1.5× scale, faster) at stage 30+. Each boss has an `archetype` (`standard | horned | tendril | crystal | phantom | rune`, cycled by `archetypeFor(stage)`) — affects color, decorations, and the archetype signature attack (split shot / laser sweep / fragment burst) fired on `sigTimer`. At 40% HP, `phase2` triggers METAMORPHOSIS: archetype morphs to the next in `morphMap`, `sigTimer` resets, BGM switches to `bossEnrage`, and a 24-frame freeze + ring burst cinematic plays. Each archetype has a `BOSS_TAUNTS` dialogue set; taunts fire at phase 2 entry / 25% HP / first dash.

### Enemy variety

14 entries in `ENEMY_INFO`: the 12 formation types `bee` / `butterfly` / `boss` / `mirror` / `splitter` / `shielded` / `ufo` / `hoverer` / `kamikaze` / `goldenBee` / `minibee` / `warper`, plus the two bespoke hostiles `rival` / `magpie`. (`warper` teleports while diving; it spawns from stage 8+ in place of a bee/butterfly.) Each has unique sprite, behavior, points, and (for several types: mirror/shielded/kamikaze/ufo) **type-specific death visuals** layered on top of base explosion. First kill of each type unlocks a `dexUnlocked` entry persisted to `galagaDexUnlocked` — viewable in the BESTIARY tab of the stats overlay. **Bespoke hostiles must opt in**: formation enemies are registered by the shared kill path, so a one-off entity has to call `unlockDex()` and bump `killsByTypeRun` / `stats.kills` / `stageKills` itself.

**Elite variants**: stage 5+ formation enemies of common types (bee/butterfly/mirror/kamikaze) have a 3-5% chance to spawn as `e.elite` — +1 HP, red pulsing outline + gold corner pips, 1.5× score, 35% drop rate (vs 20%), and a "ELITE!" floatText on kill. Tracked via `game.eliteKills`.

**Ghost variants**: deep-stage (60+) enemies have a 3% chance to spawn as `e.ghost` (mutually exclusive with elite). Ghosts render semi-invisible until the first hit flips `e.ghostRevealed`, score **2×** (the `ghost` factor in `killScore`), Tracked toward the GHOST SLAYER achievement (25 ghost kills). The per-kill ghost intercept and the 5-kill GHOST HUNTER badge were cut in the simplification pass.

### THE MANIFEST (was: one perk at a time)

`game.manifest` is an id→rank map drafted at every stage clear — see **THE
MEASURE**. The old `game.activePerk` scalar is GONE: read cards through
`hasPerk(id)` / `perkRank(id)` / `perkStep(id, perRank)`, never by comparing a
string. The bidirectional registry guard scans for those three call shapes, so a
card with no read site (or a read site with no card) fails the build.

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

### THE SWARM MIND — the formation profiles you, and you can lie to it

Every threat in this game is **rolled**: stage mutations, ambient events, elite/ghost
spawns, which enemy dives, which tactic fires. Nothing had ever adapted to *how you fly* —
the only trace of the player in enemy code was one frame of `playerVX`. THE SWARM MIND is
the first system that holds a **model of the player**: `game.swarmMind`, a decaying
histogram of which of `MIND_ZONES` (5) lanes the ship actually lives in. Once the read is
confident it **locks**, and dives converge on your habit instead of the playfield centre.

- Pure, logic-tested core: `mindZoneOf` / `mindZoneCenter` / `mindConfidence` /
  `mindFavoredZone` / `mindLocked` / `mindBiasedTarget` / `mindObserve` / `mindWipe`.
  Impure commit sites: `mindPickDiver` (which enemy dives), `mindDiveSide` (which way it
  arcs), `mindTagDive` (stamp the lane it was addressed to), `drawMindLock` (the bracket).
- `mindConfidence` is **normalised against uniform**, so a flat histogram scores exactly
  0 whatever `MIND_ZONES` is — the threshold means the same thing if the lanes change.
- `p.n` is the **decayed observation weight** (the histogram's own sum), not a raw frame
  count. This is what makes panic bite: weight saturates at `1/(1-d)` — ~333 under
  `MIND_DECAY` (0.997), but only ~17 under `MIND_PANIC_DECAY` (0.94), well under
  `MIND_MIN_SAMPLES` (90). *A raw count would have made panic strengthen the read* (a
  shorter memory of a camper is a purer memory) — the exact inversion the tests now pin.

**Three rules keep it a mind game instead of an unfair one. Preserve all three.**
1. **It is DRAWN.** `drawMindLock` brackets the profiled lane on the floor. Aiming at
   your habit is aiming at a place you can see — that is the whole difference between
   adaptive and cheating. A future "smarter" read that isn't rendered is not shippable.
2. **It changes WHERE, never HOW FAST.** Every telegraph keeps its budgeted length and
   the path still freezes at telegraph time. The driven test asserts the *shortest*
   preview observed under a hard lock is still ≥ `DIVE_PREVIEW`. See THE FAIRNESS BUDGET.
3. **It is BREAKABLE, three ways.** Killing the tactical commander **wipes** the profile
   (the commander finally has a reason to exist beyond a stat); `formationPanicked` drops
   the lock within ~20 frames; and leaving the bracketed lane after a mind-guided dive has
   committed sends it into empty air — a **BAIT** (`game.swarmBaited`, lifetime
   `galagaBaitTotal`, surfaced in run highlights).

**ZERO new score.** The payoff of a bait is the free frames, which parry / CLUSTER PARRY /
witch-time / combo already price; points on top would double-pay it. Fusion: WING TACTICS
(`wingInterceptForPool` is fed a mind-biased player position), commander, panic, biome tint
(`wingTacticColor`), FLIGHT SCHOOL (`mind` lesson), enemy comms (`mindLock`). No new actor,
so THE DIRECTOR's budget is untouched.

### THE KILLING FIELD — the swarm remembers its dead, and you herd it

THE SWARM MIND models the player; THE KILLING FIELD is the first system to model the
**consequences** of the player: `game.swarmDread`, the formation's decaying memory of
which lane its own members die in — the exact structural sibling of the mind (same
`MIND_ZONES` lanes, `mindZoneOf`/`mindZoneCenter`/`mindConfidence`/`mindFavoredZone`
reused verbatim; opposite subject — where you LIVE vs where they DIE). A lane whose
decayed casualty weight ≥ `DREAD_MIN_KILLS` (6) with share ≥ `DREAD_HOT_CONF` (0.50)
goes **hot**: lone dive arcs flip away from it (`dreadDiveSide`, a roll against capped
confidence — never a veto) and coordinated WING targets are pulled toward the nearest
cold lane (`dreadDeflectTarget`, pull ≤ `DREAD_AVOID` 0.75 × conf). So **kill placement
becomes an expressive input**: the player herds enemy attack routes by choosing where
to kill, and the swarm visibly stops flying into the gun and comes around it — deflected
targets land on the hot lane's SHOULDERS, so pressure moves, it does not vanish.

- Pure, logic-tested core: `makeSwarmDread` / `dreadObserve` (per formation kill, in
  the kill-commit path, PLAYING only — bespoke hostiles never feed it) / `dreadDecay`
  (per frame beside `mindObserve`; combat states only, so the grave **persists through
  STAGE_INTRO** into the next wave; ~3s combat half-life) / `dreadHotZone` /
  `nearestColdLane` / `dreadDeflectTarget` / `dreadDiveSide`. Impure commit sites:
  `dreadArcSide` (wraps `mindDiveSide` at both lone-dive launches), the `targetX` line
  in `launchDiveTactic`, `dreadMarkHerd`, `drawDreadField`.

**The mind's three rules apply unchanged — preserve them here too.**
1. **DRAWN** — `drawDreadField` marks the hot lane with flickering ember-orange X ticks
   (`#f80`, shape/colour/phase distinct from the mind bracket) on the same floor line;
   a herd flares them and slides a chevron toward the rerouted lane. Invisible until real.
2. **WHERE, never HOW FAST** — deflection runs **before** `createLoopPath` /
   `planPincerPair`, so the frozen telegraph shows the true path and every preview keeps
   its budgeted length (the existing SWARM MIND driven shortest-preview guard covers it).
3. **BREAKABLE** — kill elsewhere (~3s cooling); formation panic collapses it (same
   decayed-weight inversion-proofing as the mind: under `DREAD_PANIC_DECAY` 0.94 the
   weight saturates far below the gate — test-pinned); and a **live commander HALVES the
   deflection** — the first reason to ever *spare* the commander (keep the swarm
   disciplined and dives keep entering your kill zone; kill it and you blind the swarm
   but unleash its fear).

**ZERO new score.** Payoff is routing + the multi-threat flank frames parry/witch-time/
combo already price. Herded dives stamp `_mindZone = -1` via `_dreadHerded` so they can
never be miscounted as BAITs. Tracked: `game.divesHerded` + lifetime `galagaHerdTotal`
(demo-guarded), DIVES HERDED run highlight, `dreadRoute` intercept (once/run),
`COACH_LESSONS.dread`. Debug stage-jumps (`,`/`.`/1–9) reset the field (adjacent-stage
memory only). No new actor, so THE DIRECTOR's budget is untouched.

### THE DEBRIEF — the challenge round is the swarm's filmed drill

Every adaptive system (mind/dread/heist/wing tactics) lived only in normal PLAYING
stages — the challenge round was a dead zone in the game's most distinctive dimension.
THE DEBRIEF opens the run's first **information channel flowing challenge→combat**:
`game.drillLog` (raw per-stage lane histogram — footage, not memory: no decay) records
where you fly the drill; after waves 3 and 6 clear (`debriefPlan`, clamped so nothing
schedules past the final wave), a **courier drone** descends into your footage-richest
lane (30f descend telegraph — the baseline; dashed column + mind-bracket glyph) and
uplinks for 150f. It never fires and never collides — **it costs information, not hits**.

Four flown answers: **DENY** (kill it in the descend — 3 HP, 0 points, intel dies
undelivered) / **STEAL** (kill it mid-uplink at wave-coverage cost → it drops the
swarm's own **LEDGER** on `salvageStep` physics; catch → `mindWipe` + `ledgerSight`
`LEDGER_SIGHT` (3600f): drawMindLock/drawDreadField render **below their thresholds**,
dashed/dim — you see the forming read and the forming fear) / **IGNORE** (uplink
completes → `mindSeed(swarmMind, lane, DEBRIEF_SEED_W)`) / **LIE** (fly the drill in a
lane you never fight in; the seeded mind converges on empty air and the existing BAIT
machinery prices it — zero new code). **`DEBRIEF_SEED_W` (60) < `MIND_MIN_SAMPLES` (90)
by construction**: footage warms the read, only live confirmation can lock it; panic
still collapses a seeded mind (test-pinned).

`salvageStep` gained an optional `fallCap` param (`LEDGER_FALL` 1.6) because the ledger
drops from drone height where the default 0.5px/f cap could never reach the lane inside
any TTL — the exact lane-vs-clock failure THE RECOVERY BUDGET documented; omitted → 0.5,
byte-identical shipped physics. **ZERO new score** (courier worth 0; deny cost is the
existing PERFECT WAVE / hits×100 economy). Comms: `debrief` **replaced the cut
`playerDown`** (every-death chatter at the one unreactable moment — the band's weakest
member; still 24/24, still capped). Tracked: `game.debriefsDenied` + lifetime
`galagaDebriefDeny` (demo-guarded), DEBRIEFS DENIED highlight, CENSOR achievement (10
lifetime), `COACH_LESSONS.debrief`. Also shipped: `playerHitHalf()` (the 5 duplicated
`dualFighter ? 16 : 7` collision ternaries collapsed to one helper; source-scan-pinned).

### THE OPEN WOUND — the boss fight gains an exposure/stagger axis

The mega-boss was a solved DPS wall: every shot interchangeable, phases just stat
changes. THE OPEN WOUND makes WHERE and WHEN you shoot matter: every **signature
commit** and every **dash recovery** (moments the player just survived — the
dodge→punish seams) calls `openVent(mb)`: the gun-port hangs open for
`ventWindowFor(breaks)` frames (`VENT_OPEN` 90 → shrinking `VENT_RAMP` 16 per break,
hard-floored `VENT_MIN` 42 ≥ the 30f baseline — **an opportunity shrinking is not a
warning shrinking**; test-pinned). The wound opens on the flank **away from the player**
— or, with a locked SWARM MIND read, away from the **profiled lane**
(`ventSideFor`): the swarm's intel reaches the boss tier, DEBRIEF uplinks and BAIT
lies echo into boss fights. Hits inside the band (`ventContains`, `VENT_HALF`×scale)
feed `mb.stagger` (`staggerStep`, `STAGGER_GAIN` 0.34 — 3 plain hits); meter full →
`breakBossStance`: `STAGGER_STUN` 120f of broken stance on the **existing
telegraph-freeze semantics** (`frozen` extended; phase triggers' `!frozen` guards
defer metamorphosis cleanly past a stagger). Metamorphosis resets `breaks` — the new
form's wounds are fresh.

**ZERO new score** — wound hits deal normal damage (driven test pins score delta 0);
the payoff is the earned silence. Ignoring the wound is fully viable. The price of a
wound run is flying the boss's own fire cone, priced by the existing
dash-parry/witch-time/shield ladder. `VENT_SLOW` only lowers boss speed while open.
Drawn: pulsing amber port + open-chevron + dashed drop-column + remaining-window arc;
stagger pips under the boss; broken stance slumps and greys. Narrative: **new
BOSS_TAUNTS situation `stagger`** across all 6 archetype voices (completeness test
extended) — no comms intercept (band stays 24/24). Tracked: `game.bossBreaks` +
lifetime `galagaBossBreakTotal` (demo-guarded), BOSS BREAKS highlight, BONE BREAKER
achievement, `COACH_LESSONS.vent`.

### THE IRON SHADOW — the world's first solid matter (occlusion)

In 23,000 lines no object ever blocked another — position meant dodging, never
SHELTER. THE IRON SHADOW makes the `cargoShip` ambient event (formerly documented "no
gameplay effect") **solid during normal PLAYING**: any bullet, enemy or player, crossing
its 40×10 hull is absorbed (`hullCrossed` — swept segment test, tunnel-proof at laser
speed, test-pinned). Its span projects onto the floor as a hatched **SHADOW BAND**
(shape-distinct from the mind bracket / dread X's). Spawn is banded mid-field
(`HULL_Y_MIN..MAX` 150–205), weighted 3-vs-1 among ambient types, and **DIRECTOR-gated**
(`directorAllows('gift')`, demotes to scenery when denied; a live hull occupies the
census as a gift).

**The three-way flown fork**: RIDE it (formation fire can't reach you — but your fire
can't reach them, combo starves, and the SWARM MIND profiles your hideout lane; dives
and WING pincers fly the **near plane, unblocked** — bullet-proof is never dive-proof,
that inversion is load-bearing) / RAID from it (kills land at the shadow's edges → THE
KILLING FIELD paints dread there and herds dives around your own cover) / **EXPEL it**
(player shots stress ×2 — 13 of your own rounds vent it early; the first time shooting
scenery means anything). Absorbing accumulates `ev.stress` (enemy +1, player +2, LASER
burns through once at +2 keeping its piercing identity); at `HULL_STRESS_CAP` (26) the
freighter VENTS — `HULL_VENT_WARN` (42f ≥ baseline; **still solid through the klaxon**,
warning precedes loss — inversion-guarded) then flees at `HULL_VENT_VX`.

**ZERO score** — absorbed bullets award nothing and deny the graze/parry income they
carried (shelter prices itself). `hullSpan` is null outside `STATE.PLAYING` (never a
boss-volley sponge or challenge leak — test-pinned). Comms: `ironShadow` **replaced the
cut `maxPower`** (pickup-moment chatter; band stays 24/24). Tracked: `game.hullBlocks`
(sheltered absorbs only) + lifetime `galagaHullBlockTotal` (demo-guarded), SHOTS
SHADOWED highlight, IRONCLAD achievement (50 lifetime), `COACH_LESSONS.cover`. Scorch
pips on the hull are the fuse, drawn before it blows.

### THE KEYSTONE — the formation is an architecture you dismantle

The title enemy was structurally INERT: five cosmetic shapes where no member was worth
more than another and killing order meant nothing but combo. Five leaps had layered
overlays *on* the formation; none made the formation itself readable. THE KEYSTONE
builds a **lattice** the instant the wall locks (`latticeBuild` at the `allEntered`
seam): a radius graph over **home positions only** — never `col`/`row`, which every
variant layout tags identically and which has broken row-keyed logic twice before.

- `latticeLinks(nodes, r, maxDeg)` — symmetric, `LAT_MAX_DEG` 4 nearest (grid pitch
  16×14 vs `LAT_LINK_R` 24 keeps it 4-connected, so a full wall has no keystones and the
  system is invisible until the player carves).
- `latticeCuts(adj, alive, minChunk)` — a node is a keystone iff removing it **increases
  the component count** (not a bare ">1 component" test — that would flag every member of
  an already-split formation like the circle variant's rings), and **the smaller piece**
  is the span that falls, only if it clears `LAT_MIN_CHUNK` (3). Taking the smallest piece
  that merely *clears* the gate inverts the mechanic — cutting beside a lone straggler
  would drop the entire rest of the wall. A driven test caught exactly that.
- `latticeStiffen(adj, cmdIdx, alive)` — **THE COMMAND NET**: while the commander lives it
  links to every member, annihilating the articulation points. The structure is uncuttable
  and draws NET INTACT. The commander finally gates something structural; unlocking the
  system costs the 360f DIVE SURGE and the mind wipe it already carried.
- `collapseStep` — the severed span stops breathing, diving and shooting (the existing
  state filters do all of it for free), and falls as **one rigid block** keeping the shape
  it had in the wall. ~190 frames of descent: 6× the 30f baseline. It is a ram threat
  through the existing ladder (`tryTriggerWitchTime` → shield → dash i-frames), so **zero
  new collision code**.

**Ordering finally matters**: you shoot upward, so reaching a keystone means punching a
COLUMN — camping one lane, which is precisely what THE SWARM MIND profiles and punishes.
Read → commander → column → keystone → burn the span. **ZERO new score, and collapse can
only ever LOSE you points**: every member that reaches the bottom is a kill forfeited
(`game.spanEscaped`). No actor spawns, so THE DIRECTOR is untouched; collapse defers while
a WING maneuver telegraphs (`diveTimer < 0`), and `LAT_COOLDOWN` 150 caps the rate.
Measured in ordinary play: 40-member wall, first keystone visible **7 kills** after the
commander falls, one span down per wall under purely random attrition.

Comms: `collapse` **replaced the cut `firstBlood`** (fired on the first kill of every run —
not rare, no reaction, duplicated the kill's own explosion and the achievement beside it;
band stays 24/24). Tracked: `game.spansDropped`/`spanEscaped` + lifetime `galagaSpanTotal`
(demo-guarded), SPANS DROPPED highlight, SPAN BREAKER achievement (a span of 6+),
`COACH_LESSONS.keystone`.

### (RETIRED) THE REDOUBT — the loadout gains a coordinate

**Deleted 2026-08-23, by its own instrument.** It turned a shield charge into a
wall you planted by bracing. `loadout-audit.js` measured the SUPPLY that feeds it:
about THREE charges in a five-minute run — and a charge is worth more as a SHIELD,
which absorbs a death, than as a 22px wall that expires in ten seconds. So plants
in real play were 0–1 per run, each costing the player the thing the wall was made
of. It also owned half a landmine: `tryTriggerWitchTime` returns false whenever a
wall stands, so PLANTING ONE SUPPRESSED the save window it was meant to complement
— the same defect class that got VAMPIRE cut from the card pool.

**The idea survives**: the loadout should be something you AIM rather than a scalar
you never touch. That is what THE MANIFEST does, at the scale of a whole run.

### THE MANNING AXIS — the model and the picture describe the same wall

What survives of THE EBB, and it is the half that mattered. THE KEYSTONE shipped
with **the drawn wall and the computed wall describing different objects**:
`drawLattice` judged membership by `alive && state === 'formation'`,
`latticeRecompute` by `alive` alone — so while a squad was diving the player saw a
hole in the struts the model did not have, and when the commander itself dove,
`drawLattice` rendered **nothing at all**.

- `latticeRecompute` judges with `latticeStanding` (a diver, a capture holder or a
  falling span holds nothing) and **always recomputes it** — `L.standing` is a
  change-detection cache only; reusing it as the source freezes the model.
- A **manning seam** in `updateEnemies` recomputes on the frame manning changes
  (`standingChanged`, elementwise), not only when something dies.
- **The score invariant**: a `collapsing` member used to be scored as a diver —
  bee 50→100, boss 150→400 — so cutting a span was a **2×–2.67× score multiplier**,
  falsifying THE KEYSTONE's documented "collapse can only ever COST points".
  `inForm` includes `collapsing`.
- Diamonds render only when a cut is genuinely armed (`!L.cool && !wingTelegraphing()`).

**THE SORTIE REWARD WAS RETIRED (2026-08-23).** `ebb-audit.js` reported 5 windows
opened and **none cuttable** — an intact 4-connected grid has no articulation
points, so a sortie's hole makes an *already carved* wall fragile rather than
creating keystones on a full one. The doctrine that entry itself wrote ("ARMED near
zero must be fixed **structurally**, never by rewarding a thing that does not
happen") was applied to it: `ebbCuts`, the SORTIE CUTS highlight, BREACH LEADER,
`COACH_LESSONS.ebb`, THE SOCKET and `ebb-audit.js` are gone. The coherence fix above
stands on its own, exactly as that entry predicted it would.

### THE MEASURE — the modern reform (music + graphics + gameplay, one idea)

A 16-agent design panel (4 recon, 5 concept lenses, 3 judges, 3 red teams, 1
synthesis) was asked for a modern-trend reform. Two of three judges picked a
beat-clock concept; **all three red teams returned FATAL, and every one of those
FATALs landed on the concept's SCORE CURRENCY, not on its clock.** So the clock
shipped and the currency was deleted before it was written. That split is the
whole design, and it is the rule to read before touching any of this:

> **THE BAR owns WHEN.** It never owns how long a warning lasts, how much a shot
> does, or what anything scores.
> **THE MANIFEST owns WHAT.** `comboMultiplier` keeps the score multiplier.

```bash
node test/measure-audit.js   # report: clock / authorship / arrangement / rhythm
```

#### THE BAR — one clock, and it is `game.animFrame`
`SIM_BPM 150` / `BEAT_FRAMES 24` / `BAR_FRAMES 96`, and `beatPhase(frame)` is a
pure function of the frame counter. **Never derive tempo from `BGM[bgmTrack].bpm`.**
`bgmTrack` is null whenever audio has not started, is muted, or is paused, so that
read is `undefined` → NaN — and a NaN reaching a telegraph makes
`if (previewTimer > 0)` FALSE, firing the threat with ZERO warning. That is the
fairness budget inverted through its own front door. `animFrame` advances in both
`gameLoop` branches, resets only in `resetGame`, and is frozen-clock safe in every
harness, so **the beat exists with the sound off** — the only condition under which
a rhythm may touch the simulation.

Dive launches snap to the next beat. **The snap must stay cadence-neutral by
CARRY**: subtract the interval (`diveTimer -= diveInterval`), never zero it, and
the wing path must `-= WING_COOLDOWN` rather than assign. A driven probe (trigger
events, 5 stages × 6 seeds) measured the assigning form losing 2.0–4.3% of
triggers per minute at *every* stage — all five negative, the signature of
systematic loss. After: −0.7% to +2.5%, signs mixed. 100% of triggers land on the
grid, against 0–18% before.

#### THE STEMS + THE BAR GRID — the mix, and the arrangement
Four stem buses (`drum` / `bass` / `harm` / `lead`), a persistent `bgmDuck`
sidechain **below** `bgmGain` (the old capture-cutscene duck wrote `bgmGain`
directly — the same param `applyVolume()` rewrites, so any volume keypress
cancelled it permanently), a master limiter, a tempo-synced dotted-eighth echo
with a lowpass in the feedback path, and **percussion off the echo send**. `B`
now stops the *scheduler*, not just a gain: it was allocating ~50–80 nodes a
second forever to render silence.

`normal` and `normalMid` are re-cut to **eight shared bars at 150 bpm**. Measured
before: `normal`'s lead ran **35.25 beats** — not a whole bar, not a whole beat —
against a 16-beat bass and a 32-beat pad, realigning once every 4,512 beats
(~29 minutes), so the chord progression the comments advertised did not exist.
150 bpm is load-bearing: 24 frames a beat, 96 a bar, the same grid the simulation
runs on, so the audible kick lands on the frame of the visible floor pulse.
**Boss tracks keep their own tempos deliberately** — the sim bar stays 96 frames,
so a boss fight's visuals pulse slower than its music, which is correct because
that is where the flash hazard would live.

`stemMask(ranks, combo, bossTrack)` makes **the manifest the arrangement**: drums
and bass always, the pad with your first card, the melody with your third.
**Two ways in, always** — every layer also opens on combo, because declining
every draft is a legitimate style and a rhythm channel must never be the only
route to anything. Boss tracks ignore the mask.

#### THE DRAFT + THE MANIFEST — the run is authored
`game.manifest` is an id→rank map; taking a card you hold **raises** it. Fifteen
cards, each an additive modifier on existing plumbing, each read at one site via
`hasPerk` / `perkRank` / `perkStep`. The offer runs at **every** stage clear
through the single shared `advanceToNextStage()` (all three clear paths carried
identical copies of that block, which is exactly why authorship had only ever
been wired into the boss one).

Rules that are red-team or measurement findings — do not "simplify" them away:
- **Score-bearing cards cap at rank 1** (`maxRank`). PARRY DIVIDEND, GHOST WAKE
  and BOUNTY HUNTER multiply POINTS; curve-audit measured the economy with them
  at their shipped values.
- **No card writes `game.shieldCharges`.** `tryTriggerWitchTime` returns false
  whenever it is non-zero, so once cards stack, a card whose trigger is the kill
  counter permanently disables WITCH TIME. That is why VAMPIRE was cut; the suite
  pins it with a driven test that holds the entire pool for 3000 frames.
- **Modal, inside STAGE_INTRO.** The intro HOLDS at its last frame while cards
  are up, so a 55%-black scrim is never composited over live bullets, and the
  hold ends the instant the player commits.
- **Commit is a PRESS, polled from the shared keys map.** Expiry takes nothing.
  The old auto-take meant a lateral dodge during a hazard telegraph could rewrite
  your build. Fly-to-choose was deleted: STAGE_INTRO never calls `updatePlayer`,
  so that hover was frozen.
- **`DRAFT_ARM` (one beat) before a commit is accepted.** pulse-audit measured the
  draft's longest life at SIX FRAMES without it — a player mashing fire took the
  middle card before the three had faded in.
- **`pickPerkOffer` filters maxed ids**, and `offerDraft()` declines to open a
  window it cannot fill.

#### THE LIGHT — a bloom that blooms
A **soft-knee bright pass**: keep the downsampled buffer in linear and squared
form and add both back at k and (1−k), `drawImage` only (`ctx.filter` stays banned
after four whiteout regressions), and **after** the `copy` drawImage — doing it
before multiplies against the previous frame's stale content. Plus a second wider
octave, because the buffer is smaller than the game's own 224×288.

**The alpha budget is a whiteout guard and it is arithmetic.** The three draws add
`A*(KNEE*L² + (1−KNEE)*L + OCT*L²)`, i.e. `A*1.40` at L=1, so A sits at 0.22 to
hold the peak at the ~0.38 the old single pass had. What changes is the
distribution: at L=0.13 the same formula adds 0.015 where the old pass added
0.049. Same energy on bright things, three times less veiling glare on dark ones.
The grid's `BASE_A` could then rise 0.17 → 0.26 honestly.

Three full-screen washes (witch / boss phase-2 / slow-time) collapsed into **one
state border**: hue says which state, brightness breathes on the bar.

#### The photosensitivity ceiling — never raise this
**No full-frame luminance channel exceeds 0.625 Hz or ±0.03 alpha, and all of
them multiply by `motionScale()`** (0.25 under `reduceMotion`). Verified hazard
being designed out: `bossEnrage`'s kick is 0.5 beats at 295 bpm = **9.83 Hz** and
`boss` is **7.0 Hz**, both more than 3× the WCAG 2.3.1 flash threshold, on an
additive full-screen buffer. The BAR is the only rate slow enough to be safe at
every tempo the game will ever run. Small local elements (a 1px band, a telegraph
rect, an enemy outline) may still pulse faster — that is a different hazard class,
and the suite scans for the *combination* of a fast pulse with a full-frame fill.

#### ON-BEAT DASH — the one rhythm verb, and it cannot be bought
**On-beat FIRE was cut**, and this is why: `computeFireCooldown` floors at 2
frames against a 24-frame beat, so at cooldown 3 there is a shot within 1.5
frames of every grid tick — a RAPID pickup, a 30%-chance stage mutation or one
card would buy the rhythm outright, and for everyone else the *cooldown* picks the
frame, not the player. The dash is discrete, deliberate, and sits behind a
60-frame cooldown against a 24-frame beat. A dash within ±`BEAT_WINDOW` (3) of a
beat gets **+2 i-frames and +2 dash frames**. It pays in FRAMES, never points —
`grep 'game.sync'` must return nothing but a comment. The dash-ready pip lights
inside the window so the verb is playable with the sound off. **THE STRUGGLE is
explicitly out of scope**: its tuning was measured, and putting the beat on it
would make a deaf player pay the life they currently keep.

Measured today: a deliberate dasher lands 100% on beat against 28% for a random
one — a 72-point gap that is pure timing. **If that gap ever falls under ~15, the
verb is decoration and the fix is structural, never a bigger reward.**

#### The gate is deterministic now, and that came first
`test/logic.test.js` was measured at **2 failures in 20 runs**, one an uncaught
`TypeError` that aborted the process ten sections early — so a red run and a green
run reported on different amounts of code. It now uses the same seeded xorshift
`layout-audit.js` already had. **Do not remove the seed**; an unseeded harness
runs a different game every time and cannot be trusted to have covered anything.

### THE FAIRNESS BUDGET — every threat announces itself (measure before tuning)

Difficulty has `curve-audit.js`; fairness now has its own instrument:

```bash
node test/telegraph-audit.js   # report: warning frames per threat, vs the baseline
```

`DIVE_PREVIEW = 30` (a lone dive's preview, ~500ms) is **the readable baseline**, and
every threat is measured against it. The rule: **a threat that takes MORE from the
player must not warn LESS.**

| threat | costs | warning |
|---|---|---|
| formation dive | a hit | 30f — `DIVE_PREVIEW`, the baseline |
| coordinated dive (WING) | a hit | 36f — `WING_PREVIEW` |
| boss signature | a hit | 30f — `SIG_LOCK_FRAMES` (crosshair + tick) |
| weather strike | a hit | 42f — `STRIKE_TELEGRAPH` |
| capture beam | **a life** | 60f — `CAPTURE_BEAM_START` |
| enemy bullet | a hit | ~74f of travel — no telegraph, bought with a **speed cap** |

The audit **measures from driven play** rather than restating the constants — restating
them would just re-encode the bug. It found the budget inverted in two places at once:
the capture cost a life and warned for **0 frames**, and the boss signature warned for
**18** (300ms — enough to begin reacting, not to finish an evasion) on an attack that
repeats every 2s once `sigInterval` floors at depth. Both were invisible in the code and
obvious the moment the numbers sat in one column.

`logic.test.js` pins the ordering plus an **absolute floor** (`>= 30f`), so the guard
survives "shrink everything together" — a purely relative guard passes that happily.
`DIVE_PREVIEW` is wired to its call sites, not merely declared; a constant the game
doesn't read makes the guard lie.

**When adding a threat**: give it a telegraph at or above the baseline, scaled by what it
costs, and add it to the audit. Never buy difficulty by shortening a warning — that is
the same mistake as raising the speed caps (see DEEP PRESSURE LADDER).

### Capture / rescue (the Galaga signature loop)

A formation `boss` chosen as a diver has a 20% chance to enter `state = 'capturing'`
instead (gated on `!game.dualFighter && game.capturedShipEnemy === null`). Timing is
owned by two constants — **`CAPTURE_BEAM_START = 60`** (wind-up) and
**`CAPTURE_BEAM_END = 180`** (beam ends) — use them, don't re-inline 60/180.

- **frames 0–59, wind-up**: the boss descends. `captureTelegraphProgress(timer)` (pure,
  logic-tested) returns `0→1` here and `-1` once the beam is live;
  `drawCaptureTelegraph` renders a **growing dashed outline column + colorblind-safe
  chevron** (STORM FRONT's vocabulary). `drawCaptureDanger`'s screen-edge pulse starts
  at `CAPTURE_BEAM_START / 2` — 30 frames of lead, matching the dive preview.
- **frames 60–179, live**: `drawTractorBeam`; a player within `dx < 20` and below the
  boss is taken → `STATE.CAPTURED`, `e.capturedShip = true`, `game.capturedShipEnemy = e`.
- **cutscene**: `game.captureTimer > CAPTURE_HOLD` (120) → **costs a life** →
  `STATE.RESPAWN`; the boss returns to formation carrying your ship.
- **THE STRUGGLE**: those 120 frames are now **played, not watched** — see below.
- **rescue**: killing the holder sets `game.dualFighter = true` and clears
  `capturedShipEnemy`.

**Why the telegraph exists**: the wind-up used to draw nothing, so the beam's first
*visible* frame was also its first *grabbing* frame — 0 frames of warning on the only
threat that costs a whole life (dives warn 30–36f, storm strikes 42f). A headless probe
measured 87% of beams landing. The siren alone wasn't a warning either, since SFX can be
off (`galagaSFXOff`). The logic tests lock the window length, the growth direction, and
the hand-off frame so it can't quietly collapse back to zero.

### THE CONTROL BUDGET — how much of the game do you actually play?

THE FAIRNESS BUDGET asks *does a threat warn you before it takes something*. Its mirror
was never asked: **after it takes something, how long until you are allowed to play
again?** Every pause here was added on its own for a good reason — hit-stop punctuates a
kill, letterbox sells a metamorphosis, the respawn wait carries the death recap — and
none of them knew about each other, so nothing had ever added them up.

```bash
node test/pulse-audit.js   # report: frames your input does nothing, per event + per band
```

The audit drives the **real `gameLoop` accumulator body** (including the hit-stop branch
that skips `update()` entirely) with a bot that flies, shoots and dies, so what it counts
is what a player sits through. It vindicated almost everything and indicted one thing:

| event | costs | your hands are off it for |
|---|---|---|
| hit-stop | nothing (it punctuates a **kill**) | 12f — healthy, that's punctuation |
| stage intro | nothing (skippable with fire) | 35f — healthy |
| respawn | a life, already spent | 119f — the death-recap read window |
| **CAPTURED** | **A LIFE** | **121f, then the respawn behind it → 211f** |

3.5 seconds, the longest silence in the game, sitting on its most expensive event, with
**not one input read across the whole of it** — punished twice, once in lives and once in
time. The rule it broke is the mirror of the fairness rule: **A THREAT THAT TAKES MORE
MUST NOT HOLD YOUR HANDS LONGER.**

The audit's second column is **DEAD AIR** (in control, but nothing can hurt you), the
opposite failure. It is reported rather than fixed because the breakdown shows it isn't a
defect: `empty` (a playfield with nothing on it) is **0f** in every band, and the bulk is
`parade` (the entry flight, Galaga's own vocabulary and meant to be quiet) and `lull`
(a held formation — the player's window to line up shots).

**When adding any pause, freeze, cutscene or cinematic**: add it to the audit and check
the cost/downtime column stays ordered. A pause that costs the player nothing may be
long; a pause that costs a life must be short **or must be playable**.

### THE STRUGGLE — the capture answers back

The fix for the 121-frame silence was not a shorter cutscene (that only makes the
punishment quieter). It is a **contest inside it**. Pull against the beam by alternating
left/right: every **reversal** feeds `game.struggle`, the beam drags it back every frame,
and 1.0 tears you loose with the life unspent.

- Pure, logic-tested core: `struggleDir(left, right)` (both-or-neither → 0, so
  mash-everything is not an exploit) and `struggleTick(meter, dir, last)` (a reversal is
  a change to a **new non-zero** direction — *holding* earns nothing). Commit site:
  `breakCaptureFree()`. Tuning: `STRUGGLE_GAIN` 0.14 / `STRUGGLE_DRAG` 0.005 over
  `CAPTURE_HOLD` 120 — measured, not guessed: a brisk human (~6.7 reversals/s) tears free
  around frame 75–90 of 120, and idle tapping (~3/s) **never** does.
- Input is **polled from the `keys` map**, never the keydown handler, so keyboard, touch
  joystick and gamepad all feed it for free — the same rule the stage-intro skip follows.

**The fork is the point.** Your ship is only worth a DUAL FIGHTER *while the captor is
carrying it*. Break free and you keep the life but forfeit the rescue; go limp and you
pay the life for a shot at flying two ships. `breakCaptureFree` clears
`boss.capturedShip`, so killing that enemy afterwards grants nothing — the test pins
exactly that, because it is what makes this a decision instead of a formality. Galaga's
signature loop finally has a fork in it, and the fork is **played**, not picked from a
menu.

**ZERO new score** — the payoff is a life and the tempo, both already priced. Tracked as
`game.capturesEscaped` + lifetime `galagaBreakoutTotal`, surfaced as the BEAMS BROKEN run
highlight. Fusion: capture/rescue, dual fighter, FLIGHT SCHOOL (the `struggle` lesson
fires the frame the beam goes live — the last moment the player is alive enough to be
coached), enemy comms (`breakout`). No new actor, so THE DIRECTOR's budget is untouched.

### (RETIRED) THE HEIST — the wind-up was raidable

**Deleted 2026-08-23.** Standing in a capture wind-up let you siphon the beam dry
for a shield charge. It sat behind FOUR conditions at once — a formation boss picked
as a diver, a 20% roll, `!dualFighter`, and an empty capture slot — so it fired 0–1
times in an entire run, and carried a constant family, a meter, a leak rate, a bail
cue, a coach lesson, a lifetime key, a highlight row and one of the 24 comms slots.

`CAPTURE_GRAB_HALF_W` **stays** — the live beam grabs with it. The capture loop, its
telegraph and THE STRUGGLE are untouched: those are Galaga's signature and the
measured fix for a 211-frame control-budget violation. This was an option bolted to
the side of them.

### THE RECOVERY BUDGET — the death spiral's brake, measured (SALVAGE SETTLE)

Death wipes S/N/P to 1/1/1; SALVAGE PROTOCOL is the designed brake (shards of the lost
build scatter, catch = +1 level). Its planner was logic-tested, its lesson taught, its
loot magpie-contested — and its real catch rate was never measured. It was **exactly
zero, for the system's entire shipped life.**

```bash
node test/recovery-audit.js   # report: catchable-after-respawn, driven catch rate, recovered/lost
```

The cause was **structural, not tuning**: `playerY` is a constant — the player has no
vertical movement, so the only y a shard can be caught at is that one line. The old
trajectory crossed it entirely inside the 90–120f RESPAWN (player dead), then fell below
a ship that cannot descend, and fizzled at half its own TTL. The comment promising the
TTL "outlives the 90f respawn cutscene" was true and irrelevant — the shard had to
outlive **the lane, not the clock**. The suite stayed green throughout because its shard
tests **hand-placed shards inside the catch band**, teleporting them past the physics
that made every real catch impossible. *That is the testing lesson: a test that
constructs the state a feature needs, instead of driving the physics that must produce
it, certifies a dead system.*

The fix is `salvageStep` (pure, logic-tested): a falling shard **SETTLES into the
player's lane and patrols it** (drift `SALVAGE_DRIFT`, wall-bounce; settle is a
*landing* — rising shards pass up through). Recovery becomes the one verb this player
actually has, a horizontal race, and it stays priced: chasing means leaving your dodge
lane (the one THE SWARM MIND profiles), and a patrolling shard is exactly the neglected
loot THE MAGPIE contests — that fusion came free. Measured after: clean-room catch 2/2,
driven catch 25/31, post-respawn power trajectory climbs again. Recovery stays a
**SOFTENER** — the planner caps it below what death takes (normal recovers 2 of up to 8
lost), so the spiral is braked, not cancelled.

**When touching death, respawn, shard physics, TTLs, or the magpie**: run the audit and
keep three numbers healthy — catchable-after-respawn near 100%, driven catch rate well
off zero, recovered/lost strictly below 1.

### THE STAKES — a life is scarce, and that is what makes the rest mean anything

Five systems have a LIFE as their entire subject: the shield, WITCH TIME, dash
i-frames, THE STRUGGLE and SALVAGE PROTOCOL. `measure-audit.js`'s STAKES column
drove a run to stage 25 and counted what the game handed over: **60 extra lives**
(32 from a 30,000-point MODULO faucet, 28 more from the combo milestone). All five
were decisions about a resource the player had sixty of.

- The score faucet is a **geometric ladder**: the first life still at 30,000 —
  unchanged, so the early game feels identical — then +90k, +270k, +810k.
  `extraLivesFor(score)` is pure and tested.
- The combo milestone pays its challenge-mode reward (5,000 points) in **every**
  mode. The reward kept, the life removed, two code paths become one.
- The **scoring** graze got the 24-frame cooldown its **scoreless** sibling always
  had: it was gated per-bullet by `b.grazed` alone, so parking at a 7-10px offset
  in a stream was uncapped income, and GHOST WAKE tripled it.

Measured after: **3**. When touching any faucet, re-run the column — and note that
a driven bot does not park in a bullet stream, so no run's numbers can show the
graze farm. That one had to be read, not measured.

### THE SHELL — nothing was watching the file around the script

All four gate steps read only what sits between the `<script>` tags. A helper with
a broken predicate overwrote `<!DOCTYPE html>` and the change SHIPPED GREEN: the
page served in quirks mode and every test passed. `logic.test.js`'s THE SHELL
section now pins the doctype, `lang`, the charset and viewport metas, the canvas,
that there is exactly ONE inline script (every harness's extractor assumes it),
and that no game statement has leaked into the shell.

### Defensive layers

Multiple save mechanisms applied in priority order on fatal hit (`tryTriggerWitchTime` checked at bullet/dive vs player collision):

1. `cheatInvincible` (backtick toggle) — debug invincibility, absorbs all hits
2. `shieldCharges` — consumed first if available, brief iframes + green ring
3. WITCH TIME — 30-frame slow-mo window (slowMul 0.2×); if `dashTimer > 0` within window → save (no death), else death resolves. `witchCooldown = 720` between activations.
4. Dash i-frames — manual evasion via Shift (12 invincible frames)

DASH PARRY: during `dashTimer > 0`, enemy bullets passing through the player are deflected: removed + tier-ramped score (50→75→100→150→250) + cyan spark + a single "PARRY x{n} +{score}" cue + metallic ping. Tracked via `game.parryCount`. PARRY STREAK chains within 90f and ramps the base score (and a +500 streak-10 bonus); the streak count shows in a single cyan HUD chip (`P×{n}`). **CLUSTER PARRY**: deflecting 3+ bullets in a *single* dash frame → +100 + size-scaled hit-stop (4–8f, the tactile cue) + `game.clusterParryBest`. PERFECT PARRY: deflect within first 3 frames of dash → +50 + a PARRY ECHO return-bullet + `perfectParries`. **CEO subtraction**: the in-play ULTRA/PERFECT/CLUSTER center banners, the escalating tier colors, and the perfectParry/clusterParry enemy-comms intercepts were removed — all scoring, stats (feed rank/highlights), the parry echo, and the hit-stop remain; feedback is consolidated to the per-parry cue + streak chip + hit-stop.

**Dual fighter as a life buffer**: when `game.dualFighter` is true, a fatal hit downgrades to single (`dualFighter = false`) and enters RESPAWN **without** spending a life or recording a death-cause tally — the wingman absorbs the cost. `stageDied` is still set (the stage is no longer clean), so grade/CLEAN STREAK treat it as a hit.

**REVENGE**: `killPlayer(srcX, srcY, cause, srcType)` seeds `game._revengeType` **only on a confirmed death** (after the cheat/shield early-returns), from the colliding enemy's type or the killing bullet's `fromType`. The next kill of that type increments `revengeCount` (+ lifetime `galagaRevengeTotal`) — a quiet tracked stat feeding the pilot rank ladder (THE AVENGER), run highlights, and the stats overlay. The in-play "REVENGE!" banner + sfx + enemy-comms intercept were removed (CEO subtraction: in-play screen noise); the seeding logic + count remain. Pairs with the respawn DEATH RECAP whisper (cause-specific coaching line).

### Combo system

`bumpCombo()` increments on kill. Multiplier tiers: c≥3 (1.25×), c≥5 (1.5×), c≥10 (2×), c≥15 (2.5×), c≥20 (3×, max). Decays after `COMBO_DECAY=90` frames without a kill.

**COMBO ARSENAL** auto-triggers at thresholds (25/50/75/100): grants free 3-sec RAPID / WAVE / HOMING / LASER respectively. Uses `Math.max` against existing timer so pickup-set timers aren't shortened. `comboArsenalClaimed` Set resets on combo break.

`COMBO_MILESTONE = 40` — extra ship granted every 40 combo (or +5000 in challenge mode).

**GRAZE COMBO GRACE**: a near-miss (graze) while combo ≥ 5 refreshes `comboTimer` by +20f (capped at `COMBO_DECAY`) so skilled dodging bridges kill gaps without dropping the multiplier. Only extends, never grows the combo (kills do that), and the 24f near-miss cooldown prevents farming. Surfaces "COMBO HELD" only when the timer was actually in danger (< 40).

### DEEP PRESSURE LADDER — deep-stage escalation (read before tuning difficulty)

A curve audit found every difficulty scalar **saturated by stage 32** (bullet speed
3.40, dive fire 14f, dive trigger 80f, elite rate 5% — that one as early as stage 10),
so stages 32–100+ were mechanically identical: a **69-stage plateau** underneath
narrative that keeps promising escalation (logs at 40–80, APEX at S60, FINAL FORM at
S100). `deepPressure(stage)` (0 below 32, ramping to 1 at 80) now drives three
**density/composition** knobs — `eliteRateForStage` (5%→12%), `ghostRateForStage`
(3% at 60 → 8% at 100, carrying the curve past the elite top-out), and
`extraDiverChance` (up to a 60% chance of one extra lone diver, hard-capped at +1).

**The rule: never escalate deep stages by raising the speed or cadence caps.** Those
caps (`cappedStageSpeed` 3.4 / `rampedFireInterval` 14f / `rampedInterval` 80f) are
FAIRNESS limits — past them bullets stop being readable and dives stop being dodgeable,
which is unfair, not hard. Escalate density and composition instead, and keep every
threat's telegraph intact (the extra diver still gets the full 30-frame preview).

**The boss track got the same treatment.** It had both failure modes at once: boss
horizontal speed was *uncapped* (`1.7 + stage*0.10`, then ×1.5 at phase 2 and ×1.2 at
phase 3 → 21 px/frame at stage 100, **8.4× `PLAYER_SPEED`**, crossing the arena in 9
frames), while fire cadence / dash cadence / volley width were all flat from ~stage 30,
so all eight SUPER bosses were the same fight and only HP grew (a bullet sponge).
`clampBossVx` now caps the base at `BOSS_VX_BASE_MAX = 5.0` (set *above* stage 30's 4.70
so the first SUPER boss is untouched) and the post-rage magnitude at `BOSS_VX_MAX = 9.0`
(= 5.0 × 1.5 × 1.2 — rage still reads, capped at 3.6× player speed). The removed speed is
paid back by `bossSpreadForStage` ramping the volley 7 → 9. Tests pin the ceiling, prove
stage 30 was not nerfed, and require the deep fight to differ in *kind*, not just length.

**The challenge track had a third failure mode: reward inversion.** Challenge enemies
don't shoot, so speed there is not danger, it is **opportunity**. `baseSpeed` was also
uncapped (1.70 → 6.30 px/f), collapsing each enemy's on-screen dwell 2.49s → 0.67s and
landable shots per pass 24.9 → 6.7 — most of the wave escaped, perfect clears became
unreachable, and the bonus *shrank* with depth. `challengeSpeedForStage` caps at 4.0
(only reached at stage 50, so earlier rounds are byte-identical) and
`challengeGroupSize` ramps 8 → 12, growing waves 16 → 24 enemies: **depth adds targets
instead of taking away time to shoot them.**

All three tracks are now audited and guarded. The test suite pins the **curve shape**
across stages 1–100 (no inversion, no >12% single-stage wall, never 10+ flat stages,
stage 100 materially harder than stage 32), the three formation fairness caps, the boss
speed ceiling, and the challenge opportunity floor — so none of them can quietly drift.
**When adding difficulty anywhere, measure the curve first:**

```bash
node test/curve-audit.js     # report: all three tracks + the score economy
```

`test/curve-audit.js` drives the real scaling functions with the exact parameters from
their call sites, so it cannot drift from what the game does (if you change a call site,
change it there too). It is a **report**, not a pass/fail test — the hard invariants live
in `logic.test.js`. Every difficulty defect found so far — a 69-stage plateau, two
uncapped speed runaways, a reward inversion — was invisible in the code and obvious the
moment it was plotted.

It also reports the **score economy**, because elite (1.5×) and ghost (2×) are score
multipliers: raising their spawn rates for difficulty raises income as a side effect.
Score efficiency (points per unit of danger) falls ×1.000 → ×0.116 from stage 1 to 100.
That is **intended, not a defect** — `getEnemyPoints()` takes no stage argument by
design, exactly as in real Galaga, and depth is meant to pay in combo multipliers, boss
bounty and rank rather than inflated per-kill values. The number is reported so any new
score source is added with its effect known rather than by feel.

### FLIGHT SCHOOL — teach every new verb once (read this when adding a mechanic)

Depth the player never discovers is depth that does not exist. The help panel's COMBAT
DEPTH page documents the skill verbs, but a player who never opens help still never
learns them — and SALVAGE / DEATH ECHO originally shipped with no in-world explanation
at all (shards scatter; a ghost drifts past; nothing says either can be touched).

`COACH_LESSONS` is a registry of one-line lessons; `coachFire(id)` teaches one **once per
lifetime** (persisted to `galagaCoached`), at the first moment the player can actually
use the verb, then retires forever. It self-gates: never in demo runs, never while the
player is dead, and never over a hazard strike telegraph (that read window belongs to
the storm — same rule THE DIRECTOR enforces).

**Rule for new work:** a new player-facing verb or reward that isn't self-evident needs a
`COACH_LESSONS` entry plus a `coachFire()` at its natural first-contact moment. The test
suite enforces this **bidirectionally** by scanning source text (same contract as
ACHIEVEMENTS): a lesson with no trigger, or a trigger with no lesson, fails the build.
Keep lines ≤40 chars and in the uppercase HUD voice.

### THE DIRECTOR — the attention budget (read this before adding any new actor)

Six optional actor systems (rival ace, magpie, supply crate, guardian, death echo,
weather strike) were each self-gated correctly but knew nothing about each other, so a
stage-7 playfield could legally host all six at once on top of 40 formation enemies and
a coordinated dive. `THE DIRECTOR` gives the *set* a budget — it is the arbiter that keeps
the game honest to its own SIMPLE-BY-DEFAULT north star.

- `directorBudget(mode)` — concurrent special-actor cap, scaled by difficulty like the
  rest of the economy: **easy 1 / normal 2 / hard 3**.
- `directorAdmit(cls, census, mode, strikeTelegraph)` — pure gate. Enforces the total cap,
  a hard **one-threat-at-a-time** sub-cap (`rival` / `magpie` / live weather strike all
  demand immediate reaction), and vetoes *everything* while a strike telegraph is up
  (that 42-frame read is the longest telegraph in the game and stays sacred).
- `directorCensus()` — live count of occupied attention (a *retreating* rival is excluded:
  it is leaving, not demanding). `directorAllows(cls)` is the one call spawn sites make.

**Rules for new work:**
1. Any new ambient/optional actor MUST consult `directorAllows('threat'|'gift')` at its
   spawn site, and its spawn check must be re-polled per frame so a denial is a **defer,
   not a cancellation**.
2. **Earned** rewards are never denied — a guardian bought with a combo milestone and the
   salvage shards of your own wreck always spawn. They *count* toward the census (ambient
   spawns yield to them) but never ask permission.
3. Add new actors to `directorCensus()` so they occupy budget, or the arbiter silently
   under-counts and the cap leaks.

Pure parts logic-tested (budget ordering, threat sub-cap, telegraph veto, malformed-census
robustness, retreating-rival exclusion).

### Dynamic systems (set per-stage, read per-frame)

- **`stageMutation`** (`rapidFire | fastDives | slowBullets | denseFire`, 30% / normal stages only) — flips one rule for the whole stage. Read sites: `updatePlayer` (rapidFire fire cd), `updateEnemies` diving branch (fastDives pathSpeed), `updateBullets` enemy slowMul (slowBullets), `diffFireMul` (denseFire).
- **Biome** — derived, not stored: call `biomeForStage(game.stage)` (stage 8+, 12-cycle, 4 stages each) — `planet | ruins | dawn | asteroid | desert | ice | gasGiant | corona | canyon | blackhole | nebula | starfield` (interleaves terrestrial biomes among the space ones). Drawn in `drawBiome()` between nebulae and stars; each has a `BIOME_NAMES` label/color and a `BIOME_WHISPERS` set.
  - **DAYLIGHT GROUND BIOMES** — the four terrestrial/sky biomes (`planet | dawn | desert | canyon`, predicate `biomeIsBright(id)` / `BRIGHT_BIOMES` set, logic-tested) render a genuinely BRIGHT daytime scene instead of the noir void: a lit sky gradient + scrolling ground via the shared `drawBrightSky(pal)` helper, plus each biome's signature detail (sun/dunes/canyon walls/city lights). They set `game._brightBiome = true` (reset false at `draw()` top + `drawBiome()` top), which: hides the starfield (`drawStar` early-returns — no stars in daylight), lays a dark gradient HUD backing top+bottom (`drawHUD`), and adds a thin dark backing behind player bullets (`drawPlayerBullet`) for legibility on the bright sky. The other 8 biomes stay on the noir void — this is the space(dark)↔ground(bright) environmental contrast (see DESIGN.md). Bright biomes intentionally break the global Ink Noir void: noir governs space/chrome, daylight governs the ground stages.
- **STORM FRONT — hazard weather strikes**: the five HAZARD weathers (`storm/solar/vortex/sandstorm/meteor`, `HAZARD_WEATHER`/`weatherIsHazard` — the rest stay peaceful) fire ONE telegraphed vertical strike-column on an 8–12s cadence during normal PLAYING only (live player, `allEntered`, no end-grace). Pure, logic-tested core: `strikePhase(timer, interval)` (idle→42f telegraph→8f active — a longer read than a 30f dive preview) and `weatherStrikeResolve(dx, halfW, dashing, invincible, grazeBand)` → `parry|immune|hit|graze|safe`. Answered with the existing verbs: dash-through = **STORM PARRY** (+50, `parryDividend` applies, `weatherParries` stat), a hit routes through the SAME `tryTriggerWitchTime` → `killPlayer('weather')` ladder as a bullet (cheat/shield/witch all still save; `RESPAWN_WHISPERS.weather` coaches), edge-skim = graze (extends combo hold). Strike SFX transpose to the biome's BGM key via `biomeBgmPitch` → cents; impact ripples the vector grid; telegraph renders in `drawStageWeather` (read-only: tinted column + sliding edge dashes + colorblind-safe chevron, dark backing on bright biomes); one-time `stormFront` intercept per run.
- **`ambientEvent`** (`cargoShip | supernova | satellite | comet | pulsar | meteorShower`, 35% / stage > 3) — atmospheric one-shot. Ticked in `updateAmbientEvent`.
- **`worldCorruption`** (computed from stage) — scales 0→1 over stages 30-80. Adds edge noise / glitch bars / corner haze. Drawn after game content, before scanlines.
- **Difficulty shapes the economy** — beyond speed/fire scaling (`diffSpeedMul`/`diffFireMul`), difficulty shifts loot: `eliteRateForStage(stage, mode)` scales elite spawns (hard ×1.5 / easy ×0.5) and `powerUpDropRate(isElite, mode)` shifts drops (hard −5% / easy +5%, floored 5%). `difficultyDescriptor(mode)` surfaces the trade-off as G-toggle feedback so it's legible. Both rate fns are pure/extracted for testability.

### Narrative layer

- **`TRANSMISSION_LOGS`** — typed-out 3-line beats during STAGE_INTRO at stages 5/10/15/20/25/30/40/50/60/70/80.
- **`BOSS_NAMES`** — 8 unique names (THE OVERSEER, TWIN SOVEREIGNS, APEX, THE DEVOURER, IRON SWARM, NULLIFIER, OBSIDIAN PRIME, THE FINAL WALL), cycled past stage 90.
- **`BOSS_TAUNTS`** — dialogue dictionary keyed by archetype × situation (intro/phase2/lowHp/dash/death/finalStand). All 6 archetypes have their own complete voice (phantom = spectral/unseen, rune = ancient/inscribed); `tauntFor(archetype, situation)` still falls back to `standard` for a genuinely unknown archetype and returns `null` for an absent situation (never throws). The logic tests lock each archetype's voice as complete + distinct-from-standard. Speech bubble above boss, fades over 90 frames.
- **`EPITAPHS`** — 7 stage-tier buckets (rookie/scout/veteran/deepDive/apex/voidwalker/legend) × 3 variants. `pickEpitaph(stage, acc)` runs once at game over, stored on `game.runEpitaph`.
- **`pickRunHighlights()`** — top 3 stats (max combo / parries / graze chain / cluster parry / revenge / flawless boss / stages / bosses / accuracy / dual fighter / elites …) sorted by priority, displayed below epitaph.

### Player identity

`playerCallsign` — 3-letter monogram persisted to `galagaCallsign`. Editor at TITLE via 'U' (arrows + Enter). Displayed on TITLE, HUD (1UP corner), and RUN HIGHLIGHTS header.

### Audio

Sound is generated live through Web Audio (`AudioContext`). `playSound(type, panX)` synthesizes one-shot SFX from oscillators / noise buffers. BGM is a self-rescheduling note scheduler (`scheduleBGMNotes`) that looks ahead 0.4s and re-arms via `setTimeout` every 120 ms — there are no audio files. `ensureAudio()` lazy-creates the context on first user input to satisfy autoplay policies; preserve that gate when adding new sound triggers.

**SPATIAL SFX** — `playSound`'s optional `panX` (a screen x) routes the sound through a per-shot `StereoPanner` placed by `panForX(x)` (pure: `0..BASE_W` → `[-0.85, 0.85]`, softened, clamps, non-numeric → 0 centered). Omitting `panX` keeps the sound centered (UI / player-frame / global cues), and the panner is gated on `createStereoPanner` support. Positional combat events pass it (enemy explode/hit/crit, formation & kamikaze dives, all 6 boss signature attacks via `mb.x`, and the positional `graze`-ping events — near-miss/parry-deflect via `b.x`, ghost-reveal via `e.x`); player fire, pickups, milestones, dash-ready/supply-drop cues, and the player's own death stay centered. **PER-SHOT PITCH VARIATION** — types in the `SFX_VARY` set (`shoot/hit/explode/crit/enemyDive/graze`) get a `±SFX_DETUNE_CENTS` (55) random `o.detune` per trigger so rapid repeats aren't mechanically identical; melodic/sequenced cues (milestone/fanfare/comboStep) are deliberately excluded so they stay in tune. `panForX` / `SFX_VARY` / the `playSound` branches are covered by the logic tests. **COMBO HARMONICS** — `playSound`'s optional 3rd arg `detuneAdd` (cents) composes additively with the `SFX_VARY` wobble; the three enemy-kill SFX sites (`explode`/`crit`) pass `comboKillDetune(game.combo)` (pure, tested: linear ramp to a +300-cent cap at combo 30), so a kill chain audibly rises in pitch and drops back on combo break. Player-death / boss / bomb explosions omit it and stay at base pitch.

BGM tracks have 6 voices — `lead` (square/saw, detuned chorus) + `bass` (triangle)
+ `pad` (sine, polyphonic root+fifth+octave) + `motif` (boss archetype signature)
+ `kick` + `hat` — routed to **four stem buses** (`bgmStems`: drum / bass / harm /
lead). The send is a **tempo-synced dotted-eighth** delay with a lowpass in the
feedback path, and **percussion is dry** (echoing the kick smears the one thing
whose job is to be exactly on time, and it is the pulse the floor is locked to).
The wet returns THROUGH `bgmBus`, so a track change's one fade takes the tail
with it. A persistent `bgmDuck` sidechain sits **below** `bgmGain` — never write a
ducked value onto `bgmGain` itself, which is the parameter `applyVolume()` owns —
and a `masterLimiter` catches the peaks the game's loudest moments make.
See **THE MEASURE** for the stem mask and the bar grid.

**DYNAMIC BGM INTENSITY** (`computeBgmIntensity()`) — multiplies lead voice volume by 1.0×–1.55× based on combo level, boss phase 2, and last-life urgency. Force-enables hat layer when intensity ≥ 1.30. Snapshotted once per scheduler tick (~120ms) for phrase coherence. It is now ONE input beside `stemMask()`, which decides *which* stems play at all.

`bgmForGameState(state)` selects track: `normal | boss | bossEnrage | bossSuper | title`.

**BIOME SONIC IDENTITY** (`biomeBgmPitch(biomeId)`) — on the normal-play tracks only (`normal`/`normalMid`), the whole BGM (lead + bass + pad, uniformly) is transposed to the current biome's key centre via a pure semitone→ratio map (`BIOME_SEMITONES`, `2^(semi/12)`), so each biome SOUNDS like itself — the audio twin of the visual BIOME ATMOSPHERIC GRADE (the per-biome vignette/lens hue). Boss tracks keep `biomePitch = 1.0` so the archetype lead-detune (`computeBgmPitch`) stays the tension cue; a null/unknown biome (stages < 8) → 1.0. Snapshotted once per scheduler tick (phrase-coherent). Pure + logic-tested (ratio band, fallback, registry-wired against `biomeForStage`).

### Persistence

`localStorage` holds ~77 keys, all prefixed `galaga*`:
- Scoring: `galagaHigh`, `galagaTopScoresNormal/Challenge/Daily`, `galagaCumStats[Challenge]`, `galagaBestTimes`, `galagaBonusWins`
- Mode/settings: `galagaDaily`, `galagaChallenge`, `galagaShip`, `galagaDifficulty`, `galagaMute`, `galagaBGMOff`, `galagaSFXOff`, `galagaVol`, `galagaShake`, `galagaRumble`, `galagaColorBlind`, `galagaNightOff`, `galagaCheckpoint`, `galagaIntroSeen`
- Progression: `galagaAchievements`, `galagaDexUnlocked`, `galagaCallsign`, `galagaDailyDays`, `galagaShipsUsed`, `galagaDifficultiesUsed`
- Lifetime skill stats (each a running total/peak): `galagaParryTotal`, `galagaNearMissTotal`, `galagaGrazeChainBest`, `galagaCleanStreakBest`, `galagaRevengeTotal`, `galagaFlawlessBosses`, `galagaWitchSaves`, `galagaPBBeats`, `galagaEliteKills`, `galagaStageGrades`, `galagaKillsByType`, `galagaPickupTotals`, `galagaBiomeVisits`, `galagaDeathCauses`, … (grep `galaga` for the full set)

Each read site uses `try/catch` and falls back to a default — corrupt storage is non-fatal.

### Input

- Keyboard: `ArrowLeft/Right` / `A/D` (move), `Space` (fire/start), `Shift` (dash), `P`/`Esc` (pause). Normalized via `normalizeKey(e)` using `e.code` so layout (Hangul/Cyrillic etc.) doesn't break letter hotkeys.
- Gamepad: left stick / D-pad horizontal, A-button (0) fire, B-button (1) dash (rising-edge → shared `tryStartDash()`), Start (9) pause, Back/Select (8) quit-to-title while paused (→ shared `quitToTitle()`) — polled in `pollGamepad()` at the top of `update()`. Synthesizes the same `keys` map keyboard uses (dash calls `tryStartDash()` directly, like the touch button).
- Touch: `#touchControls` shown only when `'ontouchstart' in window`. Joystick on the left; dash + fire buttons on the right (dash left of fire); pause top-right. Fire synthesizes `keys[' ']`; the dash button calls the shared `tryStartDash()` directly (one-shot per tap) — the same function the Shift key uses, so touch gets full parry/witch-time/evasion access.

Player firing is rate-capped via `game.fireCooldown` (6 frames base, halved by R rapid pickup, further reduced by stageMutation 'rapidFire', min 2 frames).

**Fire-as-action in non-PLAYING states** (BONUS_GAME skill-stop, STAGE_INTRO skip) is detected by **polling `keys[' ']`/`keys['Enter']` with rising-edge tracking inside `update()`**, NOT in the keydown handler. Keep it that way: keyboard, touch (`btnFire` → `keys[' ']`), and gamepad (`pollGamepad`) all feed the same `keys` map, so polling makes these actions work on every input device for free, and the edge-tracking flag (e.g. `_introSkipPrev`, `bonusGame._firePrev`) ensures a held fire button triggers the action only once.

#### Hidden hotkeys (debug)
- **`` ` ``** (backtick) — cheat invincibility toggle ("GOD MODE")
- **`,` / `.`** — previous / next stage (preserves score/lives/lvl)
- **`1`–`9`** — jump to stage 1/5/10/15/20/30/40/50/80 milestones

### Accessibility
- **Reduce motion** — `reduceMotion` reads the OS `prefers-reduced-motion` media query once at load (guarded). When set, the four intense motion/strobe effects are dampened: full-screen impact flash → 30% (`flashAlpha`), screen shake → capped to 'low' (`effectiveShakeMul`), and the camera zoom-punch + spiral-entry rotation are disabled. Both tunable cores are pure + logic-tested. No toggle UI (respects the OS preference). Deep-stage world-corruption glitch is left alone (verified non-strobing — holds steady ~1s, not a flicker risk).
- **Colorblind** — `colorBlindMode` (toggle 'X') adds white outlines + shape markers to enemy bullets and enemy auras; color-coded gameplay (power-ups, grades, difficulty) carries letter/number/shape redundancy.

## Simplification pass (2026-08-08) — what was deliberately removed

User directive: make the game simple. A fresh complexity audit found the bloat was not in
gameplay but in **presentation and content** — `drawHUD` alone was 1,467 lines, there were
391 text-draw sites, 109 achievements and 75 enemy-comms message types. The game said more
than it played. Nine commits cut it back; the **core loop is untouched** (move / fire /
dash-parry / combo / formation dives / boss / power-ups).

| | before | after |
|---|---|---|
| enemy comms | 75 types | **20** — only beats that are rare, dangerous, or need a reaction |
| achievements | 109 | **30** — 7 combo badges, 6 daily, 13 per-enemy-type and the "you changed a setting" cluster are gone |
| `drawHUD` | 1,467 lines | **716** |
| `drawStageIntro` | 1,030 lines | **681** |
| stats overlay | 8 Tab pages | **4** |
| persistence paths | 6 | **4** |

**The DETAIL HUD tier no longer exists.** `minimalHud` used to gate a second, denser HUD
behind the M key with **default ON**, so ~50 widgets were code almost nobody saw. The
hidden tier was deleted rather than toggled: there is one HUD, and `minimalHud`, the M
hotkey and `galagaMinimalHud` are all gone. Removed with it: the stage progress bar, the
combat-state chip column (parry streak / weather / biome / act / guardian), the stage type
icon, PB bars, the extra-life bar, the daily-mission label, the title trophy strip, and
the stage intro's status panel, adaptive tip, perk countdowns, cycle dots and death warning.

**DEATH ECHO and PILOT LOG were removed entirely** — a cross-run wreck ghost and a
last-ten-runs Tab page. Both were pure meta rather than core loop.

Two scale assertions had to be **inverted**: the suite required `INTERCEPT_MSG >= 50` and
`ACHIEVEMENTS >= 50`, i.e. it encoded the bloat as a *requirement*. Both are now bands with
an **upper bound** (comms 15–24, achievements 20–40) so chatter cannot creep back.

**When cutting, verify with the test suite, not the parse check.** A deleted section can
leave a dangling identifier that parses fine and only fails at runtime — that happened, and
only the suite caught it. And an `if (...) {...}` whose branch you delete must have its
`else` **promoted**, not orphaned; a naive line-delete broke the parse twice.

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

- **Shared single-source helpers — use these, don't re-inline the formula** (each is logic-tested): `stageModeFor(stage)` (boss/challenge/normal dispatch), `isCombatState()` (the `PLAYING || CHALLENGING || BOSS_STAGE` gate, used by per-frame timers/BGM), `computeAccuracy(stats)` (hit %, zero-shot-safe) + `computeStageAccuracy()` (same on the current stage's tallies — used by per-stage grade/bonus/HUD), `computeRunGradeScore` + `runGradeLetter` (GAME_OVER grade letter and its audio cue), `comboTierName(combo)` (combo medal label for HUD + carry banner), `comboTierColor(mult)` (combo multiplier tier color — HUD readout / score-pop / carry banner share it), `panForX(x)` (spatial-SFX stereo pan), and the `EXTRA_LIFE_SCORE` constant. Player-shot + enemy-scaling formula helpers (also logic-tested) live just above `updatePlayer` / near `diffSpeedMul`: `computeSynergy(s,n,p)` (S/N/P → OVERLOAD/BLINK/HEAVY build mode), `computeFireCooldown(rapid, mut, fastFingers, overload)` (stacking, min-2 floor), `computeBulletDamage(...)` / `computeBulletSpeed(...)` (player shot), `nonFireBulletCount(bullets)` (guardian/parry-echo excluded from the fire cap), `cappedStageSpeed(cap, base, perStage, stage, diffMul)` (enemy bullet speed — increasing, capped), `rampedInterval(floor, base, perStage, stage)` + `rampedFireInterval(floor, base, perStage, stage, diffMul)` (spawn/fire cadence — decreasing, floored), `aimVelocity(fromX, fromY, toX, toY, speed)` (unit-aim × speed, with a zero-distance NaN guard), and `aabbHit(dx, dy, halfW, halfH)` (symmetric box overlap — the 9 `Math.abs(dx) < hw && Math.abs(dy) < hh` collision sites: player vs bullet/dive/ram, bullet vs mega-boss/satellite/cargo; strict `<`, args are pure arithmetic so eager eval matches the original short-circuit). These were extracted from 2–35 duplicated inline sites; re-inlining reintroduces drift.
- Game tuning constants are mostly at the top of the script (`PLAYER_SPEED`, `BULLET_SPEED`, `BOSS_STAGE_INTERVAL`, `EXTRA_LIFE_SCORE`, `STAR_COUNT`, `MILESTONE_STAGES`) or grouped near the relevant function (`SHIELD_MAX`, `SLOW/RAPID/WAVE/HOMING/LASER_DURATION`, `WITCH_WINDOW=30`, `WITCH_COOLDOWN=720`, `COMBO_DECAY=90`, `COMBO_MILESTONE=40`). Per-ship caps live on `SHIPS[*].bulletCap` and difficulty scales speed/fire-rate via `diffSpeedMul()` / `diffFireMul()`. Difficulty scaling typically multiplies by `game.stage`.
- Sprite art is drawn procedurally via `ctx.fillRect` calls in `drawPlayer` / `drawBee` / `drawButterfly` / `drawBoss` / `drawMegaBoss` / `drawPlayerBullet` / etc. There are no image assets.
- Hit detection is AABB with hardcoded half-extents (commonly `8 × 8` for bullets-vs-enemies, `7` or `16` for the player depending on `dualFighter`). When changing sprite size, update the corresponding collision constants too.
- **Draw functions must NOT mutate game state.** Camera/effect timers (`cinematicBars`, `camNudgeX/Y`, `comboLostFlashTimer`, `highScoreGlow`, `worldCorruption`-driven counters) all tick in `update()` under a PAUSED guard. If you add a timer-driven visual, add its decrement next to those.
- `BOSS_STAGE_INTERVAL = 10` is the production cadence — confirm with the user before changing stage cadence.
- The `bgmTimerId` global tracks the in-flight scheduler timer; `stopBGM` clears it. When changing tracks via `startBGM`, the old scheduler chain is severed and the audio bus fades over `BGM_FADE = 0.35s` before disconnecting.
