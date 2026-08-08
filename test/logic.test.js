/*
 * logic.test.js — standalone Node test harness for galaga_clone/index.html
 *
 * The game is a single HTML file with an inline <script>. There is no build step
 * and no test framework. This harness:
 *   1. extracts the inline script,
 *   2. runs it inside a Node `vm` sandbox with hand-rolled browser-API stubs
 *      (canvas/2d ctx, localStorage, document, window, AudioContext, RAF...),
 *   3. neutralizes the render loop (requestAnimationFrame = noop) so init() runs
 *      once and leaves the game object + all top-level functions reachable,
 *   4. exercises the pure-ish logic functions with mock state and asserts.
 *
 * Run:  node test/logic.test.js
 * Exit code 0 = all passed, 1 = failures.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'index.html');

// ---- extract inline script ----
const html = fs.readFileSync(HTML_PATH, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('No <script> block found'); process.exit(1); }
const scriptSrc = m[1];

// ---- browser-API stubs ----
// A 2D context proxy: every method is a noop, gradients return a stub, every
// property read/write is absorbed. Lets draw() run without a real canvas.
function makeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
    fill() {}, stroke() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    transform() {}, clip() {}, fillText() {}, strokeText() {}, measureText() { return { width: 0 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    drawImage() {}, putImageData() {}, getImageData() { return { data: [] }; },
    setLineDash() {}, quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, arcTo() {},
  };
  return new Proxy(target, {
    get(t, p) { return p in t ? t[p] : (typeof p === 'string' ? () => {} : undefined); },
    set() { return true; },
  });
}
function makeCanvas() {
  return {
    width: 224, height: 288, style: {},
    getContext() { return makeCtx(); },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 224, height: 288 }; },
    requestPointerLock() {},
  };
}
function makeEl() {
  return {
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    getContext() { return makeCtx(); }, focus() {}, blur() {}, click() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    textContent: '', innerHTML: '', value: '',
  };
}

const store = {};
const localStorageStub = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};

const documentStub = {
  getElementById(id) { return id === 'gc' ? makeCanvas() : makeEl(); },
  createElement() { return makeEl(); },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
  hidden: false, fullscreenElement: null,
  exitFullscreen() { return Promise.resolve(); },
};

let rafCount = 0;
function requestAnimationFrameStub() { rafCount++; return rafCount; } // noop — never invokes cb

const audioNode = new Proxy({}, {
  get(t, p) {
    if (p === 'connect' || p === 'disconnect' || p === 'start' || p === 'stop'
        || p === 'setValueAtTime' || p === 'linearRampToValueAtTime'
        || p === 'exponentialRampToValueAtTime' || p === 'setTargetAtTime'
        || p === 'cancelScheduledValues') return () => audioNode;
    if (p === 'frequency' || p === 'gain' || p === 'detune' || p === 'pan' || p === 'Q'
        || p === 'delayTime' || p === 'playbackRate') return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} };
    return () => audioNode;
  },
});
function AudioContextStub() {
  return {
    currentTime: 0, sampleRate: 44100, destination: audioNode, state: 'running',
    createOscillator() { return audioNode; }, createGain() { return audioNode; },
    createBiquadFilter() { return audioNode; }, createDelay() { return audioNode; },
    createStereoPanner() { return audioNode; }, createDynamicsCompressor() { return audioNode; },
    createBuffer() { return { getChannelData() { return new Float32Array(8); } }; },
    createBufferSource() { return audioNode; }, createWaveShaper() { return audioNode; },
    createConvolver() { return audioNode; }, createAnalyser() { return audioNode; },
    resume() { return Promise.resolve(); }, suspend() { return Promise.resolve(); },
  };
}

const windowStub = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
  requestAnimationFrame: requestAnimationFrameStub,
  cancelAnimationFrame() {},
  localStorage: localStorageStub,
  AudioContext: AudioContextStub, webkitAudioContext: AudioContextStub,
  matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
  getComputedStyle() { return {}; },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
};

const sandbox = {
  console,
  document: documentStub,
  window: windowStub,
  localStorage: localStorageStub,
  navigator: { getGamepads() { return []; }, vibrate() {}, userAgent: 'node-test' },
  AudioContext: AudioContextStub,
  webkitAudioContext: AudioContextStub,
  requestAnimationFrame: requestAnimationFrameStub,
  cancelAnimationFrame() {},
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  performance: { now: () => 0 },
  Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
  Float32Array, Uint8Array, Array, Object, String, Number, Boolean, Set, Map, Symbol,
  alert() {}, prompt() { return null; }, confirm() { return false; },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.window.self = sandbox;

// In vm, top-level `let`/`const` bindings (game, stagePBs, COMBO_DECAY...) do NOT
// become properties of the context global — only `function`/`var` declarations do.
// Append accessor shims so the harness can reach those closure bindings. Getters
// (not value copies) track reassignment, e.g. resetGame() rebinds `game`.
const shim = `
;try { globalThis.__getGame = function () { return (typeof game !== 'undefined') ? game : null; }; } catch (e) {}
;try { globalThis.__getStagePBs = function () { return (typeof stagePBs !== 'undefined') ? stagePBs : null; }; } catch (e) {}
;try { globalThis.__getBiomeNames = function () { return (typeof BIOME_NAMES !== 'undefined') ? BIOME_NAMES : null; }; } catch (e) {}
;try { globalThis.__getBiomeWhispers = function () { return (typeof BIOME_WHISPERS !== 'undefined') ? BIOME_WHISPERS : null; }; } catch (e) {}
;try { globalThis.__getEnemyInfo = function () { return (typeof ENEMY_INFO !== 'undefined') ? ENEMY_INFO : null; }; } catch (e) {}
;try { globalThis.__getWeatherTable = function () { return (typeof WEATHER_TABLE !== 'undefined') ? WEATHER_TABLE : null; }; } catch (e) {}
;try { globalThis.__getMaxPowerLvl = function () { return (typeof MAX_POWER_LVL !== 'undefined') ? MAX_POWER_LVL : null; }; } catch (e) {}
;try { globalThis.__getComboDecay = function () { return (typeof COMBO_DECAY !== 'undefined') ? COMBO_DECAY : null; }; } catch (e) {}
;try { globalThis.__getShips = function () { return (typeof SHIPS !== 'undefined') ? SHIPS : null; }; } catch (e) {}
;try { globalThis.__getShipOrder = function () { return (typeof SHIP_ORDER !== 'undefined') ? SHIP_ORDER : null; }; } catch (e) {}
;try { globalThis.__getKeys = function () { return (typeof keys !== 'undefined') ? keys : null; }; } catch (e) {}
;try { globalThis.__getDailyMissions = function () { return (typeof DAILY_MISSIONS !== 'undefined') ? DAILY_MISSIONS : null; }; } catch (e) {}
;try { globalThis.__setDifficulty = function (m) { if (typeof difficultyMode !== 'undefined') difficultyMode = m; }; } catch (e) {}
;try { globalThis.__getSfxVary = function () { return (typeof SFX_VARY !== 'undefined') ? SFX_VARY : null; }; } catch (e) {}
;try { globalThis.__getDexUnlocked = function () { return (typeof dexUnlocked !== 'undefined') ? dexUnlocked : null; }; } catch (e) {}
;try { globalThis.__getUnlockedAch = function () { return (typeof unlockedAchievements !== 'undefined') ? unlockedAchievements : null; }; } catch (e) {}
;try { globalThis.__getBossNames = function () { return (typeof BOSS_NAMES !== 'undefined') ? BOSS_NAMES : null; }; } catch (e) {}
;try { globalThis.__getInterceptMsg = function () { return (typeof INTERCEPT_MSG !== 'undefined') ? INTERCEPT_MSG : null; }; } catch (e) {}
;try { globalThis.__getStageMutations = function () { return (typeof STAGE_MUTATIONS !== 'undefined') ? STAGE_MUTATIONS : null; }; } catch (e) {}
;try { globalThis.__getActTitles = function () { return (typeof ACT_TITLES !== 'undefined') ? ACT_TITLES : null; }; } catch (e) {}
;try { globalThis.__getEnduranceTiers = function () { return (typeof ENDURANCE_TIERS !== 'undefined') ? ENDURANCE_TIERS : null; }; } catch (e) {}
;try { globalThis.__getComboArsenal = function () { return (typeof COMBO_ARSENAL !== 'undefined') ? COMBO_ARSENAL : null; }; } catch (e) {}
;try { globalThis.__getAchievements = function () { return (typeof ACHIEVEMENTS !== 'undefined') ? ACHIEVEMENTS : null; }; } catch (e) {}
;try { globalThis.__getPowerupCol = function () { return (typeof POWERUP_COL !== 'undefined') ? POWERUP_COL : null; }; } catch (e) {}
;try { globalThis.__getGradeCol = function () { return (typeof GRADE_COL !== 'undefined') ? GRADE_COL : null; }; } catch (e) {}
;try { globalThis.__getVgrid = function () { return (typeof vgrid !== 'undefined') ? vgrid : null; }; } catch (e) {}
;try { globalThis.__getDiveTactics = function () { return (typeof DIVE_TACTICS !== 'undefined') ? DIVE_TACTICS : null; }; } catch (e) {}
;try { globalThis.__getRivalLines = function () { return (typeof RIVAL_LINES !== 'undefined') ? RIVAL_LINES : null; }; } catch (e) {}
;try { globalThis.__getEchoLines = function () { return (typeof ECHO_LINES !== 'undefined') ? ECHO_LINES : null; }; } catch (e) {}
;try { globalThis.__getArchetypeMotifs = function () { return (typeof ARCHETYPE_MOTIFS !== 'undefined') ? ARCHETYPE_MOTIFS : null; }; } catch (e) {}
;try { globalThis.__getCol = function () { return (typeof COL !== 'undefined') ? COL : null; }; } catch (e) {}
;try { globalThis.__getCoachLessons = function () { return (typeof COACH_LESSONS !== 'undefined') ? COACH_LESSONS : null; }; } catch (e) {}
;try { globalThis.__getState = function () { return (typeof STATE !== 'undefined') ? STATE : null; }; } catch (e) {}
;try { globalThis.__getRespawnWhispers = function () { return (typeof RESPAWN_WHISPERS !== 'undefined') ? RESPAWN_WHISPERS : null; }; } catch (e) {}
`;

vm.createContext(sandbox);
try {
  vm.runInContext(scriptSrc + shim, sandbox, { filename: 'index.html#inline', timeout: 5000 });
} catch (e) {
  console.error('Script failed to evaluate in sandbox:', e && e.stack || e);
  process.exit(1);
}

// ---- tiny assertion lib ----
let passed = 0, failed = 0;
const fails = [];
function eq(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; fails.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function ok(cond, label) {
  if (cond) { passed++; } else { failed++; fails.push(`${label}: expected truthy, got ${JSON.stringify(cond)}`); }
}
function section(name) { console.log('\n# ' + name); }

const G = sandbox; // top-level fns/vars live on the sandbox global

// Helper to (re)build a clean game object via resetGame. resetGame() rebinds the
// `game` let, so re-fetch through the getter shim each time.
function fresh() {
  if (typeof G.resetGame === 'function') G.resetGame();
  return G.__getGame();
}
function stagePBs() { return G.__getStagePBs(); }

// ============================================================
section('comboMultiplier tiers');
if (typeof G.comboMultiplier === 'function') {
  ok(G.comboMultiplier(2) === 1 || G.comboMultiplier(2) < 1.25, 'combo 2 = base');
  ok(G.comboMultiplier(20) >= G.comboMultiplier(5), 'higher combo >= lower');
  ok(G.comboMultiplier(30) >= G.comboMultiplier(20), 'monotonic up to max');
} else { console.log('  (skipped — comboMultiplier not exposed)'); }

// ============================================================
section('biomeForStage cycle');
if (typeof G.biomeForStage === 'function') {
  eq(G.biomeForStage(1), null, 'stage 1 = no biome');
  eq(G.biomeForStage(7), null, 'stage 7 = no biome');
  ok(typeof G.biomeForStage(8) === 'string', 'stage 8 = biome string');
  eq(G.biomeForStage(8), G.biomeForStage(8 + 48), 'biome cycle repeats every 48 stages (12*4)');
} else { console.log('  (skipped — biomeForStage not exposed)'); }

// ============================================================
section('biomeIsBright — DAYLIGHT GROUND BIOMES predicate');
if (typeof G.biomeIsBright === 'function') {
  // The four terrestrial/sky biomes render as a bright daytime scene.
  ['planet', 'dawn', 'desert', 'canyon'].forEach(b =>
    ok(G.biomeIsBright(b) === true, b + ' is a bright (daylight) biome'));
  // Every other biome stays on the noir void.
  ['ruins', 'asteroid', 'ice', 'gasGiant', 'corona', 'blackhole', 'nebula', 'starfield'].forEach(b =>
    ok(G.biomeIsBright(b) === false, b + ' stays dark (space void)'));
  // Robust to junk / null (drawBiome early-returns before calling it, but guard anyway).
  ok(G.biomeIsBright(null) === false, 'null biome is not bright');
  ok(G.biomeIsBright('nope') === false, 'unknown biome is not bright');
  // Consistency: every bright biome is a real biome that biomeForStage can yield.
  if (typeof G.biomeForStage === 'function') {
    const yielded = new Set();
    for (let s = 8; s < 8 + 48; s++) yielded.add(G.biomeForStage(s));
    ['planet', 'dawn', 'desert', 'canyon'].forEach(b =>
      ok(yielded.has(b), 'bright biome ' + b + ' is reachable from biomeForStage'));
  }
} else { console.log('  (skipped — biomeIsBright not exposed)'); }

// ============================================================
section('evalBonusResult uses LOCKED reels (skill-stop), not finalIdx');
if (typeof G.evalBonusResult === 'function') {
  const g = fresh();
  // Player skill-stopped all three to '$' ($ index = 4) → MEGA JACKPOT,
  // even though finalIdx was a non-winning spread.
  g.bonusGame = {
    elapsed: 200, reels: [4, 4, 4], stopAt: [60, 90, 120],
    finalIdx: [0, 1, 2], locked: [4, 4, 4], resultShown: false, bonus: 0, matchText: '',
  };
  G.evalBonusResult();
  eq(g.bonusGame.bonus, 10000, 'three $ locked = MEGA JACKPOT 10000');
  eq(g.bonusGame.matchText, 'MEGA JACKPOT!', 'mega jackpot text');

  // Falls back to finalIdx for any reel left unlocked (false)
  const g2 = g;
  g2.bonusGame = {
    elapsed: 200, reels: [0, 0, 0], stopAt: [60, 90, 120],
    finalIdx: [1, 1, 1], locked: [false, false, false], resultShown: false, bonus: 0, matchText: '',
  };
  G.evalBonusResult();
  eq(g2.bonusGame.bonus, 5000, 'unlocked reels fall back to finalIdx triple = JACKPOT 5000');
} else { console.log('  (skipped — evalBonusResult not exposed)'); }

// ============================================================
section('bonusSkillStop locks a spinning reel at its current symbol');
if (typeof G.bonusSkillStop === 'function') {
  const g = fresh();
  g.bonusGame = {
    elapsed: 40, reels: [2, 0, 0], stopAt: [60, 90, 120],
    finalIdx: [0, 0, 0], locked: [false, false, false], resultShown: false, bonus: 0, matchText: '', skillStopped: 0,
  };
  G.bonusSkillStop();
  eq(g.bonusGame.locked[0], 2, 'reel 0 locked at current symbol (2)');
  eq(g.bonusGame.stopAt[0], 40, 'reel 0 stopAt pulled to elapsed');
  eq(g.bonusGame.skillStopped, 1, 'skillStopped incremented');
  // second press locks the next reel
  G.bonusSkillStop();
  eq(g.bonusGame.locked[1], 0, 'second press locks reel 1');
  eq(g.bonusGame.skillStopped, 2, 'skillStopped now 2');
  // no-op once result shown
  g.bonusGame.resultShown = true;
  G.bonusSkillStop();
  eq(g.bonusGame.skillStopped, 2, 'no skill-stop after result shown');
} else { console.log('  (skipped — bonusSkillStop not exposed)'); }

// ============================================================
section('checkPbHalfMark fires once in 50-70% window, gated on PB');
if (typeof G.checkPbHalfMark === 'function' && stagePBs()) {
  const sp = stagePBs();
  const g = fresh();
  g.stage = 3;
  sp[String(3)] = 600;               // PB of 600 frames
  g._pbHalfMarkFired = false;
  g.floatTexts = [];
  g.stageFrames = 100;               // 16% — too early
  G.checkPbHalfMark();
  eq(g._pbHalfMarkFired, false, 'no fire below 50%');

  g.stageFrames = 330;               // 55% — in window
  G.checkPbHalfMark();
  eq(g._pbHalfMarkFired, true, 'fires inside 50-70% window');
  const firedCount1 = g.floatTexts.length;
  g.stageFrames = 360;               // still in window but already fired
  G.checkPbHalfMark();
  eq(g.floatTexts.length, firedCount1, 'one-shot — no double fire');

  // No PB → never fires
  const g2 = fresh();
  g2.stage = 999;
  delete sp['999'];
  g2._pbHalfMarkFired = false;
  g2.stageFrames = 9999;
  G.checkPbHalfMark();
  eq(g2._pbHalfMarkFired, false, 'no PB = never fires');
} else { console.log('  (skipped — checkPbHalfMark/stagePBs not exposed)'); }

// ============================================================
section('REVENGE: a shield-absorbed (non-fatal) hit must NOT seed a revenge target');
// This encodes the CORRECT behavior. killPlayer early-returns when a shield
// charge absorbs the hit; in that case no death occurred, so _revengeType
// should remain unset. (Pre-fix the caller set it before killPlayer ran.)
if (typeof G.killPlayer === 'function') {
  const g = fresh();
  g.playerAlive = true;
  g.shieldCharges = 1;            // shield will absorb
  g._revengeType = null;
  g.lives = 3;
  // Emulate the post-fix contract: killPlayer receives the source type and only
  // sets _revengeType when the hit is actually fatal.
  G.killPlayer(100, 100, 'bullet', 'bee');
  eq(g._revengeType, null, 'shield-absorbed hit leaves _revengeType unset');
  ok(g.shieldCharges === 0, 'shield charge consumed');
  ok(g.playerAlive === true, 'player survived the shielded hit');

  // A genuinely fatal hit (no shield) should seed the revenge target.
  const g2 = fresh();
  g2.playerAlive = true;
  g2.shieldCharges = 0;
  g2.cheatInvincible = false;
  g2.lives = 3;
  g2._revengeType = null;
  G.killPlayer(100, 100, 'bullet', 'butterfly');
  eq(g2._revengeType, 'butterfly', 'fatal hit seeds revenge target');
} else { console.log('  (skipped — killPlayer not exposed)'); }

// ============================================================
section('comboMultiplier exact tier boundaries');
if (typeof G.comboMultiplier === 'function') {
  eq(G.comboMultiplier(0), 1,    'combo 0 = 1x');
  eq(G.comboMultiplier(2), 1,    'combo 2 = 1x');
  eq(G.comboMultiplier(3), 1.25, 'combo 3 = 1.25x');
  eq(G.comboMultiplier(4), 1.25, 'combo 4 = 1.25x');
  eq(G.comboMultiplier(5), 1.5,  'combo 5 = 1.5x');
  eq(G.comboMultiplier(9), 1.5,  'combo 9 = 1.5x');
  eq(G.comboMultiplier(10), 2,   'combo 10 = 2x');
  eq(G.comboMultiplier(14), 2,   'combo 14 = 2x');
  eq(G.comboMultiplier(15), 2.5, 'combo 15 = 2.5x');
  eq(G.comboMultiplier(19), 2.5, 'combo 19 = 2.5x');
  eq(G.comboMultiplier(20), 3,   'combo 20 = 3x (max)');
  eq(G.comboMultiplier(999), 3,  'combo 999 = 3x (capped)');
} else { console.log('  (skipped — comboMultiplier not exposed)'); }

// ============================================================
section('biomeForStage ↔ BIOME_NAMES / BIOME_WHISPERS consistency');
if (typeof G.biomeForStage === 'function' && G.__getBiomeNames() && G.__getBiomeWhispers()) {
  const names = G.__getBiomeNames();
  const whispers = G.__getBiomeWhispers();
  let allValid = true, allHaveWhisper = true, badName = '', badWhisper = '';
  const seen = new Set();
  // Walk a full 48-stage cycle (12 biomes × 4-stage spacing) from stage 8.
  for (let s = 8; s < 8 + 48; s++) {
    const b = G.biomeForStage(s);
    if (!b) continue;
    seen.add(b);
    if (!names[b]) { allValid = false; badName = b; }
    if (!whispers[b]) { allHaveWhisper = false; badWhisper = b; }
  }
  ok(allValid, 'every biomeForStage output is a BIOME_NAMES key' + (badName ? ' (missing: ' + badName + ')' : ''));
  ok(allHaveWhisper, 'every biomeForStage output has a BIOME_WHISPERS entry' + (badWhisper ? ' (missing: ' + badWhisper + ')' : ''));
  eq(seen.size, 12, 'all 12 biomes appear across the cycle');
  // Each named biome must have a label + color
  let metaOk = true;
  for (const k of Object.keys(names)) {
    if (!names[k].label || !names[k].col) metaOk = false;
  }
  ok(metaOk, 'every BIOME_NAMES entry has label + col');
} else { console.log('  (skipped — biome maps not exposed)'); }

// ============================================================
section('pilotTitleColor covers every computePilotTitle output');
if (typeof G.pilotTitleColor === 'function') {
  // The full set of titles computePilotTitle can return.
  const titles = ['ACE PILOT', 'APEX SURVIVOR', 'BESTIARY MASTER', 'VETERAN', 'PILOT', 'ROOKIE'];
  let allColored = true, badTitle = '';
  for (const t of titles) {
    const c = G.pilotTitleColor(t);
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{3,6}$/.test(c)) { allColored = false; badTitle = t; }
  }
  ok(allColored, 'each pilot title maps to a hex color' + (badTitle ? ' (bad: ' + badTitle + ')' : ''));
  // Non-ROOKIE titles must not collapse to the ROOKIE fallback gray (#888).
  let distinctOk = true;
  for (const t of titles) {
    if (t !== 'ROOKIE' && G.pilotTitleColor(t) === '#888') distinctOk = false;
  }
  ok(distinctOk, 'non-ROOKIE titles do not fall back to #888');
  eq(G.pilotTitleColor('ROOKIE'), '#888', 'ROOKIE = #888');
  eq(G.pilotTitleColor('NONEXISTENT'), '#888', 'unknown title = #888 fallback');
} else { console.log('  (skipped — pilotTitleColor not exposed)'); }

// ============================================================
section('fmtFrameTime formatting + minute-rollover boundary');
if (typeof G.fmtFrameTime === 'function') {
  eq(G.fmtFrameTime(0), '0.0s',     '0 frames = 0.0s');
  eq(G.fmtFrameTime(60), '1.0s',    '60 frames = 1.0s');
  eq(G.fmtFrameTime(90), '1.5s',    '90 frames = 1.5s');
  eq(G.fmtFrameTime(3600), '1:00.0s', '3600 frames = 1:00.0s');
  eq(G.fmtFrameTime(3599), '1:00.0s', '3599 frames rolls to 1:00.0s (not 60.0s)');
  eq(G.fmtFrameTime(3661), '1:01.0s', '3661 frames ≈ 1:01.0s');
  eq(G.fmtFrameTime(3960), '1:06.0s', '3960 frames = 1:06.0s');
  // never emit a bare "60.0s" — that should always be "1:00.0s"
  let bad60 = false;
  for (let f = 3540; f <= 3660; f++) { if (G.fmtFrameTime(f) === '60.0s') bad60 = true; }
  ok(!bad60, 'never renders bare "60.0s" near the 1-minute boundary');
} else { console.log('  (skipped — fmtFrameTime not exposed)'); }

// ============================================================
section('fmtScore formatting across magnitude boundaries');
if (typeof G.fmtScore === 'function') {
  eq(G.fmtScore(0), '000000',      '0 = zero-padded 6');
  eq(G.fmtScore(42), '000042',     '42 = 000042');
  eq(G.fmtScore(999999), '999999', '999999 = no suffix');
  eq(G.fmtScore(1000000), '1.00M', '1M = 1.00M');
  eq(G.fmtScore(2500000), '2.50M', '2.5M = 2.50M');
  eq(G.fmtScore(15000000), '15.0M','15M = 15.0M (1 decimal)');
  eq(G.fmtScore(150000000), '150M','150M = whole M');
  eq(G.fmtScore(999999999), 'MAX!','cap = MAX!');
  eq(G.fmtScore(null), '000000',   'null = 000000 (guarded)');
} else { console.log('  (skipped — fmtScore not exposed)'); }

// ============================================================
section('killScore — base × combo × elite × ghost product');
if (typeof G.killScore === 'function') {
  // bee formation = 50, combo<3 → ×1
  eq(G.killScore('bee', true, 0, false, false), 50, 'bee/no-combo = 50');
  // combo 20 → ×3
  eq(G.killScore('bee', true, 20, false, false), 150, 'combo 20 → ×3 = 150');
  // elite ×1.5
  eq(G.killScore('bee', true, 0, true, false), 75, 'elite → ×1.5 = 75');
  // ghost ×2
  eq(G.killScore('bee', true, 0, false, true), 100, 'ghost → ×2 = 100');
  // all factors stack: 50 × 3 (combo20) × 1.5 (elite) × 2 (ghost) = 450
  eq(G.killScore('bee', true, 20, true, true), 450, 'all factors stack (rounded)');
  // diving bee = 100 base
  eq(G.killScore('bee', false, 0, false, false), 100, 'diving bee base = 100');
} else { console.log('  (skipped — killScore not exposed)'); }

// ============================================================
section('grazeScore — close/mid band × ghostWake perk');
if (typeof G.grazeScore === 'function') {
  eq(G.grazeScore(true, false), 100, 'close pass = 100');
  eq(G.grazeScore(false, false), 50, 'mid pass = 50');
  eq(G.grazeScore(true, true), 300, 'close + ghostWake = 100×3');
  eq(G.grazeScore(false, true), 150, 'mid + ghostWake = 50×3');
} else { console.log('  (skipped — grazeScore not exposed)'); }

// ============================================================
section('bossBounty — stage-scaled base × combo × bountyHunter perk');
if (typeof G.bossBounty === 'function') {
  eq(G.bossBounty(1, 0, false), 5500, 'stage 1, no combo = 5000+500');
  eq(G.bossBounty(10, 0, false), 10000, 'stage 10 base = 5000+5000');
  eq(G.bossBounty(1, 20, false), 16500, 'combo 20 → ×3');
  eq(G.bossBounty(1, 0, true), 8250, 'bountyHunter perk → +50%');
  eq(G.bossBounty(10, 20, true), 45000, 'stage 10 + combo 20 + perk stack');
} else { console.log('  (skipped — bossBounty not exposed)'); }

// ============================================================
section('getEnemyPoints values + formation/diving + fallback');
if (typeof G.getEnemyPoints === 'function') {
  eq(G.getEnemyPoints('bee', true), 50,        'bee in formation = 50');
  eq(G.getEnemyPoints('bee', false), 100,      'bee diving = 100 (2x)');
  eq(G.getEnemyPoints('butterfly', true), 80,  'butterfly formation = 80');
  eq(G.getEnemyPoints('boss', false), 400,     'boss diving = 400');
  eq(G.getEnemyPoints('goldenBee', true), 3000,'goldenBee = 3000 (flat)');
  eq(G.getEnemyPoints('ufo', false), 1000,     'ufo = 1000 (flat)');
  eq(G.getEnemyPoints('minibee', false), 30,   'minibee = 30 (flat)');
  eq(G.getEnemyPoints('nonexistent', true), 50,'unknown type = 50 fallback');
  // Diving should never be worth less than formation for the same type.
  const types = ['bee', 'butterfly', 'boss', 'splitter', 'shielded'];
  let monotonic = true;
  for (const t of types) { if (G.getEnemyPoints(t, false) < G.getEnemyPoints(t, true)) monotonic = false; }
  ok(monotonic, 'diving points >= formation points for every type');
} else { console.log('  (skipped — getEnemyPoints not exposed)'); }

// ============================================================
section('archetypeFor cycles the canonical 6 boss archetypes');
if (typeof G.archetypeFor === 'function') {
  const canonical = ['standard', 'horned', 'tendril', 'crystal', 'phantom', 'rune'];
  // Boss stages are multiples of BOSS_STAGE_INTERVAL (10). idx = stage/10 - 1.
  eq(G.archetypeFor(10), 'standard', 'stage 10 = standard');
  eq(G.archetypeFor(20), 'horned',   'stage 20 = horned');
  eq(G.archetypeFor(30), 'tendril',  'stage 30 = tendril');
  eq(G.archetypeFor(40), 'crystal',  'stage 40 = crystal');
  eq(G.archetypeFor(50), 'phantom',  'stage 50 = phantom');
  eq(G.archetypeFor(60), 'rune',     'stage 60 = rune');
  eq(G.archetypeFor(70), 'standard', 'stage 70 wraps to standard');
  // Every output must be in the canonical set (guards a typo / extra entry).
  let allCanonical = true, bad = '';
  for (let s = 10; s <= 200; s += 10) {
    const a = G.archetypeFor(s);
    if (!canonical.includes(a)) { allCanonical = false; bad = a; }
  }
  ok(allCanonical, 'every archetypeFor output is canonical' + (bad ? ' (bad: ' + bad + ')' : ''));
} else { console.log('  (skipped — archetypeFor not exposed)'); }

// ============================================================
section('every ENEMY_INFO type has positive getEnemyPoints (formation + diving)');
if (typeof G.getEnemyPoints === 'function' && G.__getEnemyInfo()) {
  const info = G.__getEnemyInfo();
  let allScored = true, bad = '';
  for (const type of Object.keys(info)) {
    const pf = G.getEnemyPoints(type, true);
    const pd = G.getEnemyPoints(type, false);
    if (!(pf > 0) || !(pd > 0)) { allScored = false; bad = type; }
  }
  ok(allScored, 'every ENEMY_INFO type scores > 0' + (bad ? ' (bad: ' + bad + ')' : ''));
  // ENEMY_INFO entries must carry name + col + trait (trait is shown on FIRST
  // CONTACT and in the BESTIARY — a missing one renders an undefined line).
  let metaOk = true, badMeta = '';
  for (const type of Object.keys(info)) {
    if (!info[type].name || !info[type].col || !info[type].trait) { metaOk = false; badMeta = type; }
  }
  ok(metaOk, 'every ENEMY_INFO entry has name + col + trait' + (badMeta ? ' (bad: ' + badMeta + ')' : ''));
  // BESPOKE HOSTILES must opt into the codex. Formation enemies are registered
  // by the shared kill path (`unlockDex(e.type)`), but a one-off entity like the
  // rival or the magpie has its own kill site and has to call unlockDex itself
  // — which is precisely the wiring that was missed when they shipped.
  for (const t of ['rival', 'magpie']) {
    ok(!!info[t], t + ' has a bestiary entry (it is an enemy the player destroys)');
    ok(G.getEnemyPoints(t, false) > 50,
       t + ' has a truthful point value, not the switch default');
    ok(new RegExp("unlockDex\\('" + t + "'\\)").test(scriptSrc),
       t + " calls unlockDex('" + t + "') at its kill site");
    ok(new RegExp('killsByTypeRun\\.' + t).test(scriptSrc),
       t + ' increments the lifetime kills-by-type tally');
  }
} else { console.log('  (skipped — ENEMY_INFO/getEnemyPoints not exposed)'); }

// ============================================================
section('every biome that spawns has reachable weather (biome ↔ WEATHER_TABLE)');
if (typeof G.biomeForStage === 'function' && G.__getWeatherTable()) {
  const wt = G.__getWeatherTable();
  // Set of biomes that any WEATHER_TABLE entry targets.
  const weatherBiomes = new Set(Object.values(wt).map(w => w.biome));
  let allHaveWeather = true, bad = '';
  const seen = new Set();
  for (let s = 8; s < 8 + 48; s++) {
    const b = G.biomeForStage(s);
    if (!b || seen.has(b)) continue;
    seen.add(b);
    if (!weatherBiomes.has(b)) { allHaveWeather = false; bad = b; }
  }
  ok(allHaveWeather, 'every spawning biome has >=1 weather entry' + (bad ? ' (missing: ' + bad + ')' : ''));
  // REVERSE direction — every weather entry must target a biome that actually
  // spawns, else it's dead data: pickStageWeather's `w.biome === biome` filter
  // can never match a typo'd or orphaned biome, so that weather silently never
  // appears. (`seen` holds the biomes biomeForStage produces over a full cycle.)
  let allReachable = true, deadW = '';
  for (const id of Object.keys(wt)) {
    if (!seen.has(wt[id].biome)) { allReachable = false; deadW = id + '→' + wt[id].biome; }
  }
  ok(allReachable, 'every weather entry targets a real spawning biome (no dead weather)' + (deadW ? ' (dead: ' + deadW + ')' : ''));
  // Every weather entry must carry label + col + whisper for the entry banner.
  let metaOk = true, badW = '';
  for (const id of Object.keys(wt)) {
    const w = wt[id];
    if (!w.label || !w.col || !w.whisper) { metaOk = false; badW = id; }
  }
  ok(metaOk, 'every WEATHER_TABLE entry has label + col + whisper' + (badW ? ' (bad: ' + badW + ')' : ''));
} else { console.log('  (skipped — WEATHER_TABLE/biomeForStage not exposed)'); }

// ============================================================
section('STATE machine: every state handled in BOTH update() and draw() switches');
{
  // Source-level structural guard. CLAUDE.md: a new STATE must be wired into both
  // the update() and draw() switches or the game freezes / renders blank in it.
  const enumMatch = scriptSrc.match(/const STATE = \{([^}]*)\}/);
  ok(!!enumMatch, 'STATE enum found in source');
  if (enumMatch) {
    const keys = enumMatch[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
    eq(keys.length, 10, 'STATE has 10 members');
    let allWiredTwice = true, under = [];
    for (const k of keys) {
      // count "case STATE.<k>:" occurrences (case-label, allowing trailing space/brace)
      const re = new RegExp('case STATE\\.' + k + '\\s*:', 'g');
      const n = (scriptSrc.match(re) || []).length;
      if (n < 2) { allWiredTwice = false; under.push(k + '×' + n); }
    }
    ok(allWiredTwice, 'every STATE has a case in both switches' + (under.length ? ' (under-wired: ' + under.join(', ') + ')' : ''));
  }
}

// ============================================================
section('isPowerMaxed detects the full S/N/P build exactly');
if (typeof G.isPowerMaxed === 'function' && G.__getMaxPowerLvl()) {
  const MAX = G.__getMaxPowerLvl();
  const g = fresh();
  g.lvl = { S: 1, N: 1, P: 1 };
  eq(G.isPowerMaxed(), false, 'fresh 1/1/1 = not maxed');
  g.lvl = { S: MAX.S, N: MAX.N, P: MAX.P };
  eq(G.isPowerMaxed(), true, 'all at cap = maxed');
  g.lvl = { S: MAX.S, N: MAX.N, P: MAX.P - 1 };
  eq(G.isPowerMaxed(), false, 'one below cap (P) = not maxed');
  g.lvl = { S: MAX.S - 1, N: MAX.N, P: MAX.P };
  eq(G.isPowerMaxed(), false, 'one below cap (S) = not maxed');
  // sanity: documented caps
  eq(MAX.S, 5, 'MAX_POWER_LVL.S = 5');
  eq(MAX.N, 3, 'MAX_POWER_LVL.N = 3');
  eq(MAX.P, 3, 'MAX_POWER_LVL.P = 3');
} else { console.log('  (skipped — isPowerMaxed/MAX_POWER_LVL not exposed)'); }

// ============================================================
section('bezierPoint cubic curve invariants');
if (typeof G.bezierPoint === 'function') {
  const p0 = { x: 0, y: 0 }, p1 = { x: 10, y: 30 }, p2 = { x: 90, y: 30 }, p3 = { x: 100, y: 0 };
  const at0 = G.bezierPoint(p0, p1, p2, p3, 0);
  eq(at0.x, 0, 'B(0).x = p0.x'); eq(at0.y, 0, 'B(0).y = p0.y');
  const at1 = G.bezierPoint(p0, p1, p2, p3, 1);
  eq(at1.x, 100, 'B(1).x = p3.x'); eq(at1.y, 0, 'B(1).y = p3.y');
  // midpoint formula: (p0 + 3p1 + 3p2 + p3) / 8
  const mid = G.bezierPoint(p0, p1, p2, p3, 0.5);
  eq(mid.x, (0 + 3 * 10 + 3 * 90 + 100) / 8, 'B(0.5).x = weighted midpoint');
  eq(mid.y, (0 + 3 * 30 + 3 * 30 + 0) / 8, 'B(0.5).y = weighted midpoint');
  // linear control points (all on the line y=x) → curve stays on the line
  const L = t => G.bezierPoint({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, t);
  let onLine = true;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) { const p = L(t); if (Math.abs(p.x - p.y) > 1e-9) onLine = false; }
  ok(onLine, 'collinear control points keep curve on the line');
} else { console.log('  (skipped — bezierPoint not exposed)'); }

// ============================================================
section('bumpCombo increments combo + refreshes decay timer + tracks best');
if (typeof G.bumpCombo === 'function' && G.__getComboDecay()) {
  const DECAY = G.__getComboDecay();
  const g = fresh();
  g.combo = 0; g.comboBest = 0; g.comboTimer = 0;
  G.bumpCombo();
  eq(g.combo, 1, 'first kill = combo 1');
  eq(g.comboTimer, DECAY, 'comboTimer refreshed to COMBO_DECAY');
  ok(g.comboBest >= 1, 'comboBest tracks at least 1');
  for (let i = 0; i < 4; i++) G.bumpCombo();
  eq(g.combo, 5, 'five kills = combo 5');
  ok(g.comboBest >= 5, 'comboBest >= 5 after streak');
  // simulate decay then a fresh kill — timer should refresh, combo keeps climbing
  g.comboTimer = 1;
  G.bumpCombo();
  eq(g.comboTimer, DECAY, 'timer refreshes on each kill');
  eq(g.combo, 6, 'combo continues climbing');
} else { console.log('  (skipped — bumpCombo/COMBO_DECAY not exposed)'); }

// ============================================================
section('eliteRateForStage — stage curve + difficulty scaling');
if (typeof G.eliteRateForStage === 'function') {
  // base curve (pass mode explicitly to avoid global difficultyMode coupling)
  eq(G.eliteRateForStage(1, 'normal'), 0,    'stage 1 = 0 (no elites)');
  eq(G.eliteRateForStage(4, 'normal'), 0,    'stage 4 = 0');
  eq(G.eliteRateForStage(5, 'normal'), 0.03, 'stage 5 = 3%');
  eq(G.eliteRateForStage(9, 'normal'), 0.03, 'stage 9 = 3%');
  eq(G.eliteRateForStage(10, 'normal'), 0.05,'stage 10 = 5%');
  eq(G.eliteRateForStage(32, 'normal'), 0.05,'stage 32 = 5% (deep ladder has not opened yet)');
  // Past stage 32 the DEEP PRESSURE ladder keeps thickening the formation —
  // this used to sit flat at 5% forever, which was the 69-stage plateau.
  ok(G.eliteRateForStage(50, 'normal') > 0.05, 'stage 50 > 5% (deep ladder engaged)');
  ok(Math.abs(G.eliteRateForStage(80, 'normal') - 0.12) < 1e-9, 'stage 80 tops out at 12%');
  eq(G.eliteRateForStage(100, 'normal'), G.eliteRateForStage(80, 'normal'),
     'the elite ramp itself stops at 80 (ghosts carry the curve past it)');
  // difficulty scaling
  ok(Math.abs(G.eliteRateForStage(10, 'hard') - 0.075) < 1e-9, 'hard = base ×1.5 (7.5%)');
  ok(Math.abs(G.eliteRateForStage(10, 'easy') - 0.025) < 1e-9, 'easy = base ×0.5 (2.5%)');
  // base-0 stays 0 regardless of difficulty
  eq(G.eliteRateForStage(3, 'hard'), 0, 'pre-stage-5 stays 0 even on hard');
  eq(G.eliteRateForStage(3, 'easy'), 0, 'pre-stage-5 stays 0 even on easy');
  // hard > normal > easy ordering at any elite-eligible stage
  ok(G.eliteRateForStage(20, 'hard') > G.eliteRateForStage(20, 'normal'), 'hard > normal');
  ok(G.eliteRateForStage(20, 'normal') > G.eliteRateForStage(20, 'easy'), 'normal > easy');
} else { console.log('  (skipped — eliteRateForStage not exposed)'); }

// ============================================================
section('powerUpDropRate — base + difficulty delta + floor');
if (typeof G.powerUpDropRate === 'function') {
  ok(Math.abs(G.powerUpDropRate(false, 'normal') - 0.20) < 1e-9, 'normal non-elite = 20%');
  ok(Math.abs(G.powerUpDropRate(true, 'normal') - 0.35) < 1e-9,  'normal elite = 35%');
  ok(Math.abs(G.powerUpDropRate(false, 'easy') - 0.25) < 1e-9,   'easy non-elite = 25% (+5)');
  ok(Math.abs(G.powerUpDropRate(false, 'hard') - 0.15) < 1e-9,   'hard non-elite = 15% (-5)');
  ok(Math.abs(G.powerUpDropRate(true, 'easy') - 0.40) < 1e-9,    'easy elite = 40%');
  ok(Math.abs(G.powerUpDropRate(true, 'hard') - 0.30) < 1e-9,    'hard elite = 30%');
  // elite always beats non-elite at the same difficulty
  ok(G.powerUpDropRate(true, 'hard') > G.powerUpDropRate(false, 'hard'), 'elite > non-elite (hard)');
  // easy > normal > hard for the same enemy class
  ok(G.powerUpDropRate(false, 'easy') > G.powerUpDropRate(false, 'normal'), 'easy > normal');
  ok(G.powerUpDropRate(false, 'normal') > G.powerUpDropRate(false, 'hard'), 'normal > hard');
  // floor: never below 5% even if base+delta would dip lower
  ok(G.powerUpDropRate(false, 'hard') >= 0.05, 'floored at >= 5%');
} else { console.log('  (skipped — powerUpDropRate not exposed)'); }

// ============================================================
section('SFX_VARY — pitch-wobble set excludes melodic cues');
if (G.__getSfxVary && G.__getSfxVary()) {
  const vary = G.__getSfxVary();
  // Percussive combat SFX should get per-shot variation
  ['shoot', 'explode', 'hit', 'crit'].forEach(t =>
    ok(vary.has(t), 'combat SFX "' + t + '" gets pitch variation'));
  // Melodic / sequenced cues must NOT be detuned (would wobble the tune)
  ['milestone', 'fanfareChallenge', 'comboStep', 'stageStart', 'extraLife', 'powerUp'].forEach(t =>
    ok(!vary.has(t), 'melodic cue "' + t + '" stays consistent (no wobble)'));
} else { console.log('  (skipped — SFX_VARY not exposed)'); }

// ============================================================
section('panForX — spatial SFX stereo mapping');
if (typeof G.panForX === 'function') {
  const BW = 224; // BASE_W
  eq(G.panForX(BW / 2), 0, 'screen centre → centered (pan 0)');
  ok(G.panForX(0) < 0, 'left edge pans left (negative)');
  ok(G.panForX(BW) > 0, 'right edge pans right (positive)');
  ok(Math.abs(G.panForX(0)) <= 1 && Math.abs(G.panForX(BW)) <= 1, 'pan stays within [-1,1]');
  ok(Math.abs(G.panForX(0)) <= 0.85 + 1e-9, 'softened — edges not hard-panned past 0.85');
  ok(G.panForX(BW * 0.25) < G.panForX(BW * 0.75), 'monotonic left→right');
  // non-positional / global cues collapse to centre
  eq(G.panForX(undefined), 0, 'undefined x → centered');
  eq(G.panForX(NaN), 0, 'NaN x → centered');
  // out-of-range x clamps rather than exceeding the field
  ok(Math.abs(G.panForX(-500)) <= 0.85 + 1e-9, 'x below 0 clamps');
  ok(Math.abs(G.panForX(99999)) <= 0.85 + 1e-9, 'x above BASE_W clamps');
} else { console.log('  (skipped — panForX not exposed)'); }

// ============================================================
section('playSound — spatial + detune branches execute cleanly');
if (typeof G.playSound === 'function') {
  let threw = null;
  try {
    G.playSound('explode', 50);      // panned (StereoPanner) + varied (detune)
    G.playSound('crit', 200);        // panned right + varied
    G.playSound('shoot', undefined); // varied, centered (no panner)
    G.playSound('hit');              // varied, no panX
    G.playSound('milestone');        // melodic: centered, NOT detuned
    G.playSound('explode', -999);    // out-of-range x still routes
  } catch (e) { threw = e; }
  ok(threw === null, 'playSound runs panner/detune branches without throwing'
     + (threw ? ' — ' + threw.message : ''));
} else { console.log('  (skipped — playSound not exposed)'); }

// ============================================================
section('computeBgmIntensity / computeBgmPitch — BGM modulation');
{
  const bg = G.__getGame && G.__getGame();
  if (bg && typeof G.computeBgmIntensity === 'function') {
    const save = { combo: bg.combo, lives: bg.lives, state: bg.state,
                   cleanStreak: bg.cleanStreak, megaBosses: bg.megaBosses, stageDied: bg.stageDied };
    const near = (a, b, m) => ok(Math.abs(a - b) < 1e-9, m);
    // Baseline (PLAYING==2, no combo/boss, 3 lives, no clean streak)
    bg.combo = 0; bg.lives = 3; bg.cleanStreak = 0; bg.megaBosses = []; bg.state = 2; bg.stageDied = false;
    near(G.computeBgmIntensity(), 1.0, 'baseline intensity = 1.0');
    bg.combo = 30;  near(G.computeBgmIntensity(), 1.2, 'combo 30 → +0.20');
    bg.combo = 60;  near(G.computeBgmIntensity(), 1.3, 'combo 60 → +0.30');
    bg.combo = 100; near(G.computeBgmIntensity(), 1.4, 'combo 100 → +0.40');
    bg.combo = 0; bg.lives = 1; near(G.computeBgmIntensity(), 1.2, 'last life (PLAYING) → +0.20');
    bg.lives = 3; near(G.computeBgmIntensity(), 1.0, 'last-life lift gated on lives===1');
    // stacked lifts clamp at 1.55 (combo .40 + boss .30 + last-life .20 = 1.90)
    bg.combo = 100; bg.lives = 1; bg.megaBosses = [{ alive: true, phase2: true }];
    near(G.computeBgmIntensity(), 1.55, 'stacked lifts cap at 1.55');
    if (typeof G.computeBgmPitch === 'function') {
      bg.megaBosses = []; near(G.computeBgmPitch(), 1.0, 'no boss → pitch 1.0');
      bg.megaBosses = [{ alive: true, archetype: 'horned' }];
      ok(G.computeBgmPitch() > 1.0, 'horned boss → pitched up');
      bg.megaBosses = [{ alive: true, archetype: 'tendril' }];
      ok(G.computeBgmPitch() < 1.0, 'tendril boss → pitched down');
      bg.megaBosses = [{ alive: true, archetype: 'crystal' }];
      ok(G.computeBgmPitch() > 1.1, 'crystal boss → +2 semitones');
      bg.megaBosses = [{ alive: true, super: true, archetype: 'crystal' }];
      near(G.computeBgmPitch(), 1.0, 'super boss keeps base pitch (track already distinct)');
      bg.megaBosses = [{ alive: false, archetype: 'horned' }];
      near(G.computeBgmPitch(), 1.0, 'dead boss ignored → 1.0');
    }
    Object.assign(bg, save);
  } else { console.log('  (skipped — computeBgmIntensity / game not exposed)'); }
}

// ============================================================
section('bgmForGameState — track selection by state/stage/phase');
{
  const bg = G.__getGame && G.__getGame();
  if (bg && typeof G.bgmForGameState === 'function') {
    const save = { stage: bg.stage, megaBosses: bg.megaBosses };
    bg.megaBosses = [];
    bg.stage = 1;  eq(G.bgmForGameState(2), 'normal',    'early normal stage → normal');
    bg.stage = 15; eq(G.bgmForGameState(2), 'normalMid', 'stage 15+ normal → normalMid');
    bg.stage = 10; eq(G.bgmForGameState(8), 'boss',      'boss stage <30 → boss');
    bg.stage = 30; eq(G.bgmForGameState(8), 'bossSuper', 'boss stage 30+ → bossSuper');
    bg.megaBosses = [{ alive: true, phase2: true }];
    bg.stage = 10; eq(G.bgmForGameState(8), 'bossEnrage', 'phase-2 boss → bossEnrage (overrides super)');
    bg.stage = 30; eq(G.bgmForGameState(8), 'bossEnrage', 'phase-2 wins even at stage 30+');
    Object.assign(bg, save);
  } else { console.log('  (skipped — bgmForGameState / game not exposed)'); }
}

// ============================================================
section('fmtMS — frame count → mm:ss');
if (typeof G.fmtMS === 'function') {
  eq(G.fmtMS(0), '00:00', '0 frames → 00:00');
  eq(G.fmtMS(60), '00:01', '60 frames = 1s → 00:01');
  eq(G.fmtMS(3600), '01:00', '3600 frames = 60s → 01:00');
  eq(G.fmtMS(90 * 60), '01:30', '90s → 01:30');
  eq(G.fmtMS(3599), '00:59', 'rounds down to whole seconds');
  eq(G.fmtMS(undefined), '--:--', 'non-number → placeholder');
  eq(G.fmtMS(null), '--:--', 'null → placeholder');
} else { console.log('  (skipped — fmtMS not exposed)'); }


// ============================================================
section('computePilotTitle / computePilotNextRank — rank ladder');
{
  const dex = G.__getDexUnlocked && G.__getDexUnlocked();
  const ach = G.__getUnlockedAch && G.__getUnlockedAch();
  if (typeof G.computePilotTitle === 'function' && dex && ach) {
    const dexSave = [...dex], achSave = [...ach];
    const lsN = sandbox.localStorage.getItem('galagaCumStats');
    const lsC = sandbox.localStorage.getItem('galagaCumStatsChallenge');
    const setStats = (o) => {
      sandbox.localStorage.setItem('galagaCumStats', JSON.stringify(o));
      sandbox.localStorage.setItem('galagaCumStatsChallenge', JSON.stringify({}));
    };
    dex.clear(); ach.clear();
    // Ladder climbs in priority order; each tier needs the prior thresholds + its own.
    setStats({ sessions: 0, kills: 0, bestStage: 0 });
    eq(G.computePilotTitle(), 'ROOKIE', 'fresh pilot → ROOKIE');
    eq(G.computePilotNextRank().next, 'PILOT', 'ROOKIE next rank → PILOT');
    setStats({ sessions: 10, kills: 0, bestStage: 0 });
    eq(G.computePilotTitle(), 'PILOT', '10 runs → PILOT');
    setStats({ sessions: 10, kills: 1000, bestStage: 0 });
    eq(G.computePilotTitle(), 'VETERAN', '1000 kills → VETERAN');
    setStats({ sessions: 10, kills: 1000, bestStage: 30 });
    eq(G.computePilotTitle(), 'APEX SURVIVOR', 'best stage 30 → APEX SURVIVOR');
    for (let i = 0; i < 8; i++) dex.add('dex' + i);
    eq(G.computePilotTitle(), 'BESTIARY MASTER', '8 dex entries outrank APEX');
    for (let i = 0; i < 200; i++) ach.add('ach' + i); // > any plausible total → >=80%
    eq(G.computePilotTitle(), 'ACE PILOT', '80%+ achievements → ACE PILOT (peak)');
    eq(G.computePilotNextRank().next, null, 'ACE PILOT → no next rank (MAX)');
    // restore
    dex.clear(); dexSave.forEach(x => dex.add(x));
    ach.clear(); achSave.forEach(x => ach.add(x));
    if (lsN === null) sandbox.localStorage.removeItem('galagaCumStats'); else sandbox.localStorage.setItem('galagaCumStats', lsN);
    if (lsC === null) sandbox.localStorage.removeItem('galagaCumStatsChallenge'); else sandbox.localStorage.setItem('galagaCumStatsChallenge', lsC);
  } else { console.log('  (skipped — pilot-title helpers / sets not exposed)'); }
}

// ============================================================
section('daily mode — determinism + structural validity');
if (typeof G.dailySeed === 'function') {
  const seed = G.dailySeed();
  ok(Number.isInteger(seed) && seed > 20000000, 'dailySeed → YYYYMMDD-encoded integer');
  eq(G.dailySeed(), seed, 'dailySeed is stable within a day (the whole point of "daily")');
  if (typeof G.dailyLabel === 'function') {
    const lbl = G.dailyLabel();
    eq(typeof lbl, 'string', 'dailyLabel is a string');
    eq(lbl.length, 6, 'dailyLabel → 6-char YYMMDD');
  }
  if (typeof G.dailyShipFor === 'function') {
    const order = G.__getShipOrder && G.__getShipOrder();
    if (order) {
      ok(order.includes(G.dailyShipFor(seed)), 'dailyShipFor → a real ship key');
      eq(G.dailyShipFor(0), G.dailyShipFor(order.length), 'dailyShipFor cycles with the seed');
      eq(G.dailyShipFor(seed), G.dailyShipFor(seed), 'dailyShipFor deterministic for a seed');
    }
  }
  if (typeof G.dailyMutation === 'function') {
    const m1 = G.dailyMutation(), m2 = G.dailyMutation();
    ok(m1 && typeof m1 === 'object', 'dailyMutation → a mutation object');
    ok(typeof m1.label === 'string' && m1.label.length > 0, 'mutation has a label');
    eq(m1, m2, 'same day → same mutation (deterministic, identical object)');
  }
  if (typeof G.dailyMission === 'function') {
    const missions = G.__getDailyMissions && G.__getDailyMissions();
    const mm1 = G.dailyMission(), mm2 = G.dailyMission();
    ok(mm1 && typeof mm1 === 'object', 'dailyMission → a mission object');
    eq(mm1, mm2, 'same day → same mission (deterministic)');
    if (missions) ok(missions.includes(mm1), 'dailyMission is a member of DAILY_MISSIONS');
  }
  if (typeof G.isDailyMissionDoneToday === 'function') {
    const key = 'galagaDailyMissionDone';
    const saved = sandbox.localStorage.getItem(key);
    sandbox.localStorage.removeItem(key);
    ok(!G.isDailyMissionDoneToday(), 'no record → mission not done');
    sandbox.localStorage.setItem(key, String(G.dailySeed()));
    ok(G.isDailyMissionDoneToday(), "today's seed recorded → done");
    sandbox.localStorage.setItem(key, '19990101');
    ok(!G.isDailyMissionDoneToday(), 'a stale (different-day) record does not count as done');
    if (saved === null) sandbox.localStorage.removeItem(key); else sandbox.localStorage.setItem(key, saved);
  }
} else { console.log('  (skipped — dailySeed not exposed)'); }

// ============================================================
section('computeDailyStreak — consecutive-day counting');
if (typeof G.computeDailyStreak === 'function') {
  const key = 'galagaDailyDays';
  const saved = sandbox.localStorage.getItem(key);
  // Build day keys relative to *today* so the test is date-agnostic (matches the
  // function's own YYYYMMDD construction).
  const dayKey = (off) => {
    const d = new Date(Date.now() - off * 86400000);
    return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  };
  const setDays = (arr) => sandbox.localStorage.setItem(key, JSON.stringify(arr));
  setDays([]);                                  eq(G.computeDailyStreak(), 0, 'no recorded days → 0');
  setDays([dayKey(0)]);                          eq(G.computeDailyStreak(), 1, 'today only → 1');
  setDays([dayKey(0), dayKey(1)]);               eq(G.computeDailyStreak(), 2, 'today + yesterday → 2');
  setDays([dayKey(0), dayKey(1), dayKey(2)]);    eq(G.computeDailyStreak(), 3, '3 consecutive days → 3');
  setDays([dayKey(0), dayKey(2)]);               eq(G.computeDailyStreak(), 1, 'gap at yesterday ends the streak at 1');
  setDays([dayKey(1)]);                          eq(G.computeDailyStreak(), 0, "today not played → 0 (streak requires today)");
  if (saved === null) sandbox.localStorage.removeItem(key); else sandbox.localStorage.setItem(key, saved);
} else { console.log('  (skipped — computeDailyStreak not exposed)'); }

// ============================================================
section('bulletCap — performance caps trim the oldest entries');
{
  const bc = G.__getGame && G.__getGame();
  if (bc && typeof G.bulletCap === 'function') {
    const save = { enemyBullets: bc.enemyBullets, floatTexts: bc.floatTexts, itemBursts: bc.itemBursts };
    bc.enemyBullets = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    bc.floatTexts   = Array.from({ length: 70 },  (_, i) => ({ id: i }));
    bc.itemBursts   = Array.from({ length: 130 }, (_, i) => ({ id: i }));
    G.bulletCap();
    eq(bc.enemyBullets.length, 80, 'enemy bullets capped at 80');
    eq(bc.floatTexts.length, 50, 'float texts capped at 50');
    eq(bc.itemBursts.length, 100, 'item bursts capped at 100');
    eq(bc.enemyBullets[0].id, 20, 'drops the oldest, keeps the newest 80');
    eq(bc.floatTexts[bc.floatTexts.length - 1].id, 69, 'newest float text retained');
    // under the cap → untouched
    bc.enemyBullets = [{ id: 1 }, { id: 2 }]; G.bulletCap();
    eq(bc.enemyBullets.length, 2, 'arrays under the cap are left alone');
    Object.assign(bc, save);
  } else { console.log('  (skipped — bulletCap / game not exposed)'); }
}

// ============================================================
section('COMBO_ARSENAL — buffs map to real weapon timers, ascending tiers');
{
  const ars = G.__getComboArsenal && G.__getComboArsenal();
  if (ars) {
    // the grant logic sets game[<buff>Timer] only for these four; an unknown buff
    // would claim the tier but grant nothing.
    const handled = new Set(['rapid', 'wave', 'homing', 'laser']);
    let validBuffs = true, ascending = true, wellFormed = true;
    for (let i = 0; i < ars.length; i++) {
      const a = ars[i];
      if (!handled.has(a.buff)) validBuffs = false;
      if (!(typeof a.combo === 'number' && typeof a.duration === 'number' && a.duration > 0 && a.label && a.color)) wellFormed = false;
      if (i > 0 && !(a.combo > ars[i - 1].combo)) ascending = false;
    }
    ok(validBuffs, 'every arsenal buff is a granted weapon (rapid/wave/homing/laser)');
    ok(ascending, 'combo thresholds strictly ascending');
    ok(wellFormed, 'every tier has combo/duration/label/color');
  } else { console.log('  (skipped — COMBO_ARSENAL not exposed)'); }
}

// ============================================================
section('ENDURANCE_TIERS — strictly ascending frames, well-formed');
{
  const tiers = G.__getEnduranceTiers && G.__getEnduranceTiers();
  if (tiers) {
    let ascending = true, wellFormed = true, bonusUp = true;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      if (!(typeof t.frames === 'number' && t.label && typeof t.bonus === 'number' && t.col && typeof t.size === 'number')) wellFormed = false;
      if (i > 0 && !(t.frames > tiers[i - 1].frames)) ascending = false; // strict → fired-flag keys (by frames) stay unique
      if (i > 0 && !(t.bonus >= tiers[i - 1].bonus)) bonusUp = false;
    }
    ok(wellFormed, 'every tier has frames/label/bonus/col/size');
    ok(ascending, 'frames strictly ascending (unique fired-flag keys, in-order firing)');
    ok(bonusUp, 'reward grows (or holds) with each later milestone');
  } else { console.log('  (skipped — ENDURANCE_TIERS not exposed)'); }
}

// ============================================================
section('STAGE_MUTATIONS — ids match read-sites, fields well-formed');
{
  const muts = G.__getStageMutations && G.__getStageMutations();
  if (muts) {
    // The four mutation effects are gated by `stageMutation.id === 'X'` at their
    // read-sites (updatePlayer/updateEnemies/updateBullets/diffFireMul). The id set
    // must match exactly, or a renamed/added mutation silently does nothing.
    const ids = muts.map(m => m.id).sort();
    const expected = ['denseFire', 'fastDives', 'rapidFire', 'slowBullets'];
    eq(JSON.stringify(ids), JSON.stringify(expected), 'mutation ids exactly match the four read-site gates');
    let wellFormed = muts.every(m => typeof m.id === 'string' && m.label && m.color && m.desc);
    ok(wellFormed, 'every mutation has id/label/color/desc (HUD badge fields)');
  } else { console.log('  (skipped — STAGE_MUTATIONS not exposed)'); }
}

// ============================================================
section('ACT_TITLES — contiguous stage ranges, well-formed');
{
  const acts = G.__getActTitles && G.__getActTitles();
  if (acts) {
    let wellFormed = acts.every(a => a.num && typeof a.startStage === 'number' && a.col);
    ok(wellFormed, 'every act has num/startStage/col');
    // Ranges must chain with no gap/overlap so no stage falls between acts.
    let contiguous = true;
    for (let i = 0; i < acts.length - 1; i++) {
      if (acts[i].endStage == null || acts[i].endStage + 1 !== acts[i + 1].startStage) contiguous = false;
    }
    ok(contiguous, 'act ranges are contiguous (endStage+1 === next startStage)');
    eq(acts[acts.length - 1].endStage, null, 'final act is open-ended (endStage null)');
  } else { console.log('  (skipped — ACT_TITLES not exposed)'); }
}

// ============================================================
section('INTERCEPT_MSG registry — every message reachable & well-formed');
{
  const msg = G.__getInterceptMsg && G.__getInterceptMsg();
  if (msg) {
    // every entry must be a non-empty array of non-empty strings (pushIntercept
    // picks a random variant — an empty entry would silently show nothing)
    let allOk = true;
    for (const k of Object.keys(msg)) {
      const v = msg[k];
      if (!Array.isArray(v) || v.length === 0 || !v.every(s => typeof s === 'string' && s.length)) { allOk = false; }
    }
    ok(allOk, 'every INTERCEPT_MSG entry is a non-empty string[]');
  } else { console.log('  (skipped — INTERCEPT_MSG not exposed)'); }
}

// ============================================================
section('bossNameFor — boss name by stage + cycling past the list');
if (typeof G.bossNameFor === 'function') {
  eq(G.bossNameFor(5), 'BOSS', 'pre-first-boss stage → generic BOSS');
  eq(G.bossNameFor(9), 'BOSS', 'stage 9 (still pre-boss) → BOSS');
  ok(G.bossNameFor(10) !== 'BOSS', 'first boss stage → a named boss');
  ok(G.bossNameFor(20) !== G.bossNameFor(10), 'consecutive boss stages → different names');
  const names = G.__getBossNames && G.__getBossNames();
  if (names && names.length) {
    eq(G.bossNameFor(10), names[0], 'stage 10 → first name');
    eq(G.bossNameFor(20), names[1 % names.length], 'stage 20 → second name');
    // wraps after the list is exhausted
    eq(G.bossNameFor(10 + 10 * names.length), G.bossNameFor(10), 'names cycle once the list is exhausted');
  }
} else { console.log('  (skipped — bossNameFor not exposed)'); }

// ============================================================
section('createLoopPath — multi-segment dive path is continuous');
if (typeof G.createLoopPath === 'function') {
  const segs = G.createLoopPath(112, 40, 1);
  ok(Array.isArray(segs) && segs.length === 3, 'returns 3 chained segments');
  eq(segs[0].p0.x, 112, 'starts at given x');
  eq(segs[0].p0.y, 40, 'starts at given y');
  // each segment's end must equal the next segment's start (no teleport mid-dive)
  ok(segs[0].p3.x === segs[1].p0.x && segs[0].p3.y === segs[1].p0.y, 'seg0 → seg1 join is continuous');
  ok(segs[1].p3.x === segs[2].p0.x && segs[1].p3.y === segs[2].p0.y, 'seg1 → seg2 join is continuous');
  // mirror side bows the other way on the first control point
  const segsL = G.createLoopPath(112, 40, -1);
  ok((segsL[0].p1.x - 112) === -(segs[0].p1.x - 112), 'side -1 mirrors the dive horizontally');
} else { console.log('  (skipped — createLoopPath not exposed)'); }

// ============================================================
section('comboTierName — combo medal tiers (HUD ↔ carry banner share)');
if (typeof G.comboTierName === 'function') {
  eq(G.comboTierName(0), null, 'combo 0 → no tier');
  eq(G.comboTierName(4), null, 'below 5 → no tier (BRONZE floor)');
  eq(G.comboTierName(5), 'BRONZE', '5 → BRONZE');
  eq(G.comboTierName(10), 'SILVER', '10 → SILVER');
  eq(G.comboTierName(15), 'GOLD', '15 → GOLD');
  eq(G.comboTierName(20), 'PLATINUM', '20 → PLATINUM');
  eq(G.comboTierName(30), 'MAX', '30 → MAX (peak)');
  eq(G.comboTierName(100), 'MAX', 'caps at MAX');
  eq(G.comboTierName(19), 'GOLD', 'just under PLATINUM → GOLD');
} else { console.log('  (skipped — comboTierName not exposed)'); }

// ============================================================
section('comboTierColor — combo multiplier tier color (3 HUD sites share)');
if (typeof G.comboTierColor === 'function') {
  // Tiers keyed on the multiplier value from comboMultiplier (1 / 1.5 / 2 / 2.5 / 3).
  eq(G.comboTierColor(1),   '#0ff', 'base mult → cyan');
  eq(G.comboTierColor(1.25),'#0ff', 'below 1.5 → cyan');
  eq(G.comboTierColor(1.5), '#ff4', '1.5 → yellow');
  eq(G.comboTierColor(2),   '#f80', '2 → orange');
  eq(G.comboTierColor(2.5), '#f6f', '2.5 → magenta');
  eq(G.comboTierColor(3),   '#f6f', '3 (max) → magenta');
  // Cross-check: the tier color matches what comboMultiplier yields per combo.
  if (typeof G.comboMultiplier === 'function') {
    eq(G.comboTierColor(G.comboMultiplier(20)), '#f6f', 'combo 20 (×2.5+) → magenta');
    eq(G.comboTierColor(G.comboMultiplier(3)),  '#0ff', 'combo 3 (×1.25) → cyan');
  }
} else { console.log('  (skipped — comboTierColor not exposed)'); }

// ============================================================
section('computeRunGradeScore / runGradeLetter — run grade');
if (typeof G.computeRunGradeScore === 'function' && typeof G.runGradeLetter === 'function') {
  const near = (a, b, m) => ok(Math.abs(a - b) < 1e-9, m);
  // maxStage floors at 1, so even a 0-score/0-acc run carries a tiny depth credit
  near(G.computeRunGradeScore(0, 0, 1), 0.2 / 30, 'stage-1 floor: only the depth term, capped fraction');
  // components cap; use maxStage 30 (full 0.2 depth) for clean sums
  near(G.computeRunGradeScore(100000, 0, 30), 0.7, 'score 0.5 + capped depth 0.2');
  near(G.computeRunGradeScore(0, 100, 30), 0.5, 'accuracy 0.3 + capped depth 0.2');
  near(G.computeRunGradeScore(0, 0, 30), 0.2, 'depth caps at 0.2 weight');
  near(G.computeRunGradeScore(200000, 100, 60), 1.0, 'all maxed (over-cap) → 1.0');
  // letter thresholds
  eq(G.runGradeLetter(0.85), 'S', '0.85 → S');
  eq(G.runGradeLetter(0.84), 'A', 'just under → A');
  eq(G.runGradeLetter(0.70), 'A', '0.70 → A');
  eq(G.runGradeLetter(0.55), 'B', '0.55 → B');
  eq(G.runGradeLetter(0.40), 'C', '0.40 → C');
  eq(G.runGradeLetter(0.39), 'D', 'below 0.40 → D');
  eq(G.runGradeLetter(0), 'D', '0 → D');
  // a flawless deep run earns S
  eq(G.runGradeLetter(G.computeRunGradeScore(150000, 95, 35)), 'S', 'flawless deep run → S');
} else { console.log('  (skipped — run-grade helpers not exposed)'); }

// ============================================================
section('computeAccuracy — hit % with zero-shot guard');
if (typeof G.computeAccuracy === 'function') {
  eq(G.computeAccuracy({ shotsFired: 0, shotsHit: 0 }), 0, 'no shots → 0 (no divide-by-zero)');
  eq(G.computeAccuracy({ shotsFired: 100, shotsHit: 100 }), 100, 'all hits → 100');
  eq(G.computeAccuracy({ shotsFired: 100, shotsHit: 50 }), 50, 'half → 50');
  eq(G.computeAccuracy({ shotsFired: 3, shotsHit: 1 }), 33, 'rounds (1/3 → 33)');
  eq(G.computeAccuracy({ shotsFired: 8, shotsHit: 7 }), 88, 'rounds (7/8 → 88)');
  eq(G.computeAccuracy({}), 0, 'missing fields → 0');
  eq(G.computeAccuracy(null), 0, 'null stats → 0 (no throw)');
} else { console.log('  (skipped — computeAccuracy not exposed)'); }

// ============================================================
section('computeStageAccuracy — reads current stage tallies (wraps computeAccuracy)');
if (typeof G.computeStageAccuracy === 'function') {
  const g = fresh();
  g.stageShotsFired = 0; g.stageShotsHit = 0;
  eq(G.computeStageAccuracy(), 0, 'no stage shots → 0 (zero-shot safe)');
  g.stageShotsFired = 100; g.stageShotsHit = 90;
  eq(G.computeStageAccuracy(), 90, '90/100 → 90');
  g.stageShotsFired = 3; g.stageShotsHit = 1;
  eq(G.computeStageAccuracy(), 33, 'rounds (1/3 → 33)');
  // Must agree with computeAccuracy fed the same tallies (single source).
  g.stageShotsFired = 8; g.stageShotsHit = 7;
  eq(G.computeStageAccuracy(), G.computeAccuracy({ shotsFired: 8, shotsHit: 7 }),
     'matches computeAccuracy on identical tallies');
} else { console.log('  (skipped — computeStageAccuracy not exposed)'); }

// ============================================================
section('blinkPhase — HUD blink phase (single source for ~42 inline checks)');
if (typeof G.blinkPhase === 'function') {
  const g = fresh();
  // blinkPhase(3) toggles every 8 frames (2^3): on for [0,8), off for [8,16)...
  g.animFrame = 0;  ok(G.blinkPhase(3) === true,  'frame 0, >>3 → on');
  g.animFrame = 7;  ok(G.blinkPhase(3) === true,  'frame 7, >>3 → still on');
  g.animFrame = 8;  ok(G.blinkPhase(3) === false, 'frame 8, >>3 → off');
  g.animFrame = 16; ok(G.blinkPhase(3) === true,  'frame 16, >>3 → on again');
  // shift controls rate: >>1 toggles every 2 frames.
  g.animFrame = 0;  ok(G.blinkPhase(1) === true,  'frame 0, >>1 → on');
  g.animFrame = 2;  ok(G.blinkPhase(1) === false, 'frame 2, >>1 → off');
  // Identity vs the inline form it replaced.
  g.animFrame = 37;
  ok(G.blinkPhase(2) === (((g.animFrame >> 2) % 2) === 0), 'matches inline (game.animFrame >> 2) % 2 === 0');
} else { console.log('  (skipped — blinkPhase not exposed)'); }

// ============================================================
section('flashAlpha — impact-flash alpha, CAPPED (whiteout root cause) + reduce-motion');
if (typeof G.flashAlpha === 'function') {
  // THE WHITEOUT GUARD: the uncapped form hit alpha 2.1 at timer 24 (boss beats) —
  // a fully opaque screen — and chained combat events held it there for seconds.
  eq(G.flashAlpha(8, false), 0.45, 'timer 8 → capped at 0.45 (was 0.7)');
  eq(G.flashAlpha(24, false), 0.45, 'timer 24 (max setter) → still 0.45, NEVER opaque');
  eq(G.flashAlpha(1000, false), 0.45, 'absurd timer → still 0.45 (hard ceiling)');
  ok(Math.abs(G.flashAlpha(4, false) - 0.35) < 1e-9, 'below the cap the decay curve is unchanged (4 → 0.35)');
  eq(G.flashAlpha(0, false), 0,   'no flash → 0');
  ok(Math.abs(G.flashAlpha(8, true) - 0.135) < 1e-9, 'reduce-motion → 30% of capped (0.135)');
  ok(G.flashAlpha(8, true) < G.flashAlpha(8, false), 'reduce-motion always dimmer than normal');
  eq(G.flashAlpha(undefined, false), 0, 'undefined timer → 0 (no NaN)');
  ok(G.flashAlpha(4, false) > G.flashAlpha(4, true), 'dampening holds at partial timer too');
} else { console.log('  (skipped — flashAlpha not exposed)'); }

// ============================================================
section('effectiveShakeMul — shake intensity, capped under reduce-motion');
if (typeof G.effectiveShakeMul === 'function') {
  eq(G.effectiveShakeMul('full', false), 1,   'full, normal → 1');
  eq(G.effectiveShakeMul('low',  false), 0.4, 'low, normal → 0.4');
  eq(G.effectiveShakeMul('off',  false), 0,   'off → 0');
  eq(G.effectiveShakeMul('full', true),  0.4, 'full, reduce-motion → capped to 0.4');
  eq(G.effectiveShakeMul('low',  true),  0.4, 'low, reduce-motion → 0.4 (unchanged)');
  eq(G.effectiveShakeMul('off',  true),  0,   'off, reduce-motion → 0 (still none)');
  ok(G.effectiveShakeMul('full', true) <= G.effectiveShakeMul('full', false),
     'reduce-motion never increases shake');
} else { console.log('  (skipped — effectiveShakeMul not exposed)'); }

// ============================================================
section('achievements — every definition is reachable and every unlock is defined');
// Registry guard (matches the "wired on both sides" guards): an achievement with
// no unlockAchievement() call is unreachable; an unlock call for an undefined key
// is dead. Defined keys come from runtime ACHIEVEMENTS; unlock calls are scanned
// from the source text (they're conditional code, not runtime-observable).
if (typeof G.__getAchievements === 'function' && G.__getAchievements()) {
  const defined = new Set(Object.keys(G.__getAchievements()));
  const called = new Set();
  { let mm; const re = /unlockAchievement\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
    while ((mm = re.exec(scriptSrc))) called.add(mm[1]); }
  const unreachable = [...defined].filter(k => !called.has(k));
  const dead        = [...called].filter(k => !defined.has(k));
  ok(unreachable.length === 0, 'every defined achievement has an unlock call' +
     (unreachable.length ? ' (unreachable: ' + unreachable.join(', ') + ')' : ''));
  ok(dead.length === 0, 'every unlockAchievement() targets a defined key' +
     (dead.length ? ' (dead: ' + dead.join(', ') + ')' : ''));
  ok(defined.size >= 50, 'achievement registry is populated (' + defined.size + ' defined)');
} else { console.log('  (skipped — ACHIEVEMENTS not exposed)'); }

// ============================================================
section('POWERUP_COL — every power-up type has a valid color (load-bearing source)');
// POWERUP_COL is the single source for ~10 buff-color display sites (gem, spawn
// burst, mini-gem, in-game + pause buff strips, bullet-profile, expiry alert, HELP
// legend, combo-unlock label). A missing/garbled key would break all of them, so
// guard that each power-up type resolves to a valid hex color. (D = dash is custom-
// colored and intentionally absent.)
if (typeof G.__getPowerupCol === 'function' && G.__getPowerupCol()) {
  const col = G.__getPowerupCol();
  const hex = /^#[0-9a-fA-F]{3,6}$/;
  for (const t of ['S','N','P','T','R','W','H','L','B','E','F']) {
    ok(typeof col[t] === 'string' && hex.test(col[t]),
       'POWERUP_COL.' + t + ' is a valid hex color (' + col[t] + ')');
  }
  ok(!('D' in col), 'D (dash) intentionally absent from POWERUP_COL (custom-colored)');
} else { console.log('  (skipped — POWERUP_COL not exposed)'); }

// ============================================================
section('GRADE_COL — single source, every grade letter has a valid color');
// Both stage-grade systems (boss/challenge pop + normal STAGE GRADE) now read this,
// so a letter is the same color everywhere. Guard completeness + valid hex.
if (typeof G.__getGradeCol === 'function' && G.__getGradeCol()) {
  const gc = G.__getGradeCol();
  const hex = /^#[0-9a-fA-F]{3,6}$/;
  for (const g of ['S','A','B','C','D']) {
    ok(typeof gc[g] === 'string' && hex.test(gc[g]), 'GRADE_COL.' + g + ' valid hex (' + gc[g] + ')');
  }
} else { console.log('  (skipped — GRADE_COL not exposed)'); }

// ============================================================
section('tryStartDash — shared dash trigger gating (keyboard/touch/gamepad)');
// One function now backs all three input paths, so its cooldown + i-frame + combat
// gates are load-bearing. Verify the dash starts only when ready and is a no-op
// otherwise (PLAYING = 2).
if (typeof G.tryStartDash === 'function') {
  let g = fresh(); g.state = 2; g.playerAlive = true; g.dashCooldown = 0; g.dashTimer = 0; g.invincibleTimer = 0;
  G.tryStartDash();
  eq(g.dashTimer, 12, 'ready → dash starts (12 i-frames)');
  eq(g.dashCooldown, 60, 'ready → 60f cooldown set');
  ok(g.invincibleTimer >= 14, 'ready → invincibility granted');

  g = fresh(); g.state = 2; g.playerAlive = true; g.dashCooldown = 30; g.dashTimer = 0;
  G.tryStartDash();
  eq(g.dashTimer, 0, 'cooldown active → no dash');
  eq(g.dashCooldown, 30, 'cooldown active → cooldown untouched');

  g = fresh(); g.state = 2; g.playerAlive = true; g.dashCooldown = 0; g.dashTimer = 5;
  G.tryStartDash();
  eq(g.dashTimer, 5, 'already dashing → no re-trigger');

  g = fresh(); g.state = 0; g.playerAlive = true; g.dashCooldown = 0; g.dashTimer = 0;
  G.tryStartDash();
  eq(g.dashTimer, 0, 'non-combat state (TITLE) → no dash');

  g = fresh(); g.state = 2; g.playerAlive = false; g.dashCooldown = 0; g.dashTimer = 0;
  G.tryStartDash();
  eq(g.dashTimer, 0, 'dead player → no dash');
} else { console.log('  (skipped — tryStartDash not exposed)'); }

// ============================================================
section('submitTopScore / loadTopScores — leaderboard sort / cap / rank / integrity');
if (typeof G.submitTopScore === 'function' && typeof G.loadTopScores === 'function') {
  const key = 'galagaTopScoresNormal';
  const saved = sandbox.localStorage.getItem(key);
  const savedHigh = sandbox.localStorage.getItem('galagaHigh');
  sandbox.localStorage.removeItem(key);
  sandbox.localStorage.removeItem('galagaHigh');
  const g = fresh(); g.dailyMode = false; g.challengeMode = false; // normal-mode leaderboard

  eq(G.submitTopScore(0, 1, 50), -1, 'score 0 → not submitted (-1)');
  eq(G.submitTopScore(-5, 1, 50), -1, 'negative score → not submitted (-1)');

  G.submitTopScore(1000, 3, 80);
  eq(G.submitTopScore(5000, 5, 90), 0, 'highest → rank #1 (index 0)');
  eq(G.submitTopScore(2000, 4, 70), 1, 'mid → rank #2 (index 1)');
  const list = G.loadTopScores('normal');
  ok(list.length === 3, '3 scores recorded');
  ok(list[0].score === 5000 && list[1].score === 2000 && list[2].score === 1000, 'sorted descending');
  ok(list[0].stage === 5 && list[0].accuracy === 90, 'entry keeps its stage + accuracy');

  G.submitTopScore(100, 1, 10); G.submitTopScore(200, 1, 10); G.submitTopScore(300, 1, 10);
  const capped = G.loadTopScores('normal');
  ok(capped.length === 5, 'capped at 5 entries (' + capped.length + ')');
  ok(capped[0].score === 5000, 'top entry preserved through cap');
  ok(!capped.some(e => e.score === 100), 'lowest over-cap score dropped');

  eq(parseInt(sandbox.localStorage.getItem('galagaHigh') || '0', 10), 5000, 'galagaHigh synced to max score');

  // Corrupt JSON: challenge mode (no legacy fallback) → clean []; normal mode
  // gracefully recovers via the galagaHigh legacy migration. Neither throws.
  const ckey = 'galagaTopScoresChallenge';
  const savedC = sandbox.localStorage.getItem(ckey);
  sandbox.localStorage.setItem(ckey, '{not valid json');
  const cl = G.loadTopScores('challenge');
  ok(Array.isArray(cl) && cl.length === 0, 'corrupt JSON (no legacy) → [] (no throw)');
  if (savedC === null) sandbox.localStorage.removeItem(ckey); else sandbox.localStorage.setItem(ckey, savedC);

  sandbox.localStorage.setItem(key, '{not valid json');
  ok(Array.isArray(G.loadTopScores('normal')), 'corrupt normal JSON → array, recovers galagaHigh (no throw)');

  if (saved === null) sandbox.localStorage.removeItem(key); else sandbox.localStorage.setItem(key, saved);
  if (savedHigh === null) sandbox.localStorage.removeItem('galagaHigh'); else sandbox.localStorage.setItem('galagaHigh', savedHigh);
} else { console.log('  (skipped — submitTopScore/loadTopScores not exposed)'); }

// ============================================================
section('commitGameToCumStats — cumulative stats: demo guard + accumulation + last-run');
if (typeof G.commitGameToCumStats === 'function' && typeof G.loadCumStats === 'function') {
  const keys = ['galagaCumStats', 'galagaCumStatsChallenge', 'galagaLastRun'];
  const savedKV = keys.map(k => [k, sandbox.localStorage.getItem(k)]);
  keys.forEach(k => sandbox.localStorage.removeItem(k));

  // Demo runs must NOT pollute cumulative stats.
  let g = fresh(); g.isDemo = true; g.challengeMode = false;
  g.stats = { kills: 99, shotsFired: 0, shotsHit: 0, maxStage: 9 }; g.score = 99999;
  G.commitGameToCumStats();
  eq((G.loadCumStats(false).sessions || 0), 0, 'demo run → not committed (0 sessions)');
  eq(sandbox.localStorage.getItem('galagaLastRun'), null, 'demo run → no last-run snapshot');

  // Real run → accumulates + saves last-run snapshot.
  g = fresh(); g.isDemo = false; g.challengeMode = false;
  g.stats = { kills: 10, shotsFired: 20, shotsHit: 15, maxStage: 7 };
  g.score = 5000; g.runFrames = 600; g.comboBest = 12;
  G.commitGameToCumStats();
  const cs = G.loadCumStats(false);
  eq(cs.sessions, 1, 'real run → sessions = 1');
  eq(cs.kills, 10, 'kills accumulated');
  eq(cs.scoreTotal, 5000, 'scoreTotal accumulated');
  eq(cs.bestStage, 7, 'bestStage recorded');
  const lr = JSON.parse(sandbox.localStorage.getItem('galagaLastRun') || '{}');
  eq(lr.stage, 7, 'last-run snapshot: stage'); eq(lr.score, 5000, 'last-run snapshot: score');

  // Second run accumulates on top (sessions 2, kills 10+3, bestStage stays max).
  g = fresh(); g.isDemo = false; g.challengeMode = false;
  g.stats = { kills: 3, shotsFired: 4, shotsHit: 2, maxStage: 4 }; g.score = 1000;
  G.commitGameToCumStats();
  const cs2 = G.loadCumStats(false);
  eq(cs2.sessions, 2, 'second run → sessions = 2');
  eq(cs2.kills, 13, 'kills accumulate across runs');
  eq(cs2.bestStage, 7, 'bestStage keeps the higher prior run');

  savedKV.forEach(([k, v]) => { if (v === null) sandbox.localStorage.removeItem(k); else sandbox.localStorage.setItem(k, v); });
} else { console.log('  (skipped — commitGameToCumStats/loadCumStats not exposed)'); }

// ============================================================
section('recordStagePB — strictly-faster-only PB recording (feeds grade + clock)');
if (typeof G.recordStagePB === 'function' && G.__getStagePBs && G.__getStagePBs()) {
  const pbs = G.__getStagePBs();
  const TS = 999; // isolated throwaway stage so we don't touch real PBs
  const savedPB = pbs[String(TS)];
  delete pbs[String(TS)];

  eq(G.recordStagePB(0, 100).isNew, false, 'no stage → not recorded');
  eq(G.recordStagePB(TS, 0).isNew, false, 'frames <= 0 → not recorded');
  eq(G.recordStagePB(TS, -5).isNew, false, 'negative frames → not recorded');

  const r1 = G.recordStagePB(TS, 600);
  ok(r1.isNew === true && r1.prev == null, 'first run → new PB, no prev');
  eq(pbs[String(TS)], 600, 'PB stored (600)');

  const r2 = G.recordStagePB(TS, 500);
  ok(r2.isNew === true && r2.prev === 600, 'faster → new PB, returns prev');
  eq(pbs[String(TS)], 500, 'PB updated to the faster time');

  const r3 = G.recordStagePB(TS, 700);
  ok(r3.isNew === false && r3.prev === 500, 'slower → not a PB');
  eq(pbs[String(TS)], 500, 'slower run does NOT overwrite the PB');

  eq(G.recordStagePB(TS, 500).isNew, false, 'equal time → not new (strictly faster only)');

  if (savedPB === undefined) delete pbs[String(TS)]; else pbs[String(TS)] = savedPB;
} else { console.log('  (skipped — recordStagePB / stagePBs not exposed)'); }

// ============================================================
section('unlockDex — first-contact bestiary unlock (valid-type only, idempotent)');
if (typeof G.unlockDex === 'function' && G.__getDexUnlocked && G.__getDexUnlocked()) {
  const dex = G.__getDexUnlocked();
  const savedDex = sandbox.localStorage.getItem('galagaDexUnlocked');
  const TYPE = 'bee'; // a known ENEMY_INFO type
  const had = dex.has(TYPE);
  dex.delete(TYPE);
  const g = fresh(); g.state = 0; // TITLE → skip the in-game floatText path

  G.unlockDex('notARealEnemyType');
  ok(!dex.has('notARealEnemyType'), 'invalid type → not unlocked');

  G.unlockDex(TYPE);
  ok(dex.has(TYPE), 'valid type → unlocked');
  ok(JSON.parse(sandbox.localStorage.getItem('galagaDexUnlocked') || '[]').includes(TYPE),
     'unlock persisted to localStorage');

  const sizeBefore = dex.size;
  G.unlockDex(TYPE);
  eq(dex.size, sizeBefore, 'already unlocked → idempotent (no duplicate)');

  if (!had) dex.delete(TYPE);
  if (savedDex === null) sandbox.localStorage.removeItem('galagaDexUnlocked'); else sandbox.localStorage.setItem('galagaDexUnlocked', savedDex);
} else { console.log('  (skipped — unlockDex / dexUnlocked not exposed)'); }

// ============================================================
section('comboKillDetune — COMBO HARMONICS escalation ramp (cents)');
if (typeof G.comboKillDetune === 'function') {
  eq(G.comboKillDetune(0),   0,   'combo 0 → base pitch (no detune)');
  eq(G.comboKillDetune(1),   10,  'combo 1 → +10c');
  eq(G.comboKillDetune(10),  100, 'combo 10 → +100c');
  eq(G.comboKillDetune(30),  300, 'combo 30 (MAX tier) → +300c cap');
  eq(G.comboKillDetune(99),  300, 'caps at +300c past combo 30');
  eq(G.comboKillDetune(-5),  0,   'negative/garbage → 0 (clamped)');
  eq(G.comboKillDetune(),    0,   'undefined → 0 (no NaN)');
  ok(G.comboKillDetune(20) > G.comboKillDetune(5), 'monotonic: higher combo → higher pitch');
} else { console.log('  (skipped — comboKillDetune not exposed)'); }


// ============================================================
section('stageModeFor — boss / challenge / normal dispatch');
if (typeof G.stageModeFor === 'function') {
  eq(G.stageModeFor(10), 'boss', 'stage 10 → boss');
  eq(G.stageModeFor(30), 'boss', 'stage 30 → boss');
  eq(G.stageModeFor(100), 'boss', 'stage 100 → boss');
  eq(G.stageModeFor(4), 'challenge', 'stage 4 → challenge');
  eq(G.stageModeFor(8), 'challenge', 'stage 8 → challenge');
  eq(G.stageModeFor(12), 'challenge', 'stage 12 → challenge');
  // Boss takes priority where the cadences collide (20/40/60/80 are %10 AND %4)
  eq(G.stageModeFor(20), 'boss', 'stage 20 (÷10 and ÷4) → boss wins over challenge');
  eq(G.stageModeFor(40), 'boss', 'stage 40 → boss (priority)');
  [1, 2, 3, 5, 6, 7, 9, 11].forEach(s =>
    eq(G.stageModeFor(s), 'normal', 'stage ' + s + ' → normal'));
} else { console.log('  (skipped — stageModeFor not exposed)'); }

// ============================================================
section('isCombatState — active-combat state gate');
{
  const cg = G.__getGame && G.__getGame();
  if (cg && typeof G.isCombatState === 'function') {
    const save = cg.state;
    cg.state = 2; ok(G.isCombatState(), 'PLAYING → true');
    cg.state = 3; ok(G.isCombatState(), 'CHALLENGING → true');
    cg.state = 8; ok(G.isCombatState(), 'BOSS_STAGE → true');
    // TITLE/INTRO/GAME_OVER/PAUSED/CAPTURED/RESPAWN/BONUS are not combat
    [0, 1, 4, 5, 6, 7, 9].forEach(s => { cg.state = s; ok(!G.isCombatState(), 'state ' + s + ' → not combat'); });
    cg.state = save;
  } else { console.log('  (skipped — isCombatState / game not exposed)'); }
}

// ============================================================
section('createEntryPath — entry bezier endpoints + curve direction');
if (typeof G.createEntryPath === 'function') {
  const path = G.createEntryPath(10, 20, 100, 200, 1);
  eq(path.p0.x, 10, 'p0 = start x'); eq(path.p0.y, 20, 'p0 = start y');
  eq(path.p3.x, 100, 'p3 = end x'); eq(path.p3.y, 200, 'p3 = end y');
  eq(path.p1.y, 20, 'p1.y aligns to the start row');
  eq(path.p2.y, 200, 'p2.y aligns to the end row');
  eq(path.p1.x, path.p2.x, 'both control points share the detour x (vertical bow)');
  const left = G.createEntryPath(10, 20, 100, 200, -1);
  ok(left.p1.x < path.p1.x, 'curveDir -1 bows to the opposite side');
  // The path must be consumable by bezierPoint (the movement evaluator): the curve
  // starts exactly at the entry point and lands exactly on the formation slot.
  if (typeof G.bezierPoint === 'function') {
    const a = G.bezierPoint(path.p0, path.p1, path.p2, path.p3, 0);
    const b = G.bezierPoint(path.p0, path.p1, path.p2, path.p3, 1);
    ok(Math.abs(a.x - 10) < 1e-9 && Math.abs(a.y - 20) < 1e-9, 'bezier t=0 → start point');
    ok(Math.abs(b.x - 100) < 1e-9 && Math.abs(b.y - 200) < 1e-9, 'bezier t=1 → end point');
  }
} else { console.log('  (skipped — createEntryPath not exposed)'); }

// ============================================================
section('computeCompositeCompletion — aggregate progression %');
{
  const dex = G.__getDexUnlocked && G.__getDexUnlocked();
  const ach = G.__getUnlockedAch && G.__getUnlockedAch();
  if (typeof G.computeCompositeCompletion === 'function' && dex && ach) {
    const dexSave = [...dex], achSave = [...ach];
    const keys = ['galagaBiomesSeen', 'galagaShipsUsed', 'galagaDifficultiesUsed', 'galagaPerkPicks'];
    const lsSave = keys.map(k => sandbox.localStorage.getItem(k));
    // Fresh save → every category 0 → 0%
    dex.clear(); ach.clear();
    keys.forEach(k => sandbox.localStorage.removeItem(k));
    eq(G.computeCompositeCompletion(), 0, 'fresh save → 0%');
    // Max the 4 cap-based categories (biomes 8 / dex 8 / ships 4 / difficulties 3),
    // leave perks + achievements empty → (1+1+1+1+0+0)/6 → 67% (avoids needing the
    // perk/achievement totals, which vary).
    for (let i = 0; i < 8; i++) dex.add('d' + i);
    sandbox.localStorage.setItem('galagaBiomesSeen', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    sandbox.localStorage.setItem('galagaShipsUsed', JSON.stringify(['s1', 's2', 's3', 's4']));
    sandbox.localStorage.setItem('galagaDifficultiesUsed', JSON.stringify(['easy', 'normal', 'hard']));
    eq(G.computeCompositeCompletion(), 67, 'biomes/dex/ships/diff maxed (perks+ach empty) → 67%');
    // restore
    dex.clear(); dexSave.forEach(x => dex.add(x));
    ach.clear(); achSave.forEach(x => ach.add(x));
    keys.forEach((k, i) => { if (lsSave[i] === null) sandbox.localStorage.removeItem(k); else sandbox.localStorage.setItem(k, lsSave[i]); });
  } else { console.log('  (skipped — computeCompositeCompletion / sets not exposed)'); }
}

// ============================================================
section('corrupt localStorage is non-fatal (documented invariant)');
{
  const keys = ['galagaBiomesSeen', 'galagaShipsUsed', 'galagaDifficultiesUsed', 'galagaPerkPicks', 'galagaDailyDays'];
  const saved = keys.map(k => sandbox.localStorage.getItem(k));
  keys.forEach(k => sandbox.localStorage.setItem(k, '{not valid json['));
  let threw = null;
  try {
    if (G.computeCompositeCompletion) G.computeCompositeCompletion();
    if (G.computeDailyStreak) G.computeDailyStreak();
    if (G.computePilotTitle) G.computePilotTitle();
  } catch (e) { threw = e; }
  ok(threw === null, 'garbage JSON in storage does not throw' + (threw ? ' — ' + threw.message : ''));
  if (G.computeCompositeCompletion) ok(typeof G.computeCompositeCompletion() === 'number', 'composite completion still returns a number');
  if (G.computeDailyStreak) eq(G.computeDailyStreak(), 0, 'daily streak falls back to 0 on corrupt data');
  keys.forEach((k, i) => { if (saved[i] === null) sandbox.localStorage.removeItem(k); else sandbox.localStorage.setItem(k, saved[i]); });
}

// ============================================================
section('stats overlay page model — Tab navigation invariants');
if (typeof G.statsAchGridPages === 'function' && typeof G.statsTotalPages === 'function') {
  const gp = G.statsAchGridPages();
  const tp = G.statsTotalPages();
  ok(gp >= 1, 'at least one achievement grid page');
  // summary(1) + grids(gp) + bestiary(1) + profile(1) + pilot log(1)
  eq(tp, gp + 4, 'total pages = grid pages + 4 (summary/bestiary/profile/pilot log)');
  // The five draw branches key off these indices; assert they stay distinct and
  // ordered so a future ACHIEVEMENTS change can't collapse two pages onto one
  // index or push a page out of the Tab cycle.
  const summaryPage  = 0;
  const firstGridPg  = 1;
  const lastGridPg   = gp;
  const bestiaryPage = gp + 1;
  const profilePage  = gp + 2;
  const pilotLogPage = gp + 3;
  ok(firstGridPg <= lastGridPg, 'grid page range is non-empty');
  ok(summaryPage < firstGridPg, 'summary precedes grids');
  ok(lastGridPg < bestiaryPage, 'grids precede bestiary');
  ok(bestiaryPage < profilePage, 'bestiary precedes profile');
  ok(profilePage < pilotLogPage, 'profile precedes pilot log');
  eq(pilotLogPage, tp - 1, 'pilot log is the last page (Tab wraps after it)');
  // every page index in [0, tp) maps to exactly one of the five kinds
  let covered = 0;
  for (let p = 0; p < tp; p++) {
    const kinds = (p === summaryPage ? 1 : 0)
                + (p >= firstGridPg && p <= lastGridPg ? 1 : 0)
                + (p === bestiaryPage ? 1 : 0)
                + (p === profilePage ? 1 : 0)
                + (p === pilotLogPage ? 1 : 0);
    if (kinds === 1) covered++;
  }
  eq(covered, tp, 'every Tab page maps to exactly one kind (no gaps/overlaps)');
  // Every page indicator must render the CURRENT page, never a hardcoded "last
  // page". The profile page used to print `total/total` because it WAS last;
  // adding PILOT LOG after it left the label claiming to be the final page,
  // which tells the player there is nothing further and hides the page that
  // follows. A stale self-label is invisible in play, so pin it at the source.
  const indicators = [...scriptSrc.matchAll(/drawRetroText\(([^;]{0,80}?)\+\s*'\s*TAB'/g)].map(m => m[1]);
  ok(indicators.length >= 4, 'found the Tab page indicators in source (' + indicators.length + ')');
  const stale = indicators.filter(x => /(\w+)\s*\+\s*'\/'\s*\+\s*\1\b/.test(x));
  eq(stale.length, 0, 'no page indicator hardcodes itself as the last page (total/total)');
  // "Derives from the current page" means either `<pageVar> + 1` (stats pages
  // use game.statsAchPage, the help overlay uses its own _hp) or the literal
  // '1/' on the page-0 footer, which is page 0 by construction.
  const usesCurrent = indicators.filter(x => /\+\s*1\s*\)/.test(x) || /'\s*1\//.test(x));
  eq(usesCurrent.length, indicators.length,
     'every Tab indicator derives its number from the current page');

  // The summary page carries a Tab-page DIRECTORY whose stated job is to make
  // the dedicated pages discoverable. PILOT LOG was added to the page model
  // without being listed there, so the one surface that advertises the pages
  // silently omitted it. Rows = total pages - grid pages (the grids collapse
  // into a single "ACHIEVEMENTS P2-N" row, and the summary lists everything
  // except itself... which works out to exactly that count).
  const dirBlock = scriptSrc.match(/const _dir = \[([\s\S]*?)\n\s*\];/);
  ok(!!dirBlock, 'found the Tab-page directory in source');
  if (dirBlock) {
    const rows = (dirBlock[1].match(/\n\s*\[/g) || []).length;
    eq(rows, tp - gp, 'the directory lists every dedicated Tab page (rows = total - grids)');
    for (const name of ['BESTIARY', 'PILOT PROFILE', 'PILOT LOG', 'ACHIEVEMENTS']) {
      ok(dirBlock[1].indexOf(name) !== -1, 'directory advertises ' + name);
    }
  }
} else { console.log('  (skipped — stats page helpers not exposed)'); }

// ============================================================
section('SHIPS ↔ SHIP_ORDER bijection + stat sanity (no unselectable ships)');
if (G.__getShips() && G.__getShipOrder()) {
  const SHIPS = G.__getShips();
  const ORDER = G.__getShipOrder();
  const shipKeys = Object.keys(SHIPS);
  // every defined ship is selectable (in SHIP_ORDER) and vice-versa
  let everyShipListed = shipKeys.every(k => ORDER.includes(k));
  let everyListedDefined = ORDER.every(k => !!SHIPS[k]);
  ok(everyShipListed, 'every SHIPS entry appears in SHIP_ORDER (selectable)');
  ok(everyListedDefined, 'every SHIP_ORDER entry is a defined ship');
  eq(shipKeys.length, ORDER.length, 'SHIPS count == SHIP_ORDER count (bijection)');
  // each ship has sane stats
  let statsOk = true, bad = '';
  for (const k of shipKeys) {
    const s = SHIPS[k];
    if (!s.name || !s.color || !(s.speedMul > 0) || !(s.bulletCap >= 1) || !(s.dmgBonus >= 0)) {
      statsOk = false; bad = k;
    }
  }
  ok(statsOk, 'every ship has name/color/speedMul>0/bulletCap>=1/dmgBonus>=0' + (bad ? ' (bad: ' + bad + ')' : ''));
  // every ship carries a TITLE identity tag (data-driven, no inline drift)
  let tagsOk = true, badTag = '';
  for (const k of shipKeys) { if (!SHIPS[k].tag || typeof SHIPS[k].tag !== 'string') { tagsOk = false; badTag = k; } }
  ok(tagsOk, 'every ship has a string `tag`' + (badTag ? ' (bad: ' + badTag + ')' : ''));
} else { console.log('  (skipped — SHIPS/SHIP_ORDER not exposed)'); }

// ============================================================
section('PERKS: every activePerk reference resolves to a defined perk');
{
  // Source-level guard: a `game.activePerk === 'X'` check whose 'X' is not a key
  // in PERKS is dead logic (perk can never be granted) — and a granted perk with
  // no effect check is a no-op. Catch the former (the more dangerous direction).
  const perksMatch = scriptSrc.match(/const PERKS = \{([\s\S]*?)\n\};/);
  ok(!!perksMatch, 'PERKS object found in source');
  if (perksMatch) {
    const perkKeys = new Set(
      (perksMatch[1].match(/^\s*([a-zA-Z]+)\s*:/gm) || []).map(s => s.replace(/[:\s]/g, ''))
    );
    ok(perkKeys.size >= 10, 'PERKS defines >= 10 perks (got ' + perkKeys.size + ')');
    const refs = new Set((scriptSrc.match(/activePerk === '([a-zA-Z]+)'/g) || [])
      .map(s => s.match(/'([a-zA-Z]+)'/)[1]));
    let allDefined = true, undef = [];
    for (const r of refs) { if (!perkKeys.has(r)) { allDefined = false; undef.push(r); } }
    ok(allDefined, 'every referenced perk is defined in PERKS' + (undef.length ? ' (undefined: ' + undef.join(', ') + ')' : ''));
    // every defined perk should also be referenced somewhere (no dead perk)
    let allUsed = true, unused = [];
    for (const k of perkKeys) { if (!refs.has(k)) { allUsed = false; unused.push(k); } }
    ok(allUsed, 'every defined perk is referenced in logic' + (unused.length ? ' (unused: ' + unused.join(', ') + ')' : ''));
  }
}

// ============================================================
section('addScore — extra life on 30000 crossing, challenge-mode disabled, cap');
if (typeof G.addScore === 'function') {
  // crossing a 30000 boundary awards exactly one life
  let g = fresh();
  g.challengeMode = false; g.dailyMode = false;
  g.score = 29000; g.lives = 3;
  G.addScore(2000);                 // → 31000, crosses 30000
  eq(g.score, 31000, 'score adds normally');
  eq(g.lives, 4, 'crossing 30000 awards +1 life');
  // a gain that does NOT cross a boundary awards nothing
  g.score = 31000; g.lives = 4;
  G.addScore(2000);                 // → 33000, no crossing
  eq(g.lives, 4, 'no boundary crossed = no extra life');
  // challenge mode: no extra lives (hardcore)
  g = fresh();
  g.challengeMode = true; g.dailyMode = false;
  g.score = 29000; g.lives = 1;
  G.addScore(5000);                 // → 34000, would cross, but challenge
  eq(g.lives, 1, 'challenge mode never grants extra lives');
  // score never exceeds the cap
  g = fresh();
  g.challengeMode = false; g.dailyMode = false;
  g.score = 999999000; g.lives = 3;
  G.addScore(100000000);
  ok(g.score <= 999999999, 'score clamped to SCORE_CAP');
  // daily mode applies the 1.25x multiplier
  g = fresh();
  g.challengeMode = false; g.dailyMode = true;
  g.score = 0; g.lives = 3;
  G.addScore(1000);
  eq(g.score, 1250, 'daily mode applies 1.25x');
} else { console.log('  (skipped — addScore not exposed)'); }

// ============================================================
section('updateChallengeEnemies tolerates out-of-bounds wave index (stage-end)');
if (typeof G.updateChallengeEnemies === 'function') {
  const g = fresh();
  g.state = (G.__getGame && 3); // STATE.CHALLENGING == 3
  g.challengeWaves = [
    [{ alive: false, type: 'bee', x: 10, y: 10, vx: 0, vy: 0, pattern: 'top_down', sinPhase: 0, sinAmp: 0, baseX: 10 }],
    [{ alive: false, type: 'bee', x: 20, y: 20, vx: 0, vy: 0, pattern: 'top_down', sinPhase: 0, sinAmp: 0, baseX: 20 }],
  ];
  // After the final wave clears, challengeWaveIdx advances PAST the last index.
  g.challengeWaveIdx = 2; // == length → out of bounds
  let threw = false;
  try { G.updateChallengeEnemies(); } catch (e) { threw = true; }
  ok(!threw, 'no throw when challengeWaveIdx == waves.length (returns early)');
  g.challengeWaveIdx = 99; // far out of bounds
  threw = false;
  try { G.updateChallengeEnemies(); } catch (e) { threw = true; }
  ok(!threw, 'no throw when challengeWaveIdx far out of bounds');
} else { console.log('  (skipped — updateChallengeEnemies not exposed)'); }

// ============================================================
section('difficultyDescriptor — a distinct non-empty blurb per mode');
if (typeof G.difficultyDescriptor === 'function') {
  const e = G.difficultyDescriptor('easy');
  const n = G.difficultyDescriptor('normal');
  const h = G.difficultyDescriptor('hard');
  ok(typeof e === 'string' && e.length > 0, 'easy descriptor non-empty');
  ok(typeof n === 'string' && n.length > 0, 'normal descriptor non-empty');
  ok(typeof h === 'string' && h.length > 0, 'hard descriptor non-empty');
  ok(e !== n && n !== h && e !== h, 'all three descriptors are distinct');
  // unknown mode falls back to the standard blurb
  eq(G.difficultyDescriptor('???'), n, 'unknown mode = normal/standard blurb');
  // descriptors reflect the loot direction of powerUpDropRate (easy more, hard less)
  ok(/MORE LOOT/.test(e), 'easy mentions more loot (matches +5% drop)');
  ok(/LESS LOOT/.test(h), 'hard mentions less loot (matches -5% drop)');
} else { console.log('  (skipped — difficultyDescriptor not exposed)'); }

// ============================================================
section('SMOKE: update()+draw() run without throwing across states');
if (typeof G.update === 'function' && typeof G.draw === 'function') {
  // STATE enum values (from the source) so we drive each branch by number.
  const ST = { TITLE: 0, STAGE_INTRO: 1, PLAYING: 2, CHALLENGING: 3, GAME_OVER: 4,
               PAUSED: 5, CAPTURED: 6, RESPAWN: 7, BOSS_STAGE: 8, BONUS_GAME: 9 };
  function drive(stateName, ticks, setup) {
    const g = fresh();
    if (setup) setup(g);
    g.state = ST[stateName];
    let threw = null;
    try {
      for (let i = 0; i < ticks; i++) { G.update(); G.draw(); }
    } catch (e) { threw = e; }
    ok(!threw, stateName + ' ticks without throwing' + (threw ? ' — ' + (threw.message || threw) : ''));
  }
  drive('TITLE', 5);
  drive('STAGE_INTRO', 5, g => { g.stage = 3; g.stageTimer = 120; });
  drive('PLAYING', 20, g => { g.stage = 3; });
  drive('GAME_OVER', 5, g => { g.gameOverTimer = 120; g.stats = { kills: 10, shotsFired: 20, shotsHit: 15, maxStage: 3 }; });
  drive('PAUSED', 3, g => { g.pausedState = ST.PLAYING; });
  drive('RESPAWN', 5, g => { g.respawnTimer = 30; g.stage = 3; });
  drive('CHALLENGING', 10, g => { g.stage = 4; });
  drive('BOSS_STAGE', 10, g => { g.stage = 10; });
  drive('BONUS_GAME', 10, g => {
    g.bonusGame = { elapsed: 0, reels: [0,0,0], stopAt: [60,90,120],
      finalIdx: [0,1,2], locked: [false,false,false], resultShown: false, bonus: 0, matchText: '' };
  });
} else { console.log('  (skipped — update/draw not exposed)'); }

// ============================================================
section('SMOKE: realistic combat loop (startStage + fire + 300 ticks)');
if (typeof G.update === 'function' && typeof G.startStage === 'function' && typeof G.__getKeys === 'function') {
  const g = fresh();
  g.stage = 3;
  let threw = null;
  try {
    G.startStage();              // populate a real formation, set the play state
    const keys = G.__getKeys();  // hold fire so player bullets actually spawn
    if (keys) { keys[' '] = true; keys['ArrowLeft'] = false; keys['ArrowRight'] = false; }
    for (let i = 0; i < 300; i++) {
      // wiggle horizontally so dodging/near-miss/parry paths can engage
      if (keys) { keys['ArrowLeft'] = (i % 40) < 20; keys['ArrowRight'] = (i % 40) >= 20; }
      G.update();
      G.draw();
    }
  } catch (e) { threw = e; }
  ok(!threw, 'combat loop runs 300 ticks without throwing' + (threw ? ' — ' + (threw.message || threw) + '\n' + (threw.stack || '') : ''));
  // sanity: the simulation actually advanced (frames ticked, bullets were fired)
  const g2 = G.__getGame();
  ok((g2.stageFrames || 0) > 0 || (g2.runFrames || 0) > 0, 'stage/run frames advanced during combat');
  // NaN GUARD — NaN coords/score don't throw but silently break collision + render.
  // Verify the core scalars and every live entity coordinate stayed finite.
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  ok(fin(g2.playerX) && fin(g2.playerY), 'player position stayed finite (no NaN)');
  ok(fin(g2.score) && fin(g2.combo || 0), 'score + combo stayed finite');
  function entitiesFinite(arr) {
    if (!Array.isArray(arr)) return true;
    return arr.every(e => !e || ((e.x === undefined || fin(e.x)) && (e.y === undefined || fin(e.y))));
  }
  ok(entitiesFinite(g2.enemies), 'no enemy has NaN coords');
  ok(entitiesFinite(g2.bullets), 'no player bullet has NaN coords');
  ok(entitiesFinite(g2.enemyBullets), 'no enemy bullet has NaN coords');
  ok(entitiesFinite(g2.powerUps), 'no power-up has NaN coords');
} else { console.log('  (skipped — startStage/__getKeys not exposed)'); }

// ============================================================
section('SMOKE: multi-stage playthrough (normal → challenge → boss) stays sound');
if (typeof G.update === 'function' && typeof G.startStage === 'function' && typeof G.__getKeys === 'function') {
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const g = fresh();
  g.cheatInvincible = true;        // avoid death stalls so transitions are reached
  const keys = G.__getKeys();
  if (keys) keys[' '] = true;      // hold fire throughout
  let threw = null, nanSeen = false;
  // stage 3 = normal, 4 = challenge (%4), 10 = boss (%10), 12 = normal again
  const stages = [3, 4, 10, 12];
  try {
    for (const st of stages) {
      g.stage = st;
      G.startStage();
      for (let i = 0; i < 150; i++) {
        if (keys) { keys['ArrowLeft'] = (i % 30) < 15; keys['ArrowRight'] = (i % 30) >= 15; }
        G.update(); G.draw();
      }
      const gg = G.__getGame();
      if (!(fin(gg.playerX) && fin(gg.playerY) && fin(gg.score))) nanSeen = true;
    }
  } catch (e) { threw = e; }
  ok(!threw, 'normal+challenge+boss stages tick without throwing' + (threw ? ' — ' + (threw.message || threw) : ''));
  ok(!nanSeen, 'no NaN in core state across stage transitions');
} else { console.log('  (skipped — startStage/__getKeys not exposed)'); }

// ============================================================
section('DAILY_MISSIONS: structural + every mission is satisfiable & never always-done');
if (G.__getDailyMissions()) {
  const M = G.__getDailyMissions();
  ok(Array.isArray(M) && M.length >= 10, 'has >= 10 daily missions (got ' + (M.length || 0) + ')');
  // structural: id/label/check/progress present, ids unique
  let structOk = true, badStruct = '';
  const ids = new Set();
  for (const m of M) {
    if (!m.id || !m.label || typeof m.check !== 'function' || typeof m.progress !== 'function') { structOk = false; badStruct = m.id || '(no id)'; }
    if (ids.has(m.id)) { structOk = false; badStruct = 'dup ' + m.id; }
    ids.add(m.id);
  }
  ok(structOk, 'every mission has id/label/check/progress + unique id' + (badStruct ? ' (bad: ' + badStruct + ')' : ''));
  // a maxed-out game should satisfy EVERY mission's check (no impossible mission)
  const maxed = {
    stats: { maxStage: 99, kills: 9999, shotsFired: 100, shotsHit: 100 },
    score: 9999999, parryCount: 999, stageCloseCount: 999, _dailyGrazeAcc: 999,
    perfectStreak: 99, bossesKilledThisRun: 99, maxPowerRevealed: true,
    dualFighter: true, eliteKills: 999, dashCount: 999,
  };
  let allSatisfiable = true, impossible = '';
  for (const m of M) { try { if (!m.check(maxed)) { allSatisfiable = false; impossible = m.id; } } catch (e) { allSatisfiable = false; impossible = m.id + '(threw)'; } }
  ok(allSatisfiable, 'every mission check passes on a maxed game' + (impossible ? ' (impossible: ' + impossible + ')' : ''));
  // a zero game should FAIL every progress-bearing mission's check (not always-done)
  const zero = { stats: { maxStage: 0, kills: 0, shotsFired: 0, shotsHit: 0 }, score: 0,
    parryCount: 0, stageCloseCount: 0, _dailyGrazeAcc: 0, perfectStreak: 0,
    bossesKilledThisRun: 0, maxPowerRevealed: false, dualFighter: false, eliteKills: 0, dashCount: 0 };
  let noneAlwaysDone = true, alwaysDone = '';
  for (const m of M) { try { if (m.check(zero)) { noneAlwaysDone = false; alwaysDone = m.id; } } catch (e) {} }
  ok(noneAlwaysDone, 'no mission is already-complete on a zero game' + (alwaysDone ? ' (always-done: ' + alwaysDone + ')' : ''));
  // progress() must return a string for both states without throwing
  let progOk = true, badProg = '';
  for (const m of M) {
    try { if (typeof m.progress(zero) !== 'string' || typeof m.progress(maxed) !== 'string') { progOk = false; badProg = m.id; } }
    catch (e) { progOk = false; badProg = m.id + '(threw)'; }
  }
  ok(progOk, 'every mission progress() returns a string (both states)' + (badProg ? ' (bad: ' + badProg + ')' : ''));
} else { console.log('  (skipped — DAILY_MISSIONS not exposed)'); }

// ============================================================
section('pickEpitaph returns a non-empty line for every stage tier (no missing bucket)');
if (typeof G.pickEpitaph === 'function') {
  // One stage in each tier boundary + deep stages. A missing EPITAPHS bucket would
  // make `arr` undefined and throw on arr[...] — so "returns a string" is the guard.
  const stages = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 79, 80, 150, 999];
  let allOk = true, bad = '';
  for (const s of stages) {
    try {
      const ep = G.pickEpitaph(s, 50);
      if (typeof ep !== 'string' || ep.length === 0) { allOk = false; bad = String(s); }
    } catch (e) { allOk = false; bad = s + '(threw: ' + (e.message || e) + ')'; }
  }
  ok(allOk, 'every stage tier yields a non-empty epitaph' + (bad ? ' (bad at stage ' + bad + ')' : ''));
} else { console.log('  (skipped — pickEpitaph not exposed)'); }

// ============================================================
section('tauntFor: every archetype has its own voice; unknown still falls back safely');
if (typeof G.tauntFor === 'function') {
  // All situations the code triggers, across the 6 real archetypes plus an unknown
  // one. Must never throw; returns a string (a line) or null (no line) — both valid.
  const archs = ['standard', 'horned', 'tendril', 'crystal', 'phantom', 'rune', 'unknownArch'];
  const sits  = ['intro', 'phase2', 'lowHp', 'dash', 'death', 'finalStand', 'bogusSit'];
  let allOk = true, bad = '';
  for (const a of archs) {
    for (const s of sits) {
      try {
        const t = G.tauntFor(a, s);
        if (!(t === null || typeof t === 'string')) { allOk = false; bad = a + '/' + s; }
      } catch (e) { allOk = false; bad = a + '/' + s + '(threw)'; }
    }
  }
  ok(allOk, 'tauntFor returns string|null and never throws for any archetype×situation' + (bad ? ' (bad: ' + bad + ')' : ''));
  // Every real archetype now has its OWN complete, distinct voice — phantom/rune no
  // longer fall back to standard (gap closed). Lock it: all 6 situations present,
  // non-empty, and at least one line differs from the standard set's line.
  const realArchs = ['standard', 'horned', 'tendril', 'crystal', 'phantom', 'rune'];
  const realSits  = ['intro', 'phase2', 'lowHp', 'dash', 'death', 'finalStand'];
  for (const a of realArchs) {
    let complete = true, differs = (a === 'standard');
    for (const s of realSits) {
      const line = G.tauntFor(a, s);
      if (typeof line !== 'string' || line.length === 0) complete = false;
      if (a !== 'standard' && line !== G.tauntFor('standard', s)) differs = true;
    }
    ok(complete, a + ' has a non-empty line for all 6 situations');
    ok(differs, a + ' has its own voice (differs from standard)');
  }
  // The fallback path is still intact for a genuinely unknown archetype.
  ok(G.tauntFor('unknownArch', 'intro') === G.tauntFor('standard', 'intro'), 'unknown archetype still falls back to standard');
} else { console.log('  (skipped — tauntFor not exposed)'); }

// ============================================================
section('killPlayer: dual fighter absorbs the hit (wingman lost, no life cost)');
if (typeof G.killPlayer === 'function') {
  const ST_RESPAWN = 7;
  const g = fresh();
  g.playerAlive = true; g.cheatInvincible = false; g.shieldCharges = 0;
  g.dualFighter = true; g.lives = 3; g.state = 2 /* PLAYING */;
  G.killPlayer(100, 100, 'bullet', 'bee');
  eq(g.dualFighter, false, 'dual fighter downgraded to single');
  eq(g.lives, 3, 'no life lost when the wingman absorbs the hit');
  eq(g.state, ST_RESPAWN, 'enters RESPAWN to re-form as single');
  // a non-dual fatal hit DOES cost a life (contrast case)
  const g2 = fresh();
  g2.playerAlive = true; g2.cheatInvincible = false; g2.shieldCharges = 0;
  g2.dualFighter = false; g2.lives = 3; g2.state = 2;
  G.killPlayer(100, 100, 'bullet', 'bee');
  eq(g2.lives, 2, 'single-ship fatal hit costs a life');
} else { console.log('  (skipped — killPlayer not exposed)'); }

// ============================================================
section('ACHIEVEMENTS: every defined achievement is unlockable & no unlock is undefined');
{
  // Source-level guard. An ACHIEVEMENTS entry with no unlockAchievement('id')
  // reference is unreachable (dead); an unlockAchievement('id') whose id isn't
  // defined silently no-ops. With 100+ achievements this drift is easy to miss.
  // Line-scan from `const ACHIEVEMENTS = {` to the first line that is exactly `};`
  // (mirrors the robust sed-range approach; a single non-greedy regex truncates
  // early on the first nested-looking close).
  const _lines = scriptSrc.split('\n');
  const _start = _lines.findIndex(l => /const ACHIEVEMENTS = \{/.test(l));
  const defined = new Set();
  let foundBlock = false;
  if (_start >= 0) {
    for (let i = _start + 1; i < _lines.length; i++) {
      if (/^\};/.test(_lines[i])) { foundBlock = true; break; }   // closing `};` at col 0
      const km = _lines[i].match(/^\s+([a-zA-Z0-9]+)\s*:\s*\{/);   // `  key: { ... }`
      if (km) defined.add(km[1]);
    }
  }
  ok(foundBlock, 'ACHIEVEMENTS object found + closed in source');
  {
    ok(defined.size >= 50, 'ACHIEVEMENTS defines >= 50 (got ' + defined.size + ')');
    const refs = new Set((scriptSrc.match(/unlockAchievement\('([a-zA-Z0-9]+)'\)/g) || [])
      .map(s => s.match(/'([a-zA-Z0-9]+)'/)[1]));
    // every referenced id must be defined (no silent no-op unlocks)
    let allDefined = true, undef = [];
    for (const r of refs) { if (!defined.has(r)) { allDefined = false; undef.push(r); } }
    ok(allDefined, 'every unlockAchievement id is defined' + (undef.length ? ' (undefined: ' + undef.slice(0, 5).join(', ') + ')' : ''));
    // every defined achievement must have at least one literal unlock reference
    let allReachable = true, dead = [];
    for (const d of defined) { if (!refs.has(d)) { allReachable = false; dead.push(d); } }
    ok(allReachable, 'every defined achievement has an unlock reference' + (dead.length ? ' (unreachable: ' + dead.slice(0, 5).join(', ') + ')' : ''));
  }
}

// ============================================================
section('CHECKPOINT_OPTIONS ⊇ MILESTONE_STAGES (every milestone is a startable checkpoint)');
{
  // Source-level guard. highestCheckpoint can only become a MILESTONE_STAGES value,
  // and availableStartStages() offers CHECKPOINT_OPTIONS ≤ highestCheckpoint. If a
  // milestone isn't also a checkpoint option, clearing it would never unlock a
  // matching start-stage entry. Keep CHECKPOINT_OPTIONS ⊇ MILESTONE_STAGES (+ stage 1).
  const coM = scriptSrc.match(/CHECKPOINT_OPTIONS = \[([^\]]*)\]/);
  const msM = scriptSrc.match(/MILESTONE_STAGES = \[([^\]]*)\]/);
  ok(!!coM && !!msM, 'CHECKPOINT_OPTIONS + MILESTONE_STAGES found in source');
  if (coM && msM) {
    const co = new Set(coM[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
    const ms = msM[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    ok(co.has(1), 'CHECKPOINT_OPTIONS includes stage 1 (always startable)');
    let allCovered = true, missing = [];
    for (const m of ms) { if (!co.has(m)) { allCovered = false; missing.push(m); } }
    ok(allCovered, 'every MILESTONE_STAGES value is a CHECKPOINT_OPTIONS entry' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  }
}

// ============================================================
section('pickRunTitle reflects the run\'s dominant playstyle');
if (typeof G.pickRunTitle === 'function') {
  const g = fresh();
  g.stats = { kills: 0, shotsFired: 0, shotsHit: 0, maxStage: 1 };
  eq(G.pickRunTitle(), 'THE PILOT', 'baseline run = THE PILOT');
  g.runFlawlessBosses = 1;
  eq(G.pickRunTitle(), 'THE SURGEON', 'flawless boss = THE SURGEON (top priority)');
  g.runFlawlessBosses = 0; g.bossKills = 3;
  eq(G.pickRunTitle(), 'THE SLAYER', '3 bosses = THE SLAYER');
  g.bossKills = 0; g.witchSaves = 3;
  eq(G.pickRunTitle(), 'THE TIME-BENDER', '3 witch saves = THE TIME-BENDER');
  g.witchSaves = 0; g.parryCount = 20;
  eq(G.pickRunTitle(), 'THE DEFLECTOR', 'many parries = THE DEFLECTOR');
  g.parryCount = 0; g.comboBest = 30;
  eq(G.pickRunTitle(), 'THE CHAINMASTER', 'combo 30 = THE CHAINMASTER');
  g.comboBest = 0; g.stats = { shotsFired: 100, shotsHit: 95, maxStage: 5 };
  eq(G.pickRunTitle(), 'THE MARKSMAN', '95% acc = THE MARKSMAN');
  g.stats = { shotsFired: 0, shotsHit: 0, maxStage: 35 };
  eq(G.pickRunTitle(), 'THE VOIDWALKER', 'stage 35 = THE VOIDWALKER');
  // always returns a non-empty THE-prefixed title
  ok(/^THE /.test(G.pickRunTitle()), 'title is THE-prefixed');
} else { console.log('  (skipped — pickRunTitle not exposed)'); }

// ============================================================
section('INTERCEPT_MSG: every literal pushIntercept(id) is a defined message');
{
  // One-directional guard (referenced ⊆ defined): a pushIntercept('typo') silently
  // no-ops (pushIntercept returns early on an unknown key), so a misspelled trigger
  // is an invisible dead beat. We don't assert the reverse — some keys are pushed
  // via dynamic refs (endurance tiers) the literal scan can't see.
  const lines = scriptSrc.split('\n');
  const start = lines.findIndex(l => /const INTERCEPT_MSG = \{/.test(l));
  const defined = new Set();
  let closed = false;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\};/.test(lines[i])) { closed = true; break; }
      const km = lines[i].match(/^\s+([a-zA-Z]+)\s*:/);
      if (km) defined.add(km[1]);
    }
  }
  ok(closed && defined.size >= 50, 'INTERCEPT_MSG found with >= 50 keys (got ' + defined.size + ')');
  const refs = new Set((scriptSrc.match(/pushIntercept\('([a-zA-Z]+)'\)/g) || [])
    .map(s => s.match(/'([a-zA-Z]+)'/)[1]));
  let allDefined = true, undef = [];
  for (const r of refs) { if (!defined.has(r)) { allDefined = false; undef.push(r); } }
  ok(allDefined, 'every literal pushIntercept id is defined in INTERCEPT_MSG' + (undef.length ? ' (undefined: ' + undef.join(', ') + ')' : ''));
}

// ============================================================
section('diffSpeedMul / diffFireMul — bounded, sane, correctly ordered per mode');
if (typeof G.diffSpeedMul === 'function' && typeof G.diffFireMul === 'function' && typeof G.__setDifficulty === 'function') {
  // diffSpeedMul: easy slower (<1), hard faster (>1), normal = 1
  G.__setDifficulty('easy');   const se = G.diffSpeedMul();
  G.__setDifficulty('normal'); const sn = G.diffSpeedMul();
  G.__setDifficulty('hard');   const sh = G.diffSpeedMul();
  eq(sn, 1, 'normal speedMul = 1');
  ok(se > 0 && se < 1, 'easy speedMul in (0,1)');
  ok(sh > 1 && sh < 2, 'hard speedMul in (1,2) — bounded, not absurd');
  ok(se < sn && sn < sh, 'speedMul ordered easy < normal < hard');
  // diffFireMul: LOWER = enemies fire MORE (shootEvery uses it). easy higher, hard lower.
  // Tested with no stageMutation so the denseFire divisor doesn't apply.
  G.__setDifficulty('easy');   const fe = G.diffFireMul();
  G.__setDifficulty('normal'); const fn = G.diffFireMul();
  G.__setDifficulty('hard');   const fh = G.diffFireMul();
  eq(fn, 1, 'normal fireMul = 1');
  ok(fe > 1, 'easy fireMul > 1 (enemies fire less often)');
  ok(fh > 0 && fh < 1, 'hard fireMul in (0,1) (enemies fire more often), still positive');
  ok(fh < fn && fn < fe, 'fireMul ordered hard < normal < easy');
  G.__setDifficulty('normal'); // restore
} else { console.log('  (skipped — diff muls / __setDifficulty not exposed)'); }

// ============================================================
section('pickRunHighlights returns a sorted, capped list');
if (typeof G.pickRunHighlights === 'function') {
  const g = fresh();
  g.stats = { kills: 100, shotsFired: 100, shotsHit: 90, maxStage: 12 };
  g.comboBest = 30; g.parryCount = 12; g.bossKills = 2; g.revengeCount = 3;
  g.clusterParryBest = 5; g.runFlawlessBosses = 1;
  const hl = G.pickRunHighlights();
  ok(Array.isArray(hl), 'returns array');
  ok(hl.length <= 3, 'capped to top 3');
  ok(hl.every(h => 'label' in h && 'value' in h), 'each entry has label+value');
} else { console.log('  (skipped — pickRunHighlights not exposed)'); }

// ============================================================
section('getFormationPos — formation grid geometry contract');
if (typeof G.getFormationPos === 'function') {
  const o = G.getFormationPos(0, 0);
  eq(o.x, 32, 'origin x = startX 32');
  eq(o.y, 36, 'origin y = startY 36');
  // Column spacing is a constant 16px step in x, independent of row.
  eq(G.getFormationPos(1, 0).x - G.getFormationPos(0, 0).x, 16, 'col step = spacingX 16');
  eq(G.getFormationPos(5, 3).x - G.getFormationPos(4, 3).x, 16, 'col step constant across rows');
  // Row spacing is a constant 14px step in y, independent of column.
  eq(G.getFormationPos(0, 1).y - G.getFormationPos(0, 0).y, 14, 'row step = spacingY 14');
  eq(G.getFormationPos(6, 2).y - G.getFormationPos(6, 1).y, 14, 'row step constant across cols');
  // Linearity: position is purely affine in (col, row).
  eq(G.getFormationPos(3, 2).x, 32 + 3 * 16, 'x linear in col');
  eq(G.getFormationPos(3, 2).y, 36 + 2 * 14, 'y linear in row');
  // Same row shares y across columns; same column shares x across rows.
  eq(G.getFormationPos(0, 2).y, G.getFormationPos(5, 2).y, 'shared row → shared y');
  eq(G.getFormationPos(4, 0).x, G.getFormationPos(4, 3).x, 'shared col → shared x');
  // A standard 8-wide formation (cols 0..7) must stay on-screen (BASE_W 224)
  // with room for the enemy half-width (~8px) — guards against an origin/spacing
  // regression silently pushing the rightmost column off the right edge.
  ok(G.getFormationPos(7, 0).x + 8 < 224, 'rightmost col (7) + half-width on-screen');
  ok(G.getFormationPos(0, 0).x - 8 > 0, 'leftmost col (0) - half-width on-screen');
} else { console.log('  (skipped — getFormationPos not exposed)'); }

// ============================================================
section('pickStageMutation — gates keep boss/challenge/tutorial stages clean');
if (typeof G.pickStageMutation === 'function' && typeof G.__getStageMutations === 'function') {
  const g = fresh();
  g.dailyMode = false; g.challengeMode = false;
  g.stage = 3;  eq(G.pickStageMutation(), null, 'stage <= 4 (tutorial window) → null');
  g.stage = 10; eq(G.pickStageMutation(), null, 'boss stage (stage % 10 === 0) → null');
  g.stage = 8;  eq(G.pickStageMutation(), null, 'challenge stage (stage % 4 === 0) → null');
  g.stage = 5; g.challengeMode = true;
  eq(G.pickStageMutation(), null, 'challenge mode → null (fixed ruleset)');
  g.challengeMode = false;
  // Eligible normal stage: force the 30% random gate both directions.
  const muts = G.__getStageMutations();
  const _r = G.Math.random;
  G.Math.random = () => 0.99; // >= 0.30 → no trigger
  eq(G.pickStageMutation(), null, 'eligible stage, roll above 30% → null');
  G.Math.random = () => 0;    // < 0.30 → trigger, picks index 0
  const picked = G.pickStageMutation();
  G.Math.random = _r;         // restore before any other test
  ok(muts && muts.indexOf(picked) !== -1, 'eligible stage, roll under 30% → a real STAGE_MUTATIONS member');
} else { console.log('  (skipped — pickStageMutation / __getStageMutations not exposed)'); }

// ============================================================
section('pickAmbientEvent — tutorial gate + valid event id when triggered');
if (typeof G.pickAmbientEvent === 'function') {
  const g = fresh();
  g.stage = 2; eq(G.pickAmbientEvent(), null, 'stage <= 3 (pure-space tutorial) → null');
  g.stage = 6;
  const valid = ['cargoShip', 'supernova', 'satellite', 'comet', 'pulsar', 'meteorShower'];
  const _r = G.Math.random;
  G.Math.random = () => 0.99; eq(G.pickAmbientEvent(), null, 'roll above 35% → null');
  G.Math.random = () => 0;    const ev = G.pickAmbientEvent();
  G.Math.random = _r;
  ok(valid.indexOf(ev) !== -1, 'triggered event is one of the six known types');
} else { console.log('  (skipped — pickAmbientEvent not exposed)'); }

// ============================================================
section('pickPerkOffer — 3 distinct valid perks (splice-dedup contract)');
if (typeof G.pickPerkOffer === 'function') {
  // Run several trials so the random selection is exercised; the distinctness
  // contract (guaranteed by splice) must hold on every draw — a regression to a
  // non-removing pick would let the same perk be offered twice.
  for (let trial = 0; trial < 6; trial++) {
    const offer = G.pickPerkOffer();
    ok(Array.isArray(offer) && offer.length === 3, 'returns 3 perks (trial ' + trial + ')');
    eq(new Set(offer).size, 3, 'all 3 distinct — no duplicate offer (trial ' + trial + ')');
    ok(offer.every(p => typeof p === 'string' && p.length > 0), 'each is a non-empty perk id (trial ' + trial + ')');
  }
} else { console.log('  (skipped — pickPerkOffer not exposed)'); }

// ============================================================
section('pickFormationVariant — deterministic stage→formation mapping');
if (typeof G.pickFormationVariant === 'function') {
  const g = fresh();
  const fv = (s) => { g.stage = s; return G.pickFormationVariant(); };
  // s < 8 always 'grid', even when the modulo would otherwise match a variant —
  // the early guard must take precedence (regression risk if reordered).
  eq(fv(1), 'grid', 's=1 → grid (s<8 guard beats 1%20===1 diamond)');
  eq(fv(6), 'grid', 's=6 → grid (s<8 guard beats 6%20===6 wave)');
  eq(fv(7), 'grid', 's=7 → grid (still inside the <8 window)');
  // First variant cycle (stages 8..27)
  eq(fv(8),  'grid',    's=8 → grid (no modulo match)');
  eq(fv(10), 'grid',    's=10 → grid');
  eq(fv(11), 'v',       's=11 → v (11%20===11)');
  eq(fv(16), 'circle',  's=16 → circle (16%20===16)');
  eq(fv(21), 'diamond', 's=21 → diamond (21%20===1, first eligible)');
  eq(fv(26), 'wave',    's=26 → wave (26%20===6, first eligible)');
  // %20 wraparound — second cycle reproduces the same shapes
  eq(fv(31), 'v',       's=31 → v (31%20===11)');
  eq(fv(36), 'circle',  's=36 → circle (36%20===16)');
  eq(fv(41), 'diamond', 's=41 → diamond (41%20===1)');
} else { console.log('  (skipped — pickFormationVariant not exposed)'); }

// ============================================================
section('pickSupplyCrate — gates: boss/challenge/early stages never roll');
if (typeof G.pickSupplyCrate === 'function') {
  const g = fresh();
  g.challengeMode = false; g.dailyMode = false;
  g.stage = 3;  eq(G.pickSupplyCrate(), false, 'stage < 5 → false');
  g.stage = 10; eq(G.pickSupplyCrate(), false, 'boss stage → false');
  g.stage = 8;  eq(G.pickSupplyCrate(), false, 'challenge stage → false');
  g.stage = 5; // eligible normal stage
  const _r = G.Math.random;
  G.Math.random = () => 0.99; eq(G.pickSupplyCrate(), false, 'eligible, roll >= 30% → false');
  G.Math.random = () => 0;    eq(G.pickSupplyCrate(), true,  'eligible, roll < 30% → true');
  G.Math.random = _r;
} else { console.log('  (skipped — pickSupplyCrate not exposed)'); }

// ============================================================
section('pickStageObjective — gates + well-formed objective when triggered');
if (typeof G.pickStageObjective === 'function') {
  const g = fresh();
  g.challengeMode = false;
  eq(G.pickStageObjective(3), null, 'stage <= 4 → null');
  g.challengeMode = true;
  eq(G.pickStageObjective(8), null, 'challenge mode → null (own structure)');
  g.challengeMode = false;
  const _r = G.Math.random;
  G.Math.random = () => 0.99; eq(G.pickStageObjective(8), null, 'roll >= 40% → null');
  G.Math.random = () => 0;    const obj = G.pickStageObjective(8);
  G.Math.random = _r;
  ok(obj && typeof obj.id === 'string' && typeof obj.met === 'function',
     'triggered → well-formed objective with id + met()');
} else { console.log('  (skipped — pickStageObjective not exposed)'); }

// ============================================================
section('actStartFor / actEndingAt — exact-match act-card lookups');
if (typeof G.actStartFor === 'function' && typeof G.actEndingAt === 'function') {
  // Start cards fire ONLY on the exact startStage; null otherwise.
  const a2 = G.actStartFor(11);
  ok(a2 && a2.num === 'II' && a2.title === 'THE BREACH', 'actStartFor(11) → ACT II THE BREACH');
  eq(G.actStartFor(12), null, 'actStartFor(12) → null (not a start stage)');
  eq(G.actStartFor(10), null, 'actStartFor(10) → null (ACT I has no start card)');
  ok((G.actStartFor(21) || {}).num === 'III', 'actStartFor(21) → ACT III');
  // End ceremonies fire on the exact endStage; ACT I's end is a special-cased
  // standalone object (not in the ACT_TITLES array) — losing that line drops the
  // very first act-complete ceremony, so it gets its own assertion.
  const e1 = G.actEndingAt(10);
  ok(e1 && e1.title === 'AWAKENING', 'actEndingAt(10) → ACT_ONE_END AWAKENING (special case)');
  ok((G.actEndingAt(20) || {}).num === 'II', 'actEndingAt(20) → ACT II ending');
  eq(G.actEndingAt(15), null, 'actEndingAt(15) → null (mid-act, no ceremony)');
} else { console.log('  (skipped — actStartFor/actEndingAt not exposed)'); }

// ============================================================
section('daily-date helpers — seed monotonicity, code stability, format');
if (typeof G.dailySeed === 'function') {
  const s = G.dailySeed();
  ok(Number.isInteger(s) && s > 20000000, 'dailySeed is a YYYYMMDD-encoded integer');
  const month = Math.floor((s % 10000) / 100), day = s % 100;
  ok(month >= 1 && month <= 12, 'encoded month in 1..12');
  ok(day >= 1 && day <= 31, 'encoded day in 1..31');
  if (typeof G.dailySeedYesterday === 'function') {
    // The YYYYMMDD encoding is monotone with the calendar date, so yesterday's
    // seed always sorts strictly before today's — even across a month/year
    // rollover. Guards a broken date-subtraction or rollover regression.
    ok(G.dailySeedYesterday() < s, "yesterday's seed strictly precedes today's");
  }
} else { console.log('  (skipped — dailySeed not exposed)'); }
if (typeof G.dailySeedCode === 'function') {
  const c1 = G.dailySeedCode(), c2 = G.dailySeedCode();
  ok(/^[0-9A-Z]{4}$/.test(c1), 'dailySeedCode → 4 uppercase base36 chars');
  eq(c1, c2, 'dailySeedCode stable within a day (deterministic from seed)');
}
if (typeof G.todayShort === 'function') {
  ok(/^\d{6}$/.test(G.todayShort()), 'todayShort → 6 digits (YYMMDD)');
}

// ============================================================
section('setupChallengingStage — wave structure + depth-scaled counts');
if (typeof G.setupChallengingStage === 'function') {
  const g = fresh();
  // Base stage (<20): GROUP_SIZE 8 → 2 groups × 8 = 16 enemies/wave → 128 total.
  g.stage = 8;
  G.setupChallengingStage();
  eq(g.challengeWaves.length, 8, '8 waves built');
  ok(g.challengeWaves.every(w => w.length === 16), 'base stage: 16 enemies/wave');
  eq(g.challengeTotal, 128, 'challengeTotal = 8×16 at base (dynamic, not hardcoded)');
  // Depth scaling: stage 20+ → GROUP_SIZE 9 → 18/wave; stage 40+ → 10 → 20/wave.
  // Locks the GROUP_SIZE ramp so it can't silently drift back to "uniform 16".
  g.stage = 20;
  G.setupChallengingStage();
  ok(g.challengeWaves.every(w => w.length === 18), 'stage 20+: 18 enemies/wave');
  eq(g.challengeTotal, 144, 'challengeTotal = 8×18 at stage 20');
  g.stage = 40;
  G.setupChallengingStage();
  ok(g.challengeWaves.every(w => w.length === 20), 'stage 40+: 20 enemies/wave');
  eq(g.challengeTotal, 160, 'challengeTotal = 8×20 at stage 40');
  // challengeTotal must equal the actual built enemy count (drives the
  // challengeHits === challengeTotal perfect-clear check).
  const built = g.challengeWaves.reduce((s, w) => s + w.length, 0);
  eq(g.challengeTotal, built, 'challengeTotal matches summed wave lengths');
  // Per-group composition: 1 boss each → 2 bosses/wave (1 per sub-group).
  eq(g.challengeWaves[0].filter(e => e.type === 'boss').length, 2, 'wave has 2 bosses (1 per sub-group)');
} else { console.log('  (skipped — setupChallengingStage not exposed)'); }

// ============================================================
section('makeMegaBoss — HP/spread/scale scaling + opts overrides');
if (typeof G.makeMegaBoss === 'function') {
  const b10 = G.makeMegaBoss(10);
  eq(b10.maxHp, 50, 'stage 10 baseHp = 20 + 10×3');
  eq(b10.hp, b10.maxHp, 'hp starts at full maxHp');
  eq(b10.spreadCount, 5, 'stage 10 (>=4) → spreadCount 5');
  eq(b10.scale, 1, 'non-super scale = 1');
  eq(b10.super, false, 'non-super flag');
  ok(b10.alive === true && b10.phase2 === false && b10.phase3 === false, 'fresh boss: alive, no phases');
  eq(b10.x, 112, 'default x = BASE_W/2 (224/2)');
  eq(G.makeMegaBoss(10, { x: 50 }).x, 50, 'x override honored');
  eq(G.makeMegaBoss(2).spreadCount, 3, 'stage <4 → spreadCount 3');
  // SUPER boss (stage 30+ path): hpScale 2.5, scale 1.5, spreadCount 7
  const bs = G.makeMegaBoss(30, { super: true, hpScale: 2.5 });
  eq(bs.maxHp, Math.round((20 + 90) * 2.5), 'super hpScale 2.5 applied to baseHp');
  eq(bs.scale, 1.5, 'super scale = 1.5');
  eq(bs.spreadCount, 7, 'super spreadCount = 7');
  eq(bs.super, true, 'super flag set');
  eq(G.makeMegaBoss(20, { hpScale: 0.65 }).maxHp, Math.round((20 + 60) * 0.65), 'twin-boss hpScale 0.65');
  // Interval floors hold at deep stages where (90 - s×4) would go negative.
  ok(G.makeMegaBoss(40).shootInterval >= 28, 'shootInterval floored at >=28');
  ok(G.makeMegaBoss(40).dashInterval >= 90, 'dashInterval floored at >=90');
} else { console.log('  (skipped — makeMegaBoss not exposed)'); }

// ============================================================
section('setupBossStage — boss count + scaling by stage band');
if (typeof G.setupBossStage === 'function' && typeof G.makeMegaBoss === 'function') {
  const g = fresh();
  g.stage = 10; G.setupBossStage();
  eq(g.megaBosses.length, 1, 'stage 10 (<20) → 1 boss');
  eq(g.megaBosses[0].super, false, 'stage 10 boss not super');
  g.stage = 20; G.setupBossStage();
  eq(g.megaBosses.length, 2, 'stage 20-29 → 2 bosses');
  ok(g.megaBosses.every(b => !b.super), 'twin bosses not super');
  ok(g.megaBosses[0].maxHp < G.makeMegaBoss(20).maxHp, 'twin bosses use reduced HP (0.65×) vs solo');
  g.stage = 30; G.setupBossStage();
  eq(g.megaBosses.length, 1, 'stage 30+ → 1 SUPER boss');
  eq(g.megaBosses[0].super, true, 'stage 30 boss is super');
  ok(g.megaBosses[0].maxHp > G.makeMegaBoss(30).maxHp, 'super boss HP exceeds base (2.5× scale)');
} else { console.log('  (skipped — setupBossStage / makeMegaBoss not exposed)'); }

// ============================================================
section('createFormation grid — fixed 40-enemy structure, in-bounds, 4 bosses');
if (typeof G.createFormation === 'function' && typeof G.__getGame === 'function') {
  const g = fresh();
  g.stage = 5; // <8 → pickFormationVariant deterministically returns 'grid'
  G.createFormation();
  eq(g.formationVariant, 'grid', 'stage 5 uses grid variant');
  eq(g.enemies.length, 40, 'grid = 4 bosses + 16 butterflies + 20 bees = 40');
  // Bosses are hardcoded (row 0, never substituted by the variant type-picks).
  eq(g.enemies.filter(e => e.type === 'boss').length, 4, 'exactly 4 bosses (hardcoded row 0)');
  eq(g.enemies.filter(e => e.row >= 3).length, 20, '20 enemies in bee rows 3-4');
  ok(g.enemies.every(e => e.state === 'formation' && e.alive), 'all start alive in formation');
  ok(g.enemies.every(e => e.hp >= 1 && e.hp <= 2), 'hp in [1,2] (boss/shielded 2, +1 elite)');
  ok(g.enemies.every(e => e.homeX >= 0 && e.homeX <= 224 && e.homeY >= 0 && e.homeY <= 288),
     'every formation home position is on-screen (BASE_W 224 × BASE_H 288)');
  ok(g.enemies.every(e => e.x === e.homeX && e.y === e.homeY), 'spawn x/y seeded at home position');
} else { console.log('  (skipped — createFormation / __getGame not exposed)'); }

// ============================================================
section('setupEntryAnimation — no dead lead-time on variant formations');
if (typeof G.createFormation === 'function' && typeof G.setupEntryAnimation === 'function') {
  const g = fresh();
  // Stage 11 → 'v' variant: place() tags every enemy row=0, so the row-keyed entry
  // waves collapse to ONE populated wave. Before the empty-wave-skip fix this sat
  // at raw index 6 → entryDelay 300+ → a 5s empty playfield at stage start. Now the
  // lone populated wave is effective-wave-0 and enemies enter immediately.
  g.stage = 11; // <18 so spiral entry is off (deterministic side-curve path)
  G.createFormation();
  G.setupEntryAnimation();
  eq(g.formationVariant, 'v', 'stage 11 → v variant');
  ok(g.enemies.length > 0, 'variant formation built enemies');
  ok(g.enemies.every(e => e.state === 'entering'), 'all enemies marked entering');
  const delays = g.enemies.map(e => e.entryDelay);
  eq(Math.min(...delays), 0, 'first variant enemy enters immediately (no 5s dead lead)');
  ok(Math.max(...delays) < 300, 'variant entry compressed to one effective wave (<300f, was 300+)');
  // Grid pacing preserved: all 7 row-waves populated → effWave === wi, bosses last.
  g.stage = 5;
  G.createFormation();
  G.setupEntryAnimation();
  const gd = g.enemies.map(e => e.entryDelay);
  eq(Math.min(...gd), 0, 'grid wave 0 enters immediately');
  ok(Math.max(...gd) >= 300, 'grid bosses (wave 6) still ~300f in — grid pacing unchanged');
} else { console.log('  (skipped — createFormation/setupEntryAnimation not exposed)'); }

// ============================================================
section('createFormation variants — every enemy spawns on-screen');
if (typeof G.createFormation === 'function' && typeof G.__getGame === 'function') {
  const g = fresh();
  // Variant layouts use floating overrideX/Y math (cx ± n·stepX, radius·cos…). A
  // regression in a step/radius constant could push enemies off the playfield;
  // this locks the on-screen guarantee for all four variants.
  const cases = [[11, 'v'], [16, 'circle'], [21, 'diamond'], [26, 'wave']];
  for (const [stage, variant] of cases) {
    g.stage = stage;
    G.createFormation();
    eq(g.formationVariant, variant, 'stage ' + stage + ' → ' + variant);
    ok(g.enemies.length > 0, variant + ': built enemies');
    ok(g.enemies.every(e => e.homeX >= 0 && e.homeX <= 224 && e.homeY >= 0 && e.homeY <= 288),
       variant + ': every home position on-screen (BASE_W 224 × BASE_H 288)');
    ok(g.enemies.every(e => e.x === e.homeX && e.y === e.homeY), variant + ': spawn seeded at home');
    ok(g.enemies.some(e => e.type === 'boss'), variant + ': has at least one boss');
  }
} else { console.log('  (skipped — createFormation / __getGame not exposed)'); }

// ============================================================
section('splitter fragments survive a piercing-laser kill (deferred spawn)');
if (typeof G.updateCollisions === 'function' && typeof G.createEnemy === 'function') {
  const g = fresh();
  // Build a splitter at a known position and a laser sitting on it.
  const splitter = G.createEnemy('splitter', 0, 0, 100, 100);
  g.enemies = [splitter];
  g.bullets = [{ x: 100, y: 100, kind: 'laser', pierced: new Set(), dmg: 5, vy: -7, lvl: 1 }];
  // Keep the player far from the splitter so body/parry loops don't interfere.
  g.playerX = 20; g.playerY = 280; g.dashTimer = 0; g.invincibleTimer = 0;
  G.updateCollisions();
  ok(splitter.alive === false, 'laser kills the splitter');
  const minis = g.enemies.filter(e => e.type === 'minibee');
  eq(minis.length, 2, 'splitter spawned 2 minibees');
  // The fix: minibees are appended AFTER the bullet loop, so the same piercing
  // laser cannot instakill them on their spawn frame.
  ok(minis.every(m => m.alive === true), 'both minibees survive the spawn frame (not laser-instakilled)');
} else { console.log('  (skipped — updateCollisions / createEnemy not exposed)'); }

// ============================================================
section('nonFireBulletCount — excludes guardian/parry-echo from fire cap');
if (typeof G.nonFireBulletCount === 'function') {
  eq(G.nonFireBulletCount([]), 0, 'empty → 0');
  // Plain player + fork bullets are fire-button shots → NOT counted.
  eq(G.nonFireBulletCount([{}, { fork: true }, { kind: 'laser' }]), 0, 'player/fork/laser shots → 0');
  // Guardian-ally and parry-echo bullets ARE excluded from the player cap.
  eq(G.nonFireBulletCount([{ _guardian: true }]), 1, 'guardian bullet counted');
  eq(G.nonFireBulletCount([{ _parryEcho: true }]), 1, 'parry-echo bullet counted');
  eq(G.nonFireBulletCount([{}, { _guardian: true }, { fork: true }, { _parryEcho: true }, {}]), 2,
     'mixed array: only the 2 non-fire bullets counted');
  // The cap math (live length − nonFire) must reflect only the player's own shots:
  // 5 bullets, 2 of them ally/echo → 3 count against maxBullets.
  const mixed = [{}, { _guardian: true }, {}, { _parryEcho: true }, {}];
  eq(mixed.length - G.nonFireBulletCount(mixed), 3, 'player-owned bullets = length − nonFire');
} else { console.log('  (skipped — nonFireBulletCount not exposed)'); }

// ============================================================
section('computeSynergy — S/N/P build-mode thresholds');
if (typeof G.computeSynergy === 'function') {
  // The three named builds at their trigger combos (S/N/P caps are 5/3/3).
  eq(G.computeSynergy(5, 3, 3), 'OVERLOAD', 'S5 N3 P3 → OVERLOAD (all maxed)');
  eq(G.computeSynergy(5, 1, 1), 'BLINK',    'S5 N1 P1 → BLINK (speed build)');
  eq(G.computeSynergy(1, 1, 3), 'HEAVY',    'S1 N1 P3 → HEAVY (damage build)');
  // No synergy for off-combo level sets.
  eq(G.computeSynergy(1, 1, 1), null, 'fresh S1 N1 P1 → null');
  eq(G.computeSynergy(3, 2, 2), null, 'mid mixed → null');
  // Boundary precision: BLINK/HEAVY require EXACT 1s, OVERLOAD requires the floors.
  eq(G.computeSynergy(5, 2, 1), null, 'S5 N2 P1 → null (BLINK needs N===1, OVERLOAD needs N>=3)');
  eq(G.computeSynergy(4, 1, 1), null, 'S4 N1 P1 → null (BLINK needs S>=5)');
  eq(G.computeSynergy(2, 1, 3), null, 'S2 N1 P3 → null (HEAVY needs S===1)');
  eq(G.computeSynergy(5, 3, 2), null, 'S5 N3 P2 → null (OVERLOAD needs P>=3)');
  // Priority: OVERLOAD is checked before BLINK, so all-maxed is OVERLOAD not BLINK.
  ok(G.computeSynergy(5, 3, 3) !== 'BLINK', 'all-maxed resolves to OVERLOAD, not BLINK');
} else { console.log('  (skipped — computeSynergy not exposed)'); }

// ============================================================
section('computeFireCooldown — RAPID/mutation/perk/synergy stacking + min-2 floor');
if (typeof G.computeFireCooldown === 'function') {
  eq(G.computeFireCooldown(false, false, false, false), 6, 'base = 6 frames');
  eq(G.computeFireCooldown(true,  false, false, false), 3, 'RAPID pickup halves to 3');
  eq(G.computeFireCooldown(false, true,  false, false), 3, 'RAPID FIRE mutation: floor(6/1.7)=3');
  eq(G.computeFireCooldown(true,  true,  false, false), 2, 'RAPID+mutation: floor(3/1.7)=1 → floored to 2');
  eq(G.computeFireCooldown(false, false, true,  false), 4, 'fastFingers perk: floor(6*0.75)=4');
  eq(G.computeFireCooldown(false, false, false, true),  3, 'OVERLOAD synergy: floor(6*0.6)=3');
  eq(G.computeFireCooldown(false, false, true,  true),  2, 'fastFingers+OVERLOAD: 6→4→floor(4*0.6)=2');
  // The min-2 floor is the safety invariant — no stack can drive cd to 0/1.
  eq(G.computeFireCooldown(true,  true,  true,  true),  2, 'all modifiers stacked still floors at 2');
  ok(G.computeFireCooldown(true, true, true, true) >= 2, 'cd never below 2 (no infinite-fire)');
} else { console.log('  (skipped — computeFireCooldown not exposed)'); }

// ============================================================
section('computeBulletDamage — additive P/ship/perk/synergy sources');
if (typeof G.computeBulletDamage === 'function') {
  eq(G.computeBulletDamage(1, 0, false, null, false), 1, 'P1 base = 1');
  eq(G.computeBulletDamage(3, 0, false, null, false), 3, 'P3 = 3');
  eq(G.computeBulletDamage(1, 1, false, null, false), 2, 'ship dmgBonus +1');
  eq(G.computeBulletDamage(1, 0, true,  null, false), 2, 'heavyRound perk +1');
  eq(G.computeBulletDamage(1, 0, false, 'OVERLOAD', false), 2, 'OVERLOAD synergy +1');
  eq(G.computeBulletDamage(1, 0, false, 'HEAVY', false), 3, 'HEAVY synergy +2');
  eq(G.computeBulletDamage(1, 0, false, 'BLINK', false), 1, 'BLINK gives no damage bonus');
  eq(G.computeBulletDamage(1, 0, false, null, true), 3, 'lastStand (1 life) +2');
  // OVERLOAD/HEAVY mutually exclusive (else-if): OVERLOAD wins, +1 not +3.
  eq(G.computeBulletDamage(1, 0, false, 'OVERLOAD', false), 2, 'OVERLOAD only +1, not OVERLOAD+HEAVY');
  // Full stack: P3 + ship1 + heavyRound1 + HEAVY2 + lastStand2 = 9.
  eq(G.computeBulletDamage(3, 1, true, 'HEAVY', true), 9, 'all additive sources stack');
} else { console.log('  (skipped — computeBulletDamage not exposed)'); }

// ============================================================
section('computeBulletSpeed — S scaling × BLINK/firebrand multipliers');
if (typeof G.computeBulletSpeed === 'function') {
  // S-level scaling uses 0.25 steps (exact in binary) — safe for ===.
  eq(G.computeBulletSpeed(4, 1, false, false), 4, 'S1 = base (no scaling)');
  eq(G.computeBulletSpeed(4, 3, false, false), 6, 'S3 = base × 1.5');
  eq(G.computeBulletSpeed(4, 5, false, false), 8, 'S5 = base × 2.0 (max)');
  // ×1.3 multipliers — float-tolerant compare.
  ok(Math.abs(G.computeBulletSpeed(4, 1, true, false) - 5.2) < 1e-9, 'BLINK ×1.3');
  ok(Math.abs(G.computeBulletSpeed(4, 1, false, true) - 5.2) < 1e-9, 'firebrand ×1.3');
  ok(Math.abs(G.computeBulletSpeed(4, 1, true, true) - 6.76) < 1e-9, 'BLINK+firebrand stack ×1.69');
} else { console.log('  (skipped — computeBulletSpeed not exposed)'); }

// ============================================================
section('cappedStageSpeed — enemy aimed-shot ramp/cap × difficulty');
if (typeof G.cappedStageSpeed === 'function') {
  // base + stage·perStage, clamped to cap, then × diffMul.
  eq(G.cappedStageSpeed(3.0, 1.0, 0.1, 0,  1), 1, 'stage 0 → base only (1.0)');
  eq(G.cappedStageSpeed(3.0, 1.0, 0.1, 10, 1), 2, 'stage 10 below cap → 1.0 + 10×0.1 = 2.0');
  eq(G.cappedStageSpeed(2.0, 1.0, 0.1, 100, 1), 2, 'high stage clamped to cap 2.0');
  // Difficulty multiplier applies AFTER the cap (so hard fire can exceed raw cap).
  ok(Math.abs(G.cappedStageSpeed(3.0, 1.0, 0.1, 10, 1.15) - 2.3) < 1e-9, 'hard ×1.15 after cap (2.0→2.3)');
  ok(Math.abs(G.cappedStageSpeed(3.0, 1.0, 0.1, 10, 0.85) - 1.7) < 1e-9, 'easy ×0.85 (2.0→1.7)');
  ok(Math.abs(G.cappedStageSpeed(2.0, 1.0, 0.5, 50, 1.15) - 2.3) < 1e-9, 'cap clamps the base speed, then ×diffMul');
} else { console.log('  (skipped — cappedStageSpeed not exposed)'); }

// ============================================================
section('aimVelocity — unit-direction × speed, zero-distance NaN guard');
if (typeof G.aimVelocity === 'function') {
  // Straight right: from (0,0) to (10,0) at speed 3 → vx=3, vy=0.
  let v = G.aimVelocity(0, 0, 10, 0, 3);
  ok(Math.abs(v.vx - 3) < 1e-9 && Math.abs(v.vy) < 1e-9, 'rightward aim → (3, 0)');
  // Straight down: from (0,0) to (0,-5) at speed 2 → vy=-2.
  v = G.aimVelocity(0, 0, 0, -5, 2);
  ok(Math.abs(v.vx) < 1e-9 && Math.abs(v.vy + 2) < 1e-9, 'upward aim → (0, -2)');
  // 3-4-5 triangle: to (3,4) at speed 5 → (3,4) exactly (unit (0.6,0.8)×5).
  v = G.aimVelocity(0, 0, 3, 4, 5);
  ok(Math.abs(v.vx - 3) < 1e-9 && Math.abs(v.vy - 4) < 1e-9, '3-4-5 aim → (3, 4)');
  // Magnitude always equals the requested speed (normalized).
  v = G.aimVelocity(7, 2, -4, 9, 6);
  ok(Math.abs(Math.hypot(v.vx, v.vy) - 6) < 1e-9, 'velocity magnitude == speed');
  // Zero distance (shooter on target): || 1 guard → no NaN/Infinity, returns 0 vector.
  v = G.aimVelocity(5, 5, 5, 5, 4);
  ok(Number.isFinite(v.vx) && Number.isFinite(v.vy), 'same-point aim → finite (no NaN)');
  ok(v.vx === 0 && v.vy === 0, 'same-point aim → zero velocity');
} else { console.log('  (skipped — aimVelocity not exposed)'); }

// ============================================================
section('aabbHit — symmetric box overlap (the 9 collision sites)');
if (typeof G.aabbHit === 'function') {
  // Dead center is always a hit for any positive half-extents.
  ok(G.aabbHit(0, 0, 5, 5), 'center → hit');
  // Inside the box on both axes.
  ok(G.aabbHit(4, 4, 5, 5), 'inside both axes → hit');
  ok(G.aabbHit(-4, -4, 5, 5), 'inside (negative quadrant, abs) → hit');
  // Strict `<`: exactly on an edge is a MISS (matches every original site's `<`).
  ok(!G.aabbHit(5, 0, 5, 5), 'x exactly on edge → miss (strict <)');
  ok(!G.aabbHit(0, 5, 5, 5), 'y exactly on edge → miss (strict <)');
  // Outside on either axis → miss (AND of both axes).
  ok(!G.aabbHit(6, 0, 5, 5), 'x outside → miss');
  ok(!G.aabbHit(0, 6, 5, 5), 'y outside → miss');
  ok(!G.aabbHit(4, 9, 5, 5), 'x in but y out → miss (needs both)');
  // Asymmetric extents (e.g. player box wider than tall: hitW+N vs literal).
  ok(G.aabbHit(7, 3, 9, 4), 'asymmetric wide box → hit inside');
  ok(!G.aabbHit(7, 3, 6, 4), 'same point, narrower halfW → miss');
  // Identity vs the inlined form it replaces, across random pure-arg samples.
  let drift = 0;
  for (let i = 0; i < 200; i++) {
    const dx = (Math.random() - 0.5) * 40, dy = (Math.random() - 0.5) * 40;
    const hw = Math.random() * 20, hh = Math.random() * 20;
    const inlined = Math.abs(dx) < hw && Math.abs(dy) < hh;
    if (G.aabbHit(dx, dy, hw, hh) !== inlined) drift++;
  }
  eq(drift, 0, 'aabbHit matches the inlined Math.abs form on 200 random samples');
} else { console.log('  (skipped — aabbHit not exposed)'); }

// ============================================================
section('clamp01 — saturate to [0,1] (12 normalized-fraction sites)');
if (typeof G.clamp01 === 'function') {
  eq(G.clamp01(0.5), 0.5, 'in-range passes through');
  eq(G.clamp01(0), 0, 'lower bound 0 stays');
  eq(G.clamp01(1), 1, 'upper bound 1 stays');
  eq(G.clamp01(-3), 0, 'below 0 → 0');
  eq(G.clamp01(7), 1, 'above 1 → 1');
  eq(G.clamp01(1.0001), 1, 'just above 1 → 1');
  eq(G.clamp01(-0.0001), 0, 'just below 0 → 0');
  // Identity vs the inlined form across random samples (incl. out-of-range).
  let drift = 0;
  for (let i = 0; i < 200; i++) {
    const x = (Math.random() - 0.5) * 4; // spans roughly [-2, 2]
    if (G.clamp01(x) !== Math.max(0, Math.min(1, x))) drift++;
  }
  eq(drift, 0, 'clamp01 matches Math.max(0,Math.min(1,x)) on 200 samples');
} else { console.log('  (skipped — clamp01 not exposed)'); }

// ============================================================
section('jitter — symmetric random offset in [-range/2, range/2) (29 sites)');
if (typeof G.jitter === 'function') {
  eq(G.jitter(0), 0, 'zero range → 0');
  // Range invariant + sign coverage across many draws.
  let lo = Infinity, hi = -Infinity, sawNeg = false, sawPos = false, outOfRange = 0;
  for (let i = 0; i < 5000; i++) {
    const j = G.jitter(10);
    if (j < lo) lo = j;
    if (j > hi) hi = j;
    if (j < 0) sawNeg = true;
    if (j > 0) sawPos = true;
    if (j < -5 || j >= 5) outOfRange++; // [-5, 5)
  }
  eq(outOfRange, 0, 'jitter(10) always within [-5, 5) over 5000 draws');
  ok(sawNeg && sawPos, 'jitter produces both signs');
  ok(lo < -3 && hi > 3, 'jitter(10) spans most of its range (not stuck near 0)');
  // Scales linearly with range: jitter(n) = (rand-0.5)*n, so dividing by n is
  // range-independent — confirm a small range stays tightly bounded.
  let small = 0;
  for (let i = 0; i < 1000; i++) if (Math.abs(G.jitter(0.04)) >= 0.02) small++;
  eq(small, 0, 'jitter(0.04) always within [-0.02, 0.02)');
} else { console.log('  (skipped — jitter not exposed)'); }

// ============================================================
section('randInt — integer in [0, n) (54 Math.floor(Math.random()*n) sites)');
if (typeof G.randInt === 'function') {
  // Always an integer.
  let nonInt = 0, outOfRange = 0;
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const r = G.randInt(5);
    if (!Number.isInteger(r)) nonInt++;
    if (r < 0 || r >= 5) outOfRange++;
    seen.add(r);
  }
  eq(nonInt, 0, 'randInt always returns an integer');
  eq(outOfRange, 0, 'randInt(5) always in [0, 5) over 5000 draws');
  ok([0,1,2,3,4].every(v => seen.has(v)), 'randInt(5) eventually hits all of 0..4');
  ok(!seen.has(5), 'randInt(5) never returns 5 (upper bound exclusive)');
  // randInt(1) is degenerate-but-valid: always 0 (single index).
  let allZero = true;
  for (let i = 0; i < 200; i++) if (G.randInt(1) !== 0) allZero = false;
  ok(allZero, 'randInt(1) always 0 (single-element index)');
  // Identity vs the inlined form: drive the sandbox's Math.random with fixed
  // values and confirm randInt(n) === Math.floor(value * n) for each.
  const realRand = G.Math.random;
  const cases = [[0, 10, 0], [0.49, 10, 4], [0.5, 10, 5], [0.999, 10, 9], [0.25, 8, 2]];
  let drift = 0;
  for (const [v, n, expected] of cases) {
    G.Math.random = () => v;
    if (G.randInt(n) !== expected) drift++;
  }
  G.Math.random = realRand;
  eq(drift, 0, 'randInt(n) === Math.floor(value*n) across fixed random values');
} else { console.log('  (skipped — randInt not exposed)'); }

// ============================================================
section('magnitude — Euclidean vector length (13 Math.sqrt(x*x+y*y) sites)');
if (typeof G.magnitude === 'function') {
  eq(G.magnitude(3, 4), 5, '3-4-5 triangle → 5');
  eq(G.magnitude(0, 0), 0, 'zero vector → 0');
  eq(G.magnitude(5, 0), 5, 'axis-aligned x → 5');
  eq(G.magnitude(0, -7), 7, 'negative y → 7 (sign-independent)');
  eq(G.magnitude(-3, -4), 5, 'both negative → 5');
  ok(Math.abs(G.magnitude(1, 1) - Math.SQRT2) < 1e-9, 'unit diagonal → √2');
  // Identity vs the inlined form across random samples.
  let drift = 0;
  for (let i = 0; i < 200; i++) {
    const x = (Math.random() - 0.5) * 100, y = (Math.random() - 0.5) * 100;
    if (Math.abs(G.magnitude(x, y) - Math.sqrt(x * x + y * y)) > 1e-9) drift++;
  }
  eq(drift, 0, 'magnitude matches Math.sqrt(x*x+y*y) on 200 random samples');
} else { console.log('  (skipped — magnitude not exposed)'); }

// ============================================================
section('rampedInterval — enemy cadence shrinks with stage, floored');
if (typeof G.rampedInterval === 'function') {
  eq(G.rampedInterval(120, 240, 4, 0),  240, 'stage 0 → base interval (240)');
  eq(G.rampedInterval(120, 240, 4, 10), 200, 'stage 10 → 240 − 40 = 200');
  eq(G.rampedInterval(120, 240, 4, 30), 120, 'stage 30 → hits floor (120)');
  // The floor invariant: deep stages clamp to floor, never 0/negative
  // (else enemies would spawn/fire every frame).
  eq(G.rampedInterval(120, 240, 4, 1000), 120, 'stage 1000 → clamped to floor, not negative');
  ok(G.rampedInterval(80, 200, 10, 1000) >= 80, 'interval never drops below floor');
  ok(G.rampedInterval(80, 200, 10, 1000) > 0,    'interval always positive (no every-frame spawn)');
} else { console.log('  (skipped — rampedInterval not exposed)'); }

// ============================================================
section('rampedFireInterval — difficulty-scaled fire cadence, rounded + floored');
if (typeof G.rampedFireInterval === 'function') {
  eq(G.rampedFireInterval(40, 100, 1.2, 10, 1), 88, 'stage 10, normal: round(100 − 12) = 88');
  eq(G.rampedFireInterval(40, 100, 1.2, 5,  1), 94, 'stage 5: round(100 − 6) = 94');
  eq(G.rampedFireInterval(40, 100, 1.2, 10, 0.5), 44, 'easier fire ×0.5: round(88×0.5) = 44');
  // Difficulty pushing below the floor still clamps to the floor.
  eq(G.rampedFireInterval(40, 100, 1.2, 10, 0.4), 40, 'round(88×0.4)=35 → floored to 40');
  // Deep-stage floor invariant: never below floor, never 0/negative.
  eq(G.rampedFireInterval(40, 100, 1.2, 1000, 1), 40, 'deep stage clamps to floor (40)');
  ok(G.rampedFireInterval(40, 100, 1.2, 1000, 1.15) >= 40, 'fire interval never below floor');
} else { console.log('  (skipped — rampedFireInterval not exposed)'); }

// ============================================================
section('reactive vector grid — lattice build, ripple impulse, spring settle');
if (typeof G.buildVectorGrid === 'function'
    && typeof G.gridRipple === 'function'
    && typeof G.updateVectorGrid === 'function'
    && G.__getVgrid) {
  // Build the lattice and assert it fully covers the screen with off-screen edges.
  G.buildVectorGrid();
  const vg = G.__getVgrid();
  ok(vg && vg.pts && vg.pts.length > 0, 'buildVectorGrid populates a point lattice');
  ok(vg.cols > 0 && vg.rows > 0, 'lattice has positive cols/rows');
  eq(vg.pts.length, vg.cols * vg.rows, 'point count = cols × rows');
  // Edge anchors sit off-screen (negative top-left, past BASE_W/H bottom-right) so
  // no dangling node is visible at the play border.
  const first = vg.pts[0], last = vg.pts[vg.pts.length - 1];
  ok(first.ax < 0 && first.ay < 0, 'top-left anchor is off-screen (negative)');
  ok(last.ax >= 224 && last.ay >= 288, 'bottom-right anchor spans past the screen');
  // All displacements start at rest.
  ok(vg.pts.every(p => p.dx === 0 && p.dy === 0 && p.vx === 0 && p.vy === 0),
     'fresh lattice is fully at rest');

  // Pick a node and a ripple centered on its anchor's neighbor so it gets a kick,
  // plus a far node that must stay untouched (outside VGRID_RIPPLE_R).
  const near = vg.pts.find(p => p.ax >= 0 && p.ax < 224 && p.ay >= 0 && p.ay < 288);
  const nIdx = vg.pts.indexOf(near);
  // A node far from the ripple center (opposite corner) — well beyond radius 66.
  const far = vg.pts[vg.pts.length - 1];
  G.gridRipple(near.ax + 4, near.ay + 4, 6); // center just off the near node
  ok((Math.abs(near.vx) + Math.abs(near.vy)) > 0, 'ripple imparts velocity to a near node');
  ok(far.vx === 0 && far.vy === 0, 'ripple leaves far nodes (outside radius) untouched');

  // One physics tick moves the displaced node; many ticks settle it back toward rest
  // (spring + damping), and the MAXD clamp keeps a huge ripple bounded.
  G.updateVectorGrid();
  ok((Math.abs(near.dx) + Math.abs(near.dy)) > 0, 'tick converts velocity into displacement');
  for (let i = 0; i < 400; i++) G.updateVectorGrid();
  ok((Math.abs(near.dx) + Math.abs(near.dy)) < 0.5, 'node springs back toward rest over time');

  // MAXD clamp: a violent ripple cannot fling a node across the screen.
  G.buildVectorGrid();
  const vg2 = G.__getVgrid();
  const tgt = vg2.pts.find(p => p.ax >= 0 && p.ax < 224 && p.ay >= 0 && p.ay < 288);
  G.gridRipple(tgt.ax + 1, tgt.ay + 1, 9999);
  for (let i = 0; i < 5; i++) G.updateVectorGrid();
  ok(Math.abs(tgt.dx) <= 26 && Math.abs(tgt.dy) <= 26, 'displacement clamped to ±MAXD (26)');

  // Custom radius (dive wakes + dash shockwave use a tighter radius): a node ~40px
  // away is reached by the default 66 radius but NOT by a tight 26 radius.
  G.buildVectorGrid();
  const vgR = G.__getVgrid();
  const ctr = vgR.pts.find(p => p.ax >= 40 && p.ax < 80 && p.ay >= 40 && p.ay < 80);
  const midNode = ctr && vgR.pts.find(p => {
    const d = Math.hypot(p.ax - ctr.ax, p.ay - ctr.ay);
    return d > 30 && d < 60;
  });
  if (midNode) {
    G.gridRipple(ctr.ax, ctr.ay, 6, 26); // tight radius — midNode is outside it
    const tightHit = Math.abs(midNode.vx) + Math.abs(midNode.vy);
    G.gridRipple(ctr.ax, ctr.ay, 6);     // default radius — midNode is inside it
    const wideHit = Math.abs(midNode.vx) + Math.abs(midNode.vy);
    ok(tightHit === 0, 'tight-radius ripple spares a node beyond its radius');
    ok(wideHit > 0, 'default-radius ripple reaches the same node');
  }

  // Explosion-scan hook: each explosion ripples the grid exactly once (sets _rippled).
  const bg = G.__getGame && G.__getGame();
  if (bg) {
    G.buildVectorGrid();
    const before = G.__getVgrid().pts.find(p => p.ax >= 0 && p.ax < 224 && p.ay >= 0 && p.ay < 288);
    const savedExpl = bg.explosions;
    bg.explosions = [{ x: before.ax, y: before.ay, maxTime: 22 }];
    G.updateVectorGrid();
    ok(bg.explosions[0]._rippled === true, 'explosion-scan hook flags the explosion _rippled');

    // RIPPLE CAP — a bomb / boss-death pushes DOZENS of explosions in one frame. The
    // cap must stop them all energizing the screen-wide grid (bloom whiteout + cost
    // spike). Push 40 fresh explosions spread across the grid; after one tick, only a
    // few nodes should have nonzero velocity, but ALL 40 must be flagged _rippled.
    G.buildVectorGrid();
    const vgC = G.__getVgrid();
    const blast = [];
    for (let i = 0; i < 40; i++) blast.push({ x: 10 + (i * 5) % 200, y: 10 + (i * 7) % 260, maxTime: 22 });
    bg.explosions = blast;
    G.updateVectorGrid();
    ok(blast.every(e => e._rippled === true), 'cap still flags every explosion (no re-queue next frame)');
    const movedNodes = vgC.pts.filter(p => (Math.abs(p.vx) + Math.abs(p.vy)) > 0).length;
    // 3 ripples × radius 66 can touch at most a few dozen of the ~150 nodes — the whole
    // grid (every node) must NOT be energized. Assert well under half the lattice moved.
    ok(movedNodes > 0, 'capped ripples still disturb the grid (a few shoves land)');
    ok(movedNodes < vgC.pts.length * 0.5, 'ripple cap prevents whole-grid energize (< half nodes moved)');
    bg.explosions = savedExpl;
  }
} else { console.log('  (skipped — vector grid not exposed)'); }

// ============================================================
section('nextBloomPerfState — adaptive bloom valve (drop on low FPS, restore on high)');
if (typeof G.nextBloomPerfState === 'function') {
  // Healthy FPS: never drops, no streaks accumulate.
  let s = { off: false, low: 0, high: 0 };
  for (let i = 0; i < 20; i++) s = G.nextBloomPerfState(s.off, 60, s.low, s.high);
  ok(s.off === false, '60fps sustained → bloom stays ON');

  // Sustained low FPS (<30) for 5 samples → drops bloom.
  s = { off: false, low: 0, high: 0 };
  for (let i = 0; i < 4; i++) s = G.nextBloomPerfState(s.off, 22, s.low, s.high);
  ok(s.off === false, '4 low samples not yet enough to drop (hysteresis)');
  s = G.nextBloomPerfState(s.off, 22, s.low, s.high); // 5th
  ok(s.off === true, '5th sustained sub-30 sample → bloom auto-suspended');

  // A single low sample then recovery must NOT drop bloom (no transient-hitch trip).
  s = { off: false, low: 0, high: 0 };
  s = G.nextBloomPerfState(s.off, 18, s.low, s.high); // one bad frame
  s = G.nextBloomPerfState(s.off, 60, s.low, s.high); // recovered — resets low streak
  for (let i = 0; i < 4; i++) s = G.nextBloomPerfState(s.off, 22, s.low, s.high);
  ok(s.off === false, 'a transient hitch then recovery does not drop bloom');

  // Once off, sustained high FPS (>=52) for 8 samples restores it.
  s = { off: true, low: 0, high: 0 };
  for (let i = 0; i < 7; i++) s = G.nextBloomPerfState(s.off, 58, s.low, s.high);
  ok(s.off === true, '7 high samples not yet enough to restore (hysteresis)');
  s = G.nextBloomPerfState(s.off, 58, s.low, s.high); // 8th
  ok(s.off === false, '8th sustained high sample → bloom restored');

  // fps==0 (uninitialised / first frame) must not count as "low" and trip the valve.
  s = { off: false, low: 0, high: 0 };
  for (let i = 0; i < 10; i++) s = G.nextBloomPerfState(s.off, 0, s.low, s.high);
  ok(s.off === false, 'fps==0 sentinel never trips the valve');
} else { console.log('  (skipped — nextBloomPerfState not exposed)'); }

// (nextLensLiteState section retired — the mid-tier valve was removed with the
// filter-free downsampled bloom rewrite; the binary valve remains tested above.)


section('SPECTRAL LENS GRADE — post-process heat → chromatic split / vignette');
if (typeof G.bloomHeat === 'function') {
  // bloomHeat — combo ramps 0..1, last-life & boss phase2 floor it.
  ok(G.bloomHeat(0, false, false) === 0, 'no combo, no pressure → heat 0');
  ok(Math.abs(G.bloomHeat(18, false, false) - 1) < 1e-9, 'combo 18 → heat saturates at 1');
  ok(G.bloomHeat(9, false, false) > 0.49 && G.bloomHeat(9, false, false) < 0.51, 'combo 9 → ~0.5');
  ok(G.bloomHeat(100, false, false) === 1, 'combo over cap clamps to 1');
  ok(G.bloomHeat(0, true, false) >= 0.55, 'last-life floors heat to 0.55 even at 0 combo');
  ok(G.bloomHeat(0, false, true) >= 0.78, 'boss phase2 floors heat to 0.78');
  ok(G.bloomHeat(20, true, true) === 1, 'high combo + pressure still clamps to 1 (no overflow)');
  ok(G.bloomHeat(-5, false, false) === 0, 'negative combo guarded to 0');

  // (chromaSplitForHeat / chromaAlphaForHeat tests retired with the chromatic
  // ghosts — the 4th whiteout-report rewrite removed those layers.)
  // vignetteAlphaForHeat — deepens with heat; bright daylight biomes keep it faint.
  ok(G.vignetteAlphaForHeat(0, false) > 0.17, 'baseline vignette present even at calm');
  ok(G.vignetteAlphaForHeat(1, false) > G.vignetteAlphaForHeat(0, false), 'vignette deepens with heat');
  ok(G.vignetteAlphaForHeat(1, true) < G.vignetteAlphaForHeat(1, false) * 0.5, 'bright biome cuts vignette hard (stays bright)');
} else { console.log('  (skipped — bloomHeat not exposed)'); }

if (typeof G.biomeGrade === 'function' && typeof G.biomeForStage === 'function') {
  // Every biome the cycle can produce must map to a distinct, valid dark-rgb grade.
  const ids = ['planet','ruins','dawn','asteroid','desert','ice','gasGiant','corona','canyon','blackhole','nebula','starfield'];
  const seen = new Set();
  let allValid = true, allDark = true;
  for (const id of ids) {
    const g = G.biomeGrade(id);
    if (!Array.isArray(g) || g.length !== 3) { allValid = false; break; }
    if (g.some(c => c < 0 || c > 64)) allDark = false;       // grades are DARK (vignette darkens)
    seen.add(g.join(','));
  }
  ok(allValid, 'every biome grade is a valid [r,g,b] triple');
  ok(allDark, 'every biome grade stays dark (rides the shadow, never washes gameplay)');
  ok(seen.size === ids.length, 'all 12 biome grades are distinct (per-biome identity)');
  // Unknown / null biome → neutral indigo fallback, never undefined.
  const fb = G.biomeGrade(null);
  ok(Array.isArray(fb) && fb.length === 3, 'null biome → indigo fallback triple (no crash)');
  ok(G.biomeGrade('not-a-biome').join(',') === fb.join(','), 'unknown biome id → same fallback');
  // The cycle every biomeForStage can return must be covered (no orphan id).
  let covered = true;
  for (let st = 8; st <= 8 + 12 * 4; st += 4) {
    const id = G.biomeForStage(st);
    if (id && G.biomeGrade(id) === G.biomeGrade('not-a-biome') && !ids.includes(id)) covered = false;
  }
  ok(covered, 'every biomeForStage output has its own grade (registry wired both sides)');
} else { console.log('  (skipped — biomeGrade not exposed)'); }

section('BIOME SONIC IDENTITY — per-biome BGM key transpose');
if (typeof G.biomeBgmPitch === 'function' && typeof G.biomeForStage === 'function') {
  const ids = ['planet','ruins','dawn','asteroid','desert','ice','gasGiant','corona','canyon','blackhole','nebula','starfield'];
  // Null / unknown biome → no shift (ratio exactly 1.0).
  ok(G.biomeBgmPitch(null) === 1.0, 'null biome → ratio 1.0 (no transpose, e.g. stages < 8)');
  ok(G.biomeBgmPitch('not-a-biome') === 1.0, 'unknown biome → ratio 1.0');
  ok(G.biomeBgmPitch('planet') === 1.0, 'planet is the neutral home key (0 semitones)');
  // Every real biome maps to a sane ratio (2^(semi/12), within a ~±5 semitone band).
  let allSane = true;
  for (const id of ids) {
    const r = G.biomeBgmPitch(id);
    if (typeof r !== 'number' || r < 0.7 || r > 1.5) { allSane = false; break; }
  }
  ok(allSane, 'every biome ratio stays inside the ±5-semitone musical band (0.7..1.5)');
  // Ratio must equal 2^(semi/12) — anchor a couple of known offsets.
  ok(Math.abs(G.biomeBgmPitch('dawn')  - Math.pow(2,  2/12)) < 1e-9, 'dawn = +2 semitones (warm lift)');
  ok(Math.abs(G.biomeBgmPitch('gasGiant') - Math.pow(2, -5/12)) < 1e-9, 'gas giant = -5 semitones (deep storm)');
  ok(G.biomeBgmPitch('nebula') > 1 && G.biomeBgmPitch('blackhole') < 1, 'nebula lifts, black hole sinks (opposed moods)');
  // Coverage: every biome the cycle can produce has a transpose entry (no orphan id
  // silently falling back to 1.0). planet legitimately maps to 1.0, so exclude it.
  let wired = true;
  for (let st = 8; st <= 8 + 12 * 4; st += 4) {
    const id = G.biomeForStage(st);
    if (id && id !== 'planet' && G.biomeBgmPitch(id) === 1.0) wired = false;
  }
  ok(wired, 'every non-planet biomeForStage output has a real transpose (registry wired)');
} else { console.log('  (skipped — biomeBgmPitch not exposed)'); }

section('WING TACTICS — dive director (pure core + registry)');
if (typeof G.chooseDiveTactic === 'function') {
  // chooseDiveTactic — panic disables, stage gates, commander boosts, deterministic on roll.
  ok(G.chooseDiveTactic(20, true, true, 0.0) === null, 'panic → no coordinated tactic (shatters to lone dives)');
  ok(G.chooseDiveTactic(1, false, false, 0.0) === null, 'stage 1 below all minStages → null');
  ok(G.chooseDiveTactic(6, false, false, 0.0) !== null, 'stage 6 + roll 0 → a tactic (pincer available)');
  ok(G.chooseDiveTactic(6, false, false, 0.99) === null, 'high roll → lone dive (a tactic is the exception, not the rule)');
  ok(G.chooseDiveTactic(20, true, false, NaN) === null, 'NaN roll → null (no throw)');
  // commander alive widens the tactic window (isCommander fusion): some roll misses without, hits with.
  {
    let boosted = false;
    for (let r = 0; r < 1; r += 0.01) {
      if (G.chooseDiveTactic(10, false, false, r) === null && G.chooseDiveTactic(10, true, false, r) !== null) { boosted = true; break; }
    }
    ok(boosted, 'commander alive raises tactic frequency (kill it → coordination drops)');
  }
  // both tactics reachable by sweeping roll at a stage where both are available.
  {
    const seen = new Set();
    for (let r = 0; r < 1; r += 0.005) { const t = G.chooseDiveTactic(30, false, false, r); if (t) seen.add(t.id); }
    ok(seen.has('pincer') && seen.has('wall'), 'both pincer + wall are reachable (selection covers the set)');
  }
  // wall gated to a later stage than pincer.
  {
    const s6 = new Set(); for (let r = 0; r < 1; r += 0.005) { const t = G.chooseDiveTactic(6, false, false, r); if (t) s6.add(t.id); }
    ok(!s6.has('wall'), 'wall does not appear at stage 6 (minStage gate)');
  }
  // FAIRNESS CAP — p is clamped to 0.6, so even at absurd depth (uncapped p > 3 at stage
  // 200 + commander) a coordinated maneuver never becomes a coin-flip-or-worse. Load-
  // bearing: remove/raise the cap and the roll-0.61 assertion fails.
  ok(G.chooseDiveTactic(200, true, false, 0.59) !== null, 'deep stage: capped p still admits a tactic just below 0.6');
  ok(G.chooseDiveTactic(200, true, false, 0.61) === null, 'fairness cap: p clamped to 0.6 — roll 0.61 stays a lone dive even at uncapped p>3');

  // predictIntercept — lead math, clamp (fairness), NaN guard, zero-velocity identity.
  ok(G.predictIntercept(100, 2, 10, 16, 208) === 120, 'lead: 100 + 2*10 = 120 (in bounds)');
  ok(G.predictIntercept(100, 0, 40, 16, 208) === 100, 'zero velocity → current x (identity)');
  ok(G.predictIntercept(200, 5, 40, 16, 208) === 208, 'runaway prediction clamps to playfield max (can never aim off-screen)');
  ok(G.predictIntercept(20, -5, 40, 16, 208) === 16, 'leftward prediction clamps to playfield min');
  { const v = G.predictIntercept(NaN, 2, 10, 16, 208); ok(v >= 16 && v <= 208, 'NaN playerX → safe in-bounds value (no NaN out)'); }

  // planPincerPair — brackets targetX from both flanks; null if a side is empty.
  {
    const cs = [{x:20},{x:60},{x:140},{x:190}];
    const pair = G.planPincerPair(cs, 100);
    ok(pair && pair[0].x === 60 && pair[1].x === 140, 'pincer picks the nearest flanker on each side of the target');
    ok(G.planPincerPair([{x:20},{x:40}], 100) === null, 'all candidates on one side → null (falls back to a lone dive)');
  }
  // wingInterceptForPool — POOL-span clamp. The playfield-wide clamp let a moving player
  // push the prediction outside the formation span, so planPincerPair could never
  // bracket it and the maneuver silently aborted (PINCER was 100% suppressed vs a
  // dashing player). Span-clamping guarantees a bracket whenever the pool spans ≥ 2 columns.
  if (typeof G.wingInterceptForPool === 'function') {
    const pool = []; for (let c = 0; c < 10; c++) pool.push({ x: 32 + c * 16 }); // stage-like formation x=32..176
    // moving player (2.5 px/f): prediction 112+100=212 would clamp to 208 playfield-wide
    // (outside the span) — span clamp keeps it bracketable.
    const tMove = G.wingInterceptForPool(112, 2.5, pool);
    ok(G.planPincerPair(pool, tMove) !== null, 'moving player → pincer still commits (span-clamped target is bracketable)');
    // dashing player (6.5 px/f): prediction 112+260=372 — worst case, still bracketable.
    const tDash = G.wingInterceptForPool(112, 6.5, pool);
    ok(G.planPincerPair(pool, tDash) !== null, 'dashing player → pincer still commits');
    ok(tDash <= 175 && tDash >= 32, 'dash target clamped inside the pool span [poolMin, poolMax-1]');
    // leftward dash symmetric.
    const tLeft = G.wingInterceptForPool(112, -6.5, pool);
    ok(G.planPincerPair(pool, tLeft) !== null, 'leftward dash → pincer still commits');
    // single-column pool degenerates → target = the column → planPincerPair nulls (clean lone-dive fallback).
    const one = [{ x: 96 }, { x: 96 }];
    ok(G.planPincerPair(one, G.wingInterceptForPool(200, 6.5, one)) === null, 'single-column pool → null → lone-dive fallback');
    // empty pool guard — safe centre, no NaN/Infinity.
    const tEmpty = G.wingInterceptForPool(112, 2.5, []);
    ok(isFinite(tEmpty), 'empty pool → finite safe value (no Infinity out)');
  }
  // planWallRun — contiguous run of `size`, centre nearest target; null if too few.
  {
    const cs = [{x:10},{x:30},{x:50},{x:150},{x:170}];
    const run = G.planWallRun(cs, 40, 3);
    ok(run && run.length === 3 && run[0].x <= run[1].x && run[1].x <= run[2].x, 'wall run = 3 enemies sorted left→right');
    ok(G.planWallRun([{x:10},{x:20}], 15, 3) === null, 'fewer candidates than size → null');
  }

  // DIVE_TACTICS registry guard — minStage ascending, size≥2, every id wired in source.
  if (G.__getDiveTactics) {
    const reg = G.__getDiveTactics();
    ok(Array.isArray(reg) && reg.length >= 2, 'DIVE_TACTICS has ≥ 2 entries');
    let ascending = true, sized = true, launchWired = true;
    for (let i = 0; i < reg.length; i++) {
      if (i > 0 && reg[i].minStage < reg[i-1].minStage) ascending = false;
      if (!(reg[i].size >= 2)) sized = false;
      if (scriptSrc.indexOf("'" + reg[i].id + "'") < 0) launchWired = false;
    }
    ok(ascending, 'DIVE_TACTICS minStage is ascending');
    ok(sized, 'every tactic needs ≥ 2 enemies (it is a COORDINATED maneuver)');
    ok(launchWired, 'every tactic id is referenced in source (launch switch wired both sides)');
  }
} else { console.log('  (skipped — chooseDiveTactic not exposed)'); }

section('STORM FRONT — hazard weather strike (pure core + registry)');
if (typeof G.weatherIsHazard === 'function' && typeof G.strikePhase === 'function'
    && typeof G.weatherStrikeResolve === 'function') {
  // Registry both sides: every hazard id exists in WEATHER_TABLE, and its biome is
  // actually produced by biomeForStage (a hazard can't be dead data). The peaceful
  // set stays peaceful (deliberate hostile/peaceful split).
  const wt = G.__getWeatherTable && G.__getWeatherTable();
  if (wt) {
    const hazards = ['storm', 'solar', 'vortex', 'sandstorm', 'meteor'];
    let wired = true, reachable = true;
    const cycle = new Set();
    for (let st = 8; st <= 8 + 12 * 4; st += 4) { const b = G.biomeForStage(st); if (b) cycle.add(b); }
    for (const h of hazards) {
      if (!G.weatherIsHazard(h)) wired = false;
      if (!wt[h]) wired = false;
      else if (!cycle.has(wt[h].biome)) reachable = false;
    }
    ok(wired, 'all 5 hazard ids are flagged AND exist in WEATHER_TABLE');
    ok(reachable, 'every hazard weather maps to a biome the cycle actually produces');
    ok(!G.weatherIsHazard('blizzard') && !G.weatherIsHazard('rockslide')
       && !G.weatherIsHazard('aurora') && !G.weatherIsHazard('golden'),
       'peaceful weathers stay peaceful (blizzard/rockslide keep their old roles)');
    ok(!G.weatherIsHazard('not-a-weather'), 'unknown id is not a hazard');
  }

  // strikePhase — boundary exactness with defaults (tel 42, act 8).
  ok(G.strikePhase(0, 480) === 'idle', 't=0 → idle');
  ok(G.strikePhase(480 - 43, 480) === 'idle', 'one frame before the telegraph → idle');
  ok(G.strikePhase(480 - 42, 480) === 'telegraph', 'telegraph opens exactly TELEGRAPH frames early');
  ok(G.strikePhase(479, 480) === 'telegraph', 'last pre-impact frame → telegraph');
  ok(G.strikePhase(480, 480) === 'active', 'impact frame → active');
  ok(G.strikePhase(487, 480) === 'active', 'last lethal frame (act 8) → active');
  ok(G.strikePhase(488, 480) === 'idle', 'after the active window → idle (caller re-arms)');
  ok(G.strikePhase(-5, 480) === 'idle' && G.strikePhase(10, 0) === 'idle', 'bad inputs → idle (never a surprise strike)');
  // The fairness floor: the telegraph is LONGER than a boss dive's 30-frame preview.
  ok(G.strikePhase(480 - 36, 480) === 'telegraph', 'telegraph ≥ 36f (longer read than a lone dive)');

  // weatherStrikeResolve — the verb ladder.
  ok(G.weatherStrikeResolve(0, 10, true, false, 8) === 'parry', 'dash-through inside the column → STORM PARRY');
  ok(G.weatherStrikeResolve(0, 10, true, true, 8) === 'parry', 'dash beats i-frames in priority (parry credit)');
  ok(G.weatherStrikeResolve(5, 10, false, true, 8) === 'immune', 'i-frames inside → immune (no death, no credit)');
  ok(G.weatherStrikeResolve(-9, 10, false, false, 8) === 'hit', 'inside the column, no defense → hit (routes to the killPlayer ladder)');
  ok(G.weatherStrikeResolve(10, 10, false, false, 8) === 'hit', 'column edge inclusive');
  ok(G.weatherStrikeResolve(15, 10, false, false, 8) === 'graze', 'just outside → graze (near-miss vocabulary)');
  ok(G.weatherStrikeResolve(18, 10, false, false, 8) === 'graze', 'graze band edge inclusive');
  ok(G.weatherStrikeResolve(19, 10, false, false, 8) === 'safe', 'clear of the band → safe');
  ok(G.weatherStrikeResolve(NaN, 10, false, false, 8) === 'safe', 'NaN dx → safe (never a surprise kill)');
} else { console.log('  (skipped — STORM FRONT core not exposed)'); }

section('RIVAL ACE — nemesis duelist (pure core + registries)');
if (typeof G.rivalCallsignFor === 'function' && typeof G.rivalStatsForLevel === 'function'
    && typeof G.rivalShouldSpawn === 'function') {
  // rivalCallsignFor — the mirror callsign.
  eq(G.rivalCallsignFor('ACE'), 'ECA', 'callsign is reversed');
  eq(G.rivalCallsignFor('KWK'), 'KWX', 'palindrome → last letter swapped to X (twin never reads identical)');
  eq(G.rivalCallsignFor('AAA'), 'AAX', 'uniform palindrome → X suffix');
  eq(G.rivalCallsignFor(''), 'VPR', 'empty string → VPR fallback');
  eq(G.rivalCallsignFor(null), 'VPR', 'null → VPR fallback');
  eq(G.rivalCallsignFor('ABBA'), 'VPR', 'non-3-char → VPR fallback');

  // rivalStatsForLevel — monotonic escalation, clamped, capped.
  const s0 = G.rivalStatsForLevel(0), s2 = G.rivalStatsForLevel(2), s4 = G.rivalStatsForLevel(4);
  ok(s0.hp < s2.hp && s2.hp < s4.hp, 'hp ramps up with level');
  ok(s0.fireInterval > s2.fireInterval && s2.fireInterval >= s4.fireInterval, 'fire interval ramps down');
  ok(s4.fireInterval >= 28, 'fire interval floored at 28 (never machine-gun)');
  ok(s0.burst >= 2 && s4.burst > s0.burst, 'burst grows with level, min 2');
  ok(s4.dodge <= 0.7 && G.rivalStatsForLevel(99).dodge <= 0.7, 'dodge chance capped at 0.7 (pressure, not immunity)');
  ok(s0.dodge > 0 && s0.dodge < s4.dodge, 'dodge chance ramps up');
  ok(s0.bulletSpeed > 0 && s4.bulletSpeed < 2.5, 'bullet speed positive and bounded');
  eq(JSON.stringify(G.rivalStatsForLevel(-5)), JSON.stringify(s0), 'negative level clamps to 0');
  eq(JSON.stringify(G.rivalStatsForLevel(99)), JSON.stringify(s4), 'over-cap level clamps to RIVAL_MAX_LEVEL');
  ok(s0.duelFrames > 0, 'duel window is positive');

  // rivalShouldSpawn — the gate.
  eq(G.rivalShouldSpawn(5, 6, 'normal'), false, 'below first stage → no spawn');
  eq(G.rivalShouldSpawn(6, 6, 'normal'), true, 'first eligible normal stage → spawn');
  eq(G.rivalShouldSpawn(7, 10, 'normal'), false, 'scheduled encounter not reached → no spawn');
  eq(G.rivalShouldSpawn(12, 10, 'normal'), true, 'past the scheduled stage → spawn');
  eq(G.rivalShouldSpawn(12, 10, 'challenge'), false, 'challenge stage → never');
  eq(G.rivalShouldSpawn(20, 10, 'boss'), false, 'boss stage → never');
  eq(G.rivalShouldSpawn(8, null, 'normal'), true, 'null nextStage falls back to first-stage gate');

  // RIVAL_LINES registry guard — every situation the code speaks is present,
  // non-empty, and made of non-empty strings (a silent rival is a wiring bug).
  const RL = G.__getRivalLines && G.__getRivalLines();
  ok(!!RL, 'RIVAL_LINES registry exposed');
  if (RL) {
    const situations = ['intro', 'return', 'dodge', 'eject', 'retreat', 'mock', 'death'];
    eq(Object.keys(RL).sort().join(','), situations.slice().sort().join(','), 'RIVAL_LINES has exactly the 7 spoken situations');
    let allGood = true;
    for (const k of situations) {
      const arr = RL[k];
      if (!Array.isArray(arr) || arr.length < 2) allGood = false;
      else for (const line of arr) if (typeof line !== 'string' || !line.length) allGood = false;
    }
    ok(allGood, 'every situation has ≥2 non-empty string variants');
  }

  // Intercept wiring — the three rival comm beats exist with 3 variants each.
  const IM = G.__getInterceptMsg && G.__getInterceptMsg();
  if (IM) {
    let wired = true;
    for (const k of ['rivalSpotted', 'rivalRetreat', 'rivalDown']) {
      if (!Array.isArray(IM[k]) || IM[k].length !== 3 || IM[k].some(s => typeof s !== 'string' || !s.length)) wired = false;
    }
    ok(wired, 'rivalSpotted/rivalRetreat/rivalDown intercepts wired with 3 variants each');
  }
} else { console.log('  (skipped — RIVAL ACE core not exposed)'); }

section('SALVAGE PROTOCOL — death-economy shard planner (pure)');
if (typeof G.salvageShardPlan === 'function') {
  const plan = (lvl, mode) => G.salvageShardPlan(lvl, mode);
  // Base build (nothing invested) drops nothing — a softener, never a source.
  eq(plan({ S: 1, N: 1, P: 1 }, 'normal').length, 0, 'fresh 1/1/1 build → no shards');
  eq(plan({ S: 1, N: 1, P: 1 }, 'easy').length, 0, 'fresh build → no shards even on easy');
  // Difficulty shapes the economy: easy 3 / normal 2 / hard 1 (capped by loss).
  eq(plan({ S: 5, N: 3, P: 3 }, 'easy').length, 3, 'easy salvages up to 3 levels');
  eq(plan({ S: 5, N: 3, P: 3 }, 'normal').length, 2, 'normal salvages up to 2');
  eq(plan({ S: 5, N: 3, P: 3 }, 'hard').length, 1, 'hard salvages only 1');
  eq(plan({ S: 5, N: 3, P: 3 }, 'nonsense').length, 2, 'unknown mode falls back to normal cap');
  // Greedy prefers the deepest-invested axis; ties resolve S > N > P.
  eq(plan({ S: 5, N: 3, P: 3 }, 'normal').join(''), 'SS', 'deepest axis (S at 4 lost) drains first');
  eq(plan({ S: 2, N: 2, P: 2 }, 'normal').join(''), 'SN', 'all-tied losses resolve in S > N > P order');
  eq(plan({ S: 1, N: 1, P: 3 }, 'hard').join(''), 'P', 'only-invested axis is the one salvaged');
  eq(plan({ S: 1, N: 3, P: 2 }, 'easy').join(''), 'NNP', 'greedy tracks remaining loss as it drains');
  // Never exceeds what was actually lost.
  eq(plan({ S: 2, N: 1, P: 1 }, 'easy').join(''), 'S', 'cap 3 but only 1 level lost → 1 shard');
  // Robustness: null / partial level objects.
  eq(plan(null, 'normal').length, 0, 'null lvl → no shards (never throws)');
  eq(plan({ S: 3 }, 'normal').join(''), 'SS', 'missing axes treated as level 1');
  // Every emitted letter is a real power axis.
  ok(plan({ S: 5, N: 3, P: 3 }, 'easy').every(ax => ax === 'S' || ax === 'N' || ax === 'P'),
     'plan emits only S/N/P letters');
  // Intercept wiring for the one-shot comm beat.
  const IM2 = G.__getInterceptMsg && G.__getInterceptMsg();
  if (IM2) {
    ok(Array.isArray(IM2.salvageDrop) && IM2.salvageDrop.length === 3
       && IM2.salvageDrop.every(s => typeof s === 'string' && s.length),
       'salvageDrop intercept wired with 3 variants');
  }
} else { console.log('  (skipped — salvageShardPlan not exposed)'); }

section('DEATH ECHO — cross-run wreck persistence (fifth persistence path)');
if (typeof G.deathEchoValid === 'function' && typeof G.recordDeathEcho === 'function'
    && typeof G.loadDeathEcho === 'function') {
  const LS = sandbox.localStorage;
  const savedEcho = LS.getItem('galagaDeathEcho');
  // deathEchoValid — shape guard.
  ok(G.deathEchoValid({ stage: 12, x: 100, callsign: 'KWK', cause: 'bullet' }), 'well-formed record validates');
  ok(!G.deathEchoValid(null), 'null record rejected');
  ok(!G.deathEchoValid({ stage: 0, x: 100, callsign: 'KWK', cause: 'bullet' }), 'stage 0 rejected');
  ok(!G.deathEchoValid({ stage: 1.5, x: 100, callsign: 'KWK', cause: 'bullet' }), 'fractional stage rejected');
  ok(!G.deathEchoValid({ stage: 3, x: -1, callsign: 'KWK', cause: 'bullet' }), 'x below playfield rejected');
  ok(!G.deathEchoValid({ stage: 3, x: 500, callsign: 'KWK', cause: 'bullet' }), 'x beyond BASE_W rejected');
  ok(!G.deathEchoValid({ stage: 3, x: NaN, callsign: 'KWK', cause: 'bullet' }), 'NaN x rejected (no NaN wreck)');
  ok(!G.deathEchoValid({ stage: 3, x: 100, callsign: 'AB', cause: 'bullet' }), 'non-3-char callsign rejected');
  ok(!G.deathEchoValid({ stage: 3, x: 100, callsign: 'KWK', cause: '' }), 'empty cause rejected');

  // record → load round trip.
  ok(G.recordDeathEcho(12, 111.5, 'KWK', 'bullet'), 'record accepts a real death');
  const rt = G.loadDeathEcho();
  ok(!!rt && rt.stage === 12 && rt.x === 111.5 && rt.callsign === 'KWK' && rt.cause === 'bullet',
     'load returns exactly what was recorded');
  // Fallbacks: broken callsign/cause are repaired, x is clamped.
  ok(G.recordDeathEcho(3, 9999, null, null), 'record repairs null callsign/cause and clamps x');
  const rt2 = G.loadDeathEcho();
  ok(!!rt2 && rt2.callsign === 'ACE' && rt2.cause === 'unknown' && rt2.x <= 224,
     'repaired record: ACE callsign, unknown cause, clamped x');
  // Invalid stage never overwrites the stored echo.
  ok(!G.recordDeathEcho(0, 50, 'KWK', 'bullet'), 'stage 0 record refused');
  const rt3 = G.loadDeathEcho();
  ok(!!rt3 && rt3.stage === 3, 'refused record did not clobber the stored echo');
  // Corrupt storage is non-fatal (documented invariant, extended to path #5).
  LS.setItem('galagaDeathEcho', '{not json');
  ok(G.loadDeathEcho() === null, 'corrupt JSON → null, never throws');
  LS.setItem('galagaDeathEcho', JSON.stringify({ stage: 'x' }));
  ok(G.loadDeathEcho() === null, 'wrong-shaped JSON → null');
  LS.removeItem('galagaDeathEcho');
  ok(G.loadDeathEcho() === null, 'absent key → null');
  if (savedEcho === null) LS.removeItem('galagaDeathEcho'); else LS.setItem('galagaDeathEcho', savedEcho);

  // ECHO_LINES ↔ RESPAWN_WHISPERS — the wreck coaches in the SAME cause
  // vocabulary as the respawn whisper (cross-registry guard, both sides).
  const EL = G.__getEchoLines && G.__getEchoLines();
  const RW = G.__getRespawnWhispers && G.__getRespawnWhispers();
  ok(!!EL && !!RW, 'ECHO_LINES + RESPAWN_WHISPERS exposed');
  if (EL && RW) {
    eq(Object.keys(EL).sort().join(','), Object.keys(RW).sort().join(','),
       'echo causes exactly mirror the respawn-whisper causes');
    ok(Object.values(EL).every(s => typeof s === 'string' && s.length > 0),
       'every echo line is a non-empty string');
  }
  if (typeof G.deathEchoLine === 'function' && EL) {
    eq(G.deathEchoLine('bullet'), EL.bullet, 'known cause → its line');
    eq(G.deathEchoLine('not-a-cause'), EL.unknown, 'unknown cause → unknown fallback');
    eq(G.deathEchoLine(null), EL.unknown, 'null cause → unknown fallback');
  }
} else { console.log('  (skipped — DEATH ECHO helpers not exposed)'); }

section('THE MAGPIE — loot-raider target picker + stat curve (pure)');
if (typeof G.magpiePickTarget === 'function' && typeof G.magpieStatsForStage === 'function') {
  // magpiePickTarget — oldest eligible loot wins; ties go to the higher item.
  const pu = (age, y, type) => ({ _mAge: age, x: 100, y, type });
  eq(G.magpiePickTarget([], [], 120), null, 'no loot → no target');
  eq(G.magpiePickTarget([pu(60, 100, 'S')], [], 120), null, 'under-age loot is safe (player priority window)');
  const t1 = G.magpiePickTarget([pu(200, 100, 'S'), pu(150, 50, 'R')], [], 120);
  ok(!!t1 && t1.kind === 'powerup' && t1.obj.type === 'S', 'oldest item is stolen first');
  const t2 = G.magpiePickTarget([pu(200, 100, 'S'), pu(200, 40, 'R')], [], 120);
  ok(!!t2 && t2.obj.type === 'R', 'age tie → the higher (smaller y) item wins');
  const t3 = G.magpiePickTarget([pu(130, 200, 'T')], [{ _mAge: 250, x: 50, y: 90, axis: 'P' }], 120);
  ok(!!t3 && t3.kind === 'shard' && t3.obj.axis === 'P', 'salvage shards are stealable too — oldest across BOTH pools');
  eq(G.magpiePickTarget(null, null, 120), null, 'null pools → null (never throws)');
  const t4 = G.magpiePickTarget([{ x: 10, y: 10, type: 'W' }], [], 120);
  eq(t4, null, 'missing _mAge counts as age 0 (fresh drop is safe)');

  // magpieStatsForStage — a nuisance, not a duelist.
  const m1 = G.magpieStatsForStage(7), m25 = G.magpieStatsForStage(25), m99 = G.magpieStatsForStage(99);
  eq(m1.hp, 2, 'early magpie has 2 hp');
  eq(m25.hp, 3, 'deep-stage magpie has 3 hp');
  ok(m1.speed < m25.speed, 'speed ramps with stage');
  ok(m99.speed <= 1.8, 'speed capped at 1.8 (always catchable)');
  ok(m99.hp === 3, 'hp never exceeds 3');
  const mBad = G.magpieStatsForStage(NaN);
  ok(mBad.hp === 2 && mBad.speed > 0, 'bad stage input → sane floor stats');

  // Intercept wiring — the three raid beats.
  const IM3 = G.__getInterceptMsg && G.__getInterceptMsg();
  if (IM3) {
    let wired = true;
    for (const k of ['magpieSpotted', 'magpieEscape', 'magpieDown']) {
      if (!Array.isArray(IM3[k]) || IM3[k].length !== 3
          || IM3[k].some(s => typeof s !== 'string' || !s.length)) wired = false;
    }
    ok(wired, 'magpieSpotted/magpieEscape/magpieDown intercepts wired with 3 variants each');
  }
} else { console.log('  (skipped — MAGPIE helpers not exposed)'); }

section('PILOT LOG — run-history chronicle (sixth persistence path)');
if (typeof G.flightLogEntryValid === 'function' && typeof G.flightLogPush === 'function'
    && typeof G.loadFlightLog === 'function') {
  const mk = (over) => Object.assign(
    { d: '07-25', sc: 12345, st: 8, gr: 'B', ca: 'BULLET', cs: 'KWK', md: 'N' }, over || {});
  // Entry validator.
  ok(G.flightLogEntryValid(mk()), 'well-formed entry validates');
  ok(!G.flightLogEntryValid(null), 'null entry rejected');
  ok(!G.flightLogEntryValid(mk({ d: '' })), 'empty date rejected');
  ok(!G.flightLogEntryValid(mk({ sc: -5 })), 'negative score rejected');
  ok(!G.flightLogEntryValid(mk({ sc: NaN })), 'NaN score rejected');
  ok(!G.flightLogEntryValid(mk({ st: 0 })), 'stage 0 rejected');
  ok(!G.flightLogEntryValid(mk({ st: 2.5 })), 'fractional stage rejected');
  ok(!G.flightLogEntryValid(mk({ gr: '' })), 'empty grade rejected');
  ok(!G.flightLogEntryValid(mk({ ca: '' })), 'empty cause rejected');

  // flightLogPush — pure newest-first prepend with cap.
  const one = G.flightLogPush([], mk({ sc: 1 }));
  eq(one.length, 1, 'push onto empty log → 1 entry');
  const two = G.flightLogPush(one, mk({ sc: 2 }));
  ok(two.length === 2 && two[0].sc === 2 && two[1].sc === 1, 'newest entry is prepended (index 0)');
  let big = [];
  for (let i = 1; i <= 13; i++) big = G.flightLogPush(big, mk({ sc: i }));
  eq(big.length, 10, 'log caps at 10 entries');
  ok(big[0].sc === 13 && big[9].sc === 4, 'cap drops the OLDEST entries, keeps the newest 10');
  const kept = G.flightLogPush([mk({ sc: 7 })], mk({ st: 0 }));
  ok(kept.length === 1 && kept[0].sc === 7, 'malformed new entry is dropped, history intact');
  const cleaned = G.flightLogPush([mk({ sc: 7 }), { junk: true }, mk({ sc: 6 })], mk({ sc: 8 }));
  ok(cleaned.length === 3 && cleaned.every(G.flightLogEntryValid),
     'malformed STORED rows are swept on push');
  ok(G.flightLogPush('not-an-array', mk({ sc: 9 })).length === 1, 'non-array list treated as empty');
  eq(G.flightLogPush([], mk(), 3).length, 1, 'explicit cap parameter respected (shape)');

  // loadFlightLog — corrupt-storage-non-fatal contract (path #6).
  const LS2 = sandbox.localStorage;
  const savedLog = LS2.getItem('galagaFlightLog');
  LS2.setItem('galagaFlightLog', '{broken');
  eq(G.loadFlightLog().length, 0, 'corrupt JSON → empty log, never throws');
  LS2.setItem('galagaFlightLog', JSON.stringify({ a: 1 }));
  eq(G.loadFlightLog().length, 0, 'non-array JSON → empty log');
  LS2.setItem('galagaFlightLog', JSON.stringify([mk({ sc: 5 }), { bad: 1 }, mk({ sc: 4 })]));
  const mixed = G.loadFlightLog();
  ok(mixed.length === 2 && mixed.every(G.flightLogEntryValid), 'load filters malformed rows');
  LS2.removeItem('galagaFlightLog');
  eq(G.loadFlightLog().length, 0, 'absent key → empty log');
  if (savedLog === null) LS2.removeItem('galagaFlightLog'); else LS2.setItem('galagaFlightLog', savedLog);
} else { console.log('  (skipped — PILOT LOG helpers not exposed)'); }

section('BOSS ARCHETYPE LEITMOTIF — signature-voice registry + accessor');
if (typeof G.archetypeMotif === 'function' && G.__getArchetypeMotifs && G.__getArchetypeMotifs()) {
  const M = G.__getArchetypeMotifs();
  const CANON = ['standard', 'horned', 'tendril', 'crystal', 'phantom', 'rune'];
  eq(Object.keys(M).sort().join(','), CANON.slice().sort().join(','),
     'exactly the 6 canonical archetypes have motifs (matches archetypeFor cycle)');
  const OSC = new Set(['sine', 'square', 'sawtooth', 'triangle']);
  let wellFormed = true, audible = true, phraseLen = true;
  for (const k of CANON) {
    const m = M[k];
    if (!m || !OSC.has(m.type) || !(m.vol > 0 && m.vol <= 0.08)) wellFormed = false;
    if (!Array.isArray(m.notes) || m.notes.length < 4) wellFormed = false;
    let beats = 0, hasNote = false;
    for (const pair of m.notes) {
      if (!Array.isArray(pair) || pair.length !== 2
          || !isFinite(pair[0]) || pair[0] < 0
          || !(pair[1] > 0)) wellFormed = false;
      else { beats += pair[1]; if (pair[0] > 0) hasNote = true; }
    }
    if (!hasNote) audible = false;
    if (beats < 4) phraseLen = false;
  }
  ok(wellFormed, 'every motif: valid osc type, vol in (0, 0.08], ≥4 [freq,beats] pairs');
  ok(audible, 'every motif has at least one audible (freq>0) note');
  ok(phraseLen, 'every motif phrase spans ≥4 beats (a phrase, not a blip)');
  // Distinctness — six voices, six identities (pairwise different note data).
  const sigs = CANON.map(k => JSON.stringify(M[k].notes) + M[k].type);
  eq(new Set(sigs).size, CANON.length, 'all 6 motifs are pairwise distinct');
  // Accessor fallback contract mirrors tauntFor: unknown/null → standard.
  ok(G.archetypeMotif('rune') === M.rune, 'known archetype → its motif');
  ok(G.archetypeMotif('not-an-archetype') === M.standard, 'unknown archetype → standard fallback');
  ok(G.archetypeMotif(null) === M.standard, 'null archetype → standard fallback');

  // currentBossArchetype — live read off game.megaBosses (null-safe).
  if (typeof G.currentBossArchetype === 'function' && G.__getGame && G.__getGame()) {
    const g = G.__getGame();
    const saved = g.megaBosses;
    g.megaBosses = [];
    eq(G.currentBossArchetype(), null, 'no bosses → null (motif voice stays silent)');
    g.megaBosses = [{ alive: false, archetype: 'horned' }, { alive: true, archetype: 'rune' }];
    eq(G.currentBossArchetype(), 'rune', 'first ALIVE boss decides the motif');
    g.megaBosses = [{ alive: true }];
    eq(G.currentBossArchetype(), 'standard', 'alive boss without archetype → standard');
    g.megaBosses = saved;
  }
} else { console.log('  (skipped — ARCHETYPE_MOTIFS not exposed)'); }

section('THE DIRECTOR — concurrent special-actor budget (attention arbiter)');
if (typeof G.directorBudget === 'function' && typeof G.directorAdmit === 'function') {
  const admit = (cls, t, g, mode, tel) => G.directorAdmit(cls, { threat: t, gift: g }, mode, tel);
  // Budget scales with difficulty — same doctrine as drop/elite rates.
  eq(G.directorBudget('easy'), 1, 'easy allows 1 concurrent special actor');
  eq(G.directorBudget('normal'), 2, 'normal allows 2');
  eq(G.directorBudget('hard'), 3, 'hard allows 3');
  eq(G.directorBudget('nonsense'), 2, 'unknown mode falls back to normal');
  eq(G.directorBudget(undefined), 2, 'undefined mode falls back to normal');
  ok(G.directorBudget('easy') < G.directorBudget('normal')
     && G.directorBudget('normal') < G.directorBudget('hard'),
     'budget is strictly increasing with difficulty');

  // Empty stage admits anything.
  ok(admit('threat', 0, 0, 'normal', false), 'empty stage admits a threat');
  ok(admit('gift',   0, 0, 'normal', false), 'empty stage admits a gift');

  // THE core rule: never two simultaneous reactive demands.
  ok(!admit('threat', 1, 0, 'normal', false), 'a live threat blocks a second threat');
  ok(!admit('threat', 1, 0, 'hard', false), 'threat sub-cap holds even on hard (budget 3)');
  ok(admit('gift', 1, 0, 'normal', false), 'a gift may join a single live threat');

  // Total cap.
  ok(!admit('gift', 1, 1, 'normal', false), 'normal cap 2 reached → gift denied');
  ok(admit('gift', 1, 1, 'hard', false), 'hard cap 3 leaves room for a third actor');
  ok(!admit('gift', 0, 1, 'easy', false), 'easy cap 1 → one actor at a time, period');
  ok(!admit('threat', 0, 1, 'easy', false), 'easy: a live gift blocks a threat too');

  // The sacred window — nothing spawns during a strike telegraph.
  ok(!admit('threat', 0, 0, 'hard', true), 'strike telegraph blocks threats on an empty hard stage');
  ok(!admit('gift', 0, 0, 'easy', true), 'strike telegraph blocks gifts too');
  ok(!admit('gift', 0, 0, 'hard', true), 'the telegraph veto overrides all remaining budget');

  // Robustness — a malformed census must never open the floodgates.
  ok(G.directorAdmit('threat', null, 'normal', false), 'null census treated as empty stage');
  ok(!G.directorAdmit('threat', { threat: 99 }, 'normal', false), 'partial census still enforces the threat cap');
  ok(!G.directorAdmit('gift', { threat: -5, gift: 9 }, 'normal', false),
     'negative counts are floored (cannot buy extra budget)');

  // Live census — reads the real actor slots, excludes a retreating rival.
  if (typeof G.directorCensus === 'function' && G.__getGame && G.__getGame()) {
    const g = G.__getGame();
    const sv = { r: g.rival, m: g.magpie, s: g.supplyCrate, gu: g.guardian, de: g.deathEcho, w: g.stageWeather };
    g.rival = null; g.magpie = null; g.supplyCrate = null; g.guardian = null; g.deathEcho = null; g.stageWeather = null;
    let c = G.directorCensus();
    ok(c.threat === 0 && c.gift === 0, 'clear stage → empty census');
    g.rival = { phase: 'duel' };
    ok(G.directorCensus().threat === 1, 'a dueling rival counts as a threat');
    g.rival = { phase: 'retreat' };
    ok(G.directorCensus().threat === 0, 'a RETREATING rival is leaving — not counted');
    g.rival = null;
    g.guardian = {}; g.supplyCrate = {};
    c = G.directorCensus();
    ok(c.gift === 2 && c.threat === 0, 'guardian + crate count as two gifts');
    g.rival = sv.r; g.magpie = sv.m; g.supplyCrate = sv.s;
    g.guardian = sv.gu; g.deathEcho = sv.de; g.stageWeather = sv.w;
  }
} else { console.log('  (skipped — DIRECTOR not exposed)'); }

section('LEGIBILITY FLOOR — WCAG contrast contract for de-emphasized chrome text');
if (G.__getCol && G.__getCol()) {
  // Relative luminance + contrast ratio per WCAG 2.1. The game's void is pure
  // black, so measuring against #000 is the true worst case for chrome text.
  const _lum = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const v = [0, 2, 4].map(i => {
      const c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const _ratio = (fg, bg) => {
    const a = _lum(fg), b = _lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  // Sanity-check the metric itself before trusting it on the palette.
  ok(Math.abs(_ratio('#fff', '#000') - 21) < 0.01, 'contrast metric: white on black = 21:1');
  ok(Math.abs(_ratio('#000', '#000') - 1) < 0.001, 'contrast metric: black on black = 1:1');

  const COL = G.__getCol();
  ok(typeof COL.label === 'string' && typeof COL.faint === 'string',
     'COL exposes the two legibility-floor tokens (label / faint)');
  ok(_ratio(COL.faint, '#000') >= 4.5,
     'COL.faint — the dimmest allowed informational text — clears WCAG 4.5:1 on the void');
  ok(_ratio(COL.label, '#000') >= 4.5,
     'COL.label clears WCAG 4.5:1 on the void');
  ok(_ratio(COL.label, '#000') > _ratio(COL.faint, '#000'),
     'label is brighter than faint (the de-emphasis hierarchy survives the floor)');
  ok(_ratio(COL.gray, '#000') >= 4.5, 'COL.gray (the workhorse chrome gray) also clears 4.5:1');
  // The bright semantic colors carry gameplay meaning on the dark void — they
  // must stay readable too, or colorblind shape-redundancy is doing all the work.
  for (const key of ['white', 'cyan', 'yellow', 'green', 'magenta', 'orange', 'pink']) {
    ok(_ratio(COL[key], '#000') >= 4.5, 'COL.' + key + ' clears 4.5:1 on the void');
  }
} else { console.log('  (skipped — COL not exposed)'); }

// ============================================================
// STATEFUL ACTOR LIFECYCLES
// Every test above this point exercises PURE helpers. The six recent actor
// systems are phase machines, and a phase machine is where the real bugs live:
// a slot that never clears, cargo that vanishes on death, an actor that walks
// off the playfield. These drive each machine through its whole life against
// the live `game` object and assert the invariants that matter to a player.
// ============================================================
const ST = G.__getState && G.__getState();
function freshStage(g, over) {
  // A clean, quiet stage-6 playfield: no other actor, no weather, formation in.
  g.state = ST.PLAYING;
  g.playerAlive = true; g.allEntered = true;
  g.stage = 6; g.stageFrames = 400; g.stageEndGraceTimer = 0;
  g.playerX = 112; g.playerY = 250; g.playerVX = 0;
  g.animFrame = 0; g.runFrames = 1000;
  g.bullets = []; g.enemyBullets = []; g.megaBosses = [];
  g.powerUps = []; g.salvageShards = []; g.explosions = [];
  g.floatTexts = []; g.itemBursts = []; g.shockwaves = []; g.hitSparks = [];
  g.rival = null; g.magpie = null; g.guardian = null;
  g.supplyCrate = null; g.deathEcho = null; g.stageWeather = null;
  g.interceptQueue = []; g._interceptLastT = {};
  g.combo = 0; g.score = 0;
  Object.assign(g, over || {});
  return g;
}

section('DIFFICULTY CURVE — shape guard across stages 1..100 (no plateau/wall/inversion)');
if (typeof G.deepPressure === 'function' && typeof G.ghostRateForStage === 'function'
    && typeof G.extraDiverChance === 'function' && typeof G.cappedStageSpeed === 'function') {
  // --- the deep ladder itself ---
  eq(G.deepPressure(1), 0, 'no deep pressure in the early game');
  eq(G.deepPressure(32), 0, 'deep pressure opens strictly AFTER the legacy saturation point');
  ok(G.deepPressure(33) > 0, 'stage 33 is the first stage with deep pressure');
  ok(G.deepPressure(56) > G.deepPressure(40), 'deep pressure is monotonic');
  eq(G.deepPressure(80), 1, 'it tops out at stage 80');
  eq(G.deepPressure(500), 1, 'and is clamped beyond it (never runs away)');
  eq(G.deepPressure(-10), 0, 'negative stage → 0 (never negative pressure)');

  eq(G.ghostRateForStage(59), 0, 'no ghosts before stage 60');
  ok(Math.abs(G.ghostRateForStage(60) - 0.03) < 1e-9, 'ghosts open at the historical 3%');
  ok(G.ghostRateForStage(100) > G.ghostRateForStage(60), 'ghost density thickens with depth');
  ok(G.ghostRateForStage(1000) <= 0.08, 'ghost rate is hard-capped at 8%');

  eq(G.extraDiverChance(20), 0, 'no extra divers before the deep ladder');
  ok(G.extraDiverChance(100) <= 0.6, 'extra-diver chance is capped (never a mass dive)');
  ok(G.extraDiverChance(80) > G.extraDiverChance(50), 'extra-diver chance ramps with depth');

  // --- FAIRNESS CAPS MUST NOT MOVE ---
  // The deep ladder escalates density/composition ONLY. If a future tuning pass
  // ever raises the speed or cadence caps, bullets stop being readable and dives
  // stop being dodgeable — the game gets unfair, not harder. Lock them here.
  const spd = s => G.cappedStageSpeed(3.4, 2.0, 0.045, s, 1);
  const fire = s => G.rampedFireInterval(14, 42, 1.0, s, 1);
  const dive = s => G.rampedInterval(80, 200, 10, s);
  ok(Math.abs(spd(100) - spd(40)) < 1e-9, 'bullet speed stays capped through the deep game');
  eq(fire(100), fire(40), 'enemy fire cadence stays floored through the deep game');
  eq(dive(100), dive(40), 'dive trigger cadence stays floored through the deep game');
  ok(spd(100) <= 3.4 && fire(100) >= 14 && dive(100) >= 80, 'the three fairness caps hold');

  // --- composite curve shape over the whole advertised range ---
  // Modelled from the REAL call-site parameters. Guards the three failure modes
  // that kill an arcade curve. The 69-stage plateau this suite now forbids is
  // exactly the defect the deep ladder was written to fix.
  const pressure = s => (60 / fire(s)) * spd(s)
    * (1 + (60 / dive(s)) * (1 + G.extraDiverChance(s)))
    * (1 + G.eliteRateForStage(s, 'normal'))
    * (1 + G.ghostRateForStage(s));
  const p = []; for (let s = 1; s <= 100; s++) p.push(pressure(s));
  let inversions = 0, walls = 0, longestFlat = 0, flat = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p[i] - p[i - 1];
    if (d < -1e-9) inversions++;
    if (p[i - 1] > 0 && d / p[i - 1] > 0.12) walls++;
    if (Math.abs(d) < 1e-9) { flat++; longestFlat = Math.max(longestFlat, flat); } else flat = 0;
  }
  eq(inversions, 0, 'no INVERSION: no stage is ever easier than the one before it');
  eq(walls, 0, 'no WALL: no single stage jumps more than 12% in pressure');
  ok(longestFlat < 10, 'no PLATEAU: never 10+ consecutive stages with zero change (was 69)');
  ok(p[99] > p[31] * 1.2, 'stage 100 is materially harder than stage 32 (the promise is kept)');
  ok(p[99] > p[49] && p[49] > p[31], 'pressure keeps climbing across the whole deep game');
} else { console.log('  (skipped — deep pressure ladder not exposed)'); }

section('CHALLENGE TRACK — opportunity curve (a reward round must not pay less with depth)');
if (typeof G.challengeSpeedForStage === 'function' && typeof G.challengeGroupSize === 'function') {
  const SPAN = 224 + 30;            // off-screen entry to off-screen exit
  const dwell = s => SPAN / G.challengeSpeedForStage(s);        // frames on screen
  const total = s => G.challengeGroupSize(s) * 2 * 8;           // 2 sub-groups x 8 waves
  // OPPORTUNITY = how much shootable enemy-time the round actually offers.
  const opp = s => total(s) * dwell(s);

  // --- speed: capped, but early stages untouched ---
  ok(Math.abs(G.challengeSpeedForStage(4) - 1.70) < 1e-9, 'stage 4 keeps its original speed');
  ok(Math.abs(G.challengeSpeedForStage(32) - 3.10) < 1e-9, 'stage 32 keeps its original speed');
  ok(G.challengeSpeedForStage(96) <= 4.0 + 1e-9, 'deep speed is capped (was 6.30 and climbing)');
  eq(G.challengeSpeedForStage(1000), G.challengeSpeedForStage(96), 'the cap holds at any stage');
  ok(G.challengeSpeedForStage(48) > G.challengeSpeedForStage(16), 'speed still ramps below the cap');
  ok(dwell(96) / 60 >= 1.0, 'every enemy stays on screen at least a second (was 0.67s)');
  ok(dwell(96) / 6 >= 10, 'at least 10 landable shots per pass at 6f fire cooldown (was 6.7)');

  // --- count: keeps growing where speed can no longer ---
  eq(G.challengeGroupSize(4), 8, 'the early group size is unchanged');
  eq(G.challengeGroupSize(24), 9, 'the stage-20 bump is unchanged');
  ok(G.challengeGroupSize(96) > G.challengeGroupSize(44),
     'deep waves add TARGETS where they can no longer add speed');
  eq(G.challengeGroupSize(1000), G.challengeGroupSize(80), 'target count is capped too');

  // --- the inversion is gone ---
  // Before: opportunity at the deepest challenge stage was 34% of the first —
  // most of the wave escaped, perfect clears were unreachable, and the bonus
  // shrank the further you got. A reward round is allowed to get harder; it is
  // not allowed to collapse.
  ok(opp(96) / opp(4) > 0.55,
     'the deepest challenge round still offers >55% of the opening round (was 34%)');
  ok(opp(96) > opp(4) * 0.55 && opp(96) < opp(4),
     'it is harder than the opening round, but has not collapsed');
  // Past the speed cap only the count moves, so opportunity must never fall.
  let falls = 0;
  for (let s = 52; s <= 100; s++) {
    if (G.stageModeFor(s) !== 'challenge') continue;
    const prev = [...Array(s - 52).keys()].map(i => i + 52)
      .filter(x => G.stageModeFor(x) === 'challenge').pop();
    if (prev && opp(s) < opp(prev) - 1e-9) falls++;
  }
  eq(falls, 0, 'past the speed cap the round never gets stingier than the one before it');
} else { console.log('  (skipped — challenge track helpers not exposed)'); }

section('BOSS TRACK — speed ceiling + density ramp (the other difficulty track)');
if (typeof G.clampBossVx === 'function' && typeof G.bossSpreadForStage === 'function'
    && typeof G.makeMegaBoss === 'function') {
  const PLAYER_SPEED = 2.5, ARENA = 224 - 40;
  // --- clampBossVx: a symmetric magnitude clamp that preserves direction ---
  eq(G.clampBossVx(3, 5), 3, 'a speed under the cap is untouched');
  eq(G.clampBossVx(50, 5), 5, 'over the cap clamps down');
  eq(G.clampBossVx(-50, 5), -5, 'and clamps symmetrically for a left-moving boss');
  eq(G.clampBossVx(-3, 5), -3, 'direction is preserved');
  eq(G.clampBossVx(NaN, 5), 0, 'NaN → 0 (a boss can never inherit a NaN position)');
  ok(Math.abs(G.clampBossVx(999)) <= 9.0, 'the default cap is the absolute ceiling');

  // --- the runaway is gone ---
  // Base speed used to be 1.7 + stage*0.10 with NO cap: 11.7 px/frame at stage
  // 100, then x1.5 (phase 2) and x1.2 (phase 3) on top = 21.1 = 8.4x the player.
  const bossAt = s => G.makeMegaBoss(s, { super: true, hpScale: 2.5, vx: 1.7 + s * 0.10 });
  const enraged = s => {
    const b = bossAt(s);
    return Math.abs(G.clampBossVx(G.clampBossVx(b.vx * 1.5) * 1.2));
  };
  ok(bossAt(100).vx <= 5.0 + 1e-9, 'base boss speed is capped (was 11.7 at stage 100)');
  ok(enraged(100) <= 9.0 + 1e-9, 'a fully enraged deep boss is capped (was 21.1)');
  ok(enraged(100) / PLAYER_SPEED <= 3.7,
     'even enraged, a boss never exceeds ~3.6x the player speed (was 8.4x)');
  ok(ARENA / enraged(100) >= 20,
     'it always takes 20+ frames to cross the arena — long enough to read and dodge');
  eq(enraged(1000), enraged(100), 'the ceiling holds at any stage (no runaway ever)');
  // Stage 30 — the first SUPER boss — must NOT have been nerfed by the cap.
  ok(bossAt(30).vx > 4.6, 'the stage-30 boss keeps its original speed (cap set above it)');
  ok(enraged(40) >= enraged(30), 'deeper bosses are still faster, just bounded');

  // --- density replaces the speed that was removed ---
  eq(G.bossSpreadForStage(30), 7, 'the first SUPER boss keeps the historical 7-shot volley');
  ok(G.bossSpreadForStage(80) > G.bossSpreadForStage(30), 'deep bosses fire a wider volley');
  eq(G.bossSpreadForStage(80), 9, 'the volley tops out at 9');
  eq(G.bossSpreadForStage(1000), 9, 'and is capped there (no runaway bullet count)');
  ok(bossAt(80).spreadCount > bossAt(30).spreadCount, 'the ramp reaches the real boss object');
  // Non-super bosses are untouched by the deep ladder.
  eq(G.makeMegaBoss(12).spreadCount, 5, 'a normal boss still fires 5 (deep ladder is SUPER-only)');

  // --- the deep boss fight is no longer pure bullet sponge ---
  // HP still grows (fights get longer) but something about the FIGHT now changes
  // too, which was the defect: 30..100 were eight identical encounters.
  const shape = s => bossAt(s).spreadCount;
  ok(shape(100) > shape(30), 'the deep boss fight differs in kind, not only in length');
} else { console.log('  (skipped — boss track helpers not exposed)'); }

section('RIVAL ACE — full duel lifecycle (phase machine, not just the helpers)');
if (ST && typeof G.updateRivalAce === 'function' && G.__getGame && G.__getGame()) {
  const g = freshStage(G.__getGame(), {
    rivalNextStage: 6, rivalLevel: 0, rivalEncounters: 0,
    rivalDefeats: 0, rivalEjected: false
  });
  const BW = 224;

  G.updateRivalAce();
  ok(!!g.rival, 'rival spawns on an eligible, uncontested stage');
  eq(g.rival && g.rival.phase, 'warning', 'it opens on the telegraph phase, never mid-playfield');
  ok(!!g.rival && g.rival.hp > 0 && g.rival.hp === g.rival.maxHp, 'spawns at full HP');
  eq(g.rivalEncounters, 1, 'the encounter is counted');

  // Drive warning -> enter -> duel, checking it never leaves the playfield.
  let escaped = false, reachedDuel = false;
  for (let i = 0; i < 400 && g.rival; i++) {
    g.animFrame++;
    G.updateRivalAce();
    if (!g.rival) break;
    if (g.rival.phase === 'duel') reachedDuel = true;
    if (reachedDuel && (g.rival.x < 0 || g.rival.x > BW)) escaped = true;
  }
  ok(reachedDuel, 'the rival reaches the duel phase under normal conditions');
  ok(!escaped, 'it stays inside the playfield for the whole duel (x clamped)');

  // Duel timeout must ALWAYS end the encounter — a stuck actor would occupy
  // THE DIRECTOR's threat slot forever and silently suppress every later spawn.
  freshStage(g, { rivalNextStage: 999, rivalLevel: 0, rivalEjected: false });
  g.rival = { phase: 'duel', x: 112, y: 56, vy: 0, level: 0, hp: 99, maxHp: 99,
              fireCd: 999, burstLeft: 0, burstGap: 0, dodgeCd: 99, dodgeTimer: 0,
              dodgeDir: 0, duelTimer: 3, mockTimer: 0, flash: 0, tauntText: null,
              tauntLife: 0, tauntMax: 80, tauntCd: 0, callsign: 'XXX', after: [] };
  for (let i = 0; i < 600 && g.rival; i++) { g.animFrame++; G.updateRivalAce(); }
  ok(!g.rival, 'duel timeout always retires the rival (the threat slot is released)');
  ok(g.rivalLevel > 0, 'disengaging escalates it for the next encounter');

  // First HP depletion = EJECT (survives, escapes). Second = confirmed kill.
  freshStage(g, { rivalNextStage: 999, rivalEjected: false, rivalDefeats: 0 });
  g.rival = { phase: 'duel', x: 112, y: 56, vy: 0, level: 0, hp: 1, maxHp: 20,
              fireCd: 999, burstLeft: 0, burstGap: 0, dodgeCd: 99, dodgeTimer: 0,
              dodgeDir: 0, duelTimer: 900, mockTimer: 0, flash: 0, tauntText: null,
              tauntLife: 0, tauntMax: 80, tauntCd: 0, callsign: 'XXX', after: [] };
  g.bullets = [{ x: 112, y: 56, vy: -4, dmg: 5, lvl: 1 }];
  G.updateRivalAce();
  ok(g.rivalEjected, 'first depletion ejects the pilot rather than killing them');
  eq(g.rivalDefeats, 0, 'an ejection is NOT scored as a defeat');
  ok(g.rival && g.rival.phase === 'retreat', 'the ejecting rival leaves under its own power');

  const scoreBefore = g.score;
  freshStage(g, { rivalNextStage: 999, rivalEjected: true, rivalDefeats: 0, score: scoreBefore });
  g.stats = g.stats || {}; g.stats.kills = g.stats.kills || 0;
  g.killsByTypeRun = {}; g.stageKills = 0;
  const killsBefore = g.stats.kills, stageKillsBefore = g.stageKills;
  g.rival = { phase: 'duel', x: 112, y: 56, vy: 0, level: 0, hp: 1, maxHp: 20,
              fireCd: 999, burstLeft: 0, burstGap: 0, dodgeCd: 99, dodgeTimer: 0,
              dodgeDir: 0, duelTimer: 900, mockTimer: 0, flash: 0, tauntText: null,
              tauntLife: 0, tauntMax: 80, tauntCd: 0, callsign: 'XXX', after: [] };
  g.bullets = [{ x: 112, y: 56, vy: -4, dmg: 5, lvl: 1 }];
  G.updateRivalAce();
  eq(g.rivalDefeats, 1, 'a post-ejection depletion IS a confirmed kill');
  ok(!g.rival, 'the killed rival clears its slot immediately');
  ok(g.score > scoreBefore, 'the kill pays out');
  ok(g.powerUps.length === 1, 'the kill drops exactly one trophy power-up');
  // A destroyed hostile must count as a kill everywhere, or stats.kills silently
  // disagrees with the kills-by-type tally and the pilot rank under-reports.
  // Asserted behaviourally (drive the real kill) rather than by grepping source.
  eq((g.killsByTypeRun || {}).rival, 1, 'the kill lands in the kills-by-type tally');
  eq(g.stats.kills, killsBefore + 1, 'and in the run kill counter');
  eq(g.stageKills, stageKillsBefore + 1, 'and in the stage kill counter');

  // Intangibility must actually protect: a dodging rival cannot be hit.
  freshStage(g, { rivalNextStage: 999 });
  g.rival = { phase: 'duel', x: 112, y: 56, vy: 0, level: 0, hp: 10, maxHp: 10,
              fireCd: 999, burstLeft: 0, burstGap: 0, dodgeCd: 99, dodgeTimer: 5,
              dodgeDir: 1, duelTimer: 900, mockTimer: 0, flash: 0, tauntText: null,
              tauntLife: 0, tauntMax: 80, tauntCd: 0, callsign: 'XXX', after: [] };
  g.bullets = [{ x: 112, y: 56, vy: -4, dmg: 1, lvl: 1 }];
  G.updateRivalAce();
  eq(g.rival && g.rival.hp, 10, 'a mid-dodge rival is intangible (the dodge is real, not cosmetic)');
  eq(g.bullets.length, 1, 'and the shot passes through rather than being consumed');
} else { console.log('  (skipped — rival lifecycle not drivable)'); }

section('THE MAGPIE — raid lifecycle (grab, flee, and cargo recovery on kill)');
if (ST && typeof G.updateMagpie === 'function' && G.__getGame && G.__getGame()) {
  const g = freshStage(G.__getGame(), { magpieCd: 0 });
  // Seed one aged, stealable pickup and hand the magpie that exact target.
  const loot = { x: 60, y: 120, vy: 0.6, type: 'R', _mAge: 999 };
  g.powerUps = [loot];
  g.stats = g.stats || {}; g.stats.kills = 0;
  g.killsByTypeRun = {}; g.stageKills = 0;
  g.magpie = { phase: 'seek', target: { kind: 'powerup', obj: loot },
               x: 60, y: 100, hp: 2, maxHp: 2, speed: 1.5,
               carry: null, flash: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 120 && g.magpie && !g.magpie.carry; i++) { g.animFrame++; G.updateMagpie(); }
  ok(g.magpie && g.magpie.carry, 'the magpie reaches and grabs its target');
  eq(g.powerUps.length, 0, 'the stolen pickup leaves the field (the loss is real)');
  eq(g.magpie && g.magpie.phase, 'flee', 'it runs the moment it has the cargo');

  // Shooting the thief must return the exact cargo it took.
  if (g.magpie) { g.magpie.x = 112; g.magpie.y = 100; g.magpie.hp = 1; }
  g.bullets = [{ x: 112, y: 100, vy: -4, dmg: 5, lvl: 1 }];
  const sBefore = g.score;
  G.updateMagpie();
  ok(!g.magpie, 'the killed magpie clears its slot');
  eq((g.killsByTypeRun || {}).magpie, 1, 'the thief counts in the kills-by-type tally');
  ok(g.stats.kills > 0, 'and in the run kill counter');
  ok((g.stageKills || 0) > 0, 'and in the stage kill counter');
  eq(g.powerUps.length, 1, 'the cargo is returned to the field');
  eq(g.powerUps[0] && g.powerUps[0].type, 'R', 'and it is the SAME pickup type that was stolen');
  ok(g.score > sBefore, 'downing the thief pays out');
  ok(g.magpieCd > 0, 'a cooldown is armed so raids cannot chain');

  // A thief that escapes must not leak its slot.
  freshStage(g, { magpieCd: 0 });
  g.magpie = { phase: 'flee', target: null, x: 60, y: 20, hp: 2, maxHp: 2,
               speed: 1.5, carry: { kind: 'powerup', type: 'T' }, flash: 0, vx: 0, vy: 0.5 };
  for (let i = 0; i < 200 && g.magpie; i++) { g.animFrame++; G.updateMagpie(); }
  ok(!g.magpie, 'an escaping magpie clears its slot (no leaked threat budget)');

  // Target stolen by the player mid-approach → flee empty-handed, never crash.
  freshStage(g, { magpieCd: 0 });
  const ghostLoot = { x: 60, y: 120, vy: 0.6, type: 'W', _mAge: 999 };
  g.powerUps = [];  // player already collected it
  g.magpie = { phase: 'seek', target: { kind: 'powerup', obj: ghostLoot },
               x: 60, y: 100, hp: 2, maxHp: 2, speed: 1.5,
               carry: null, flash: 0, vx: 0, vy: 0 };
  G.updateMagpie();
  ok(g.magpie && g.magpie.phase === 'flee' && !g.magpie.carry,
     'a target collected first sends the thief home empty-handed');
} else { console.log('  (skipped — magpie lifecycle not drivable)'); }

section('DEATH ECHO / SALVAGE — pickup lifecycles (the two taught systems)');
if (ST && typeof G.updateDeathEcho === 'function' && G.__getGame && G.__getGame()) {
  const g = freshStage(G.__getGame(), { shieldCharges: 0 });
  g.deathEchoDone = true; // suppress re-spawn; we are testing the live echo
  g.deathEcho = { x: 112, y: 250, vy: 0.3, callsign: 'KWK', cause: 'bullet', fade: 0 };
  G.updateDeathEcho();
  eq(g.shieldCharges, 1, 'communing with your wreck arms one shield charge');
  ok(g.deathEcho && g.deathEcho.fade > 0, 'the wreck begins fading once answered');
  const chargesAfter = g.shieldCharges;
  G.updateDeathEcho();
  eq(g.shieldCharges, chargesAfter, 'it cannot be farmed — a fading wreck grants nothing more');
  for (let i = 0; i < 120 && g.deathEcho; i++) G.updateDeathEcho();
  ok(!g.deathEcho, 'the answered wreck eventually clears its slot');

  // Drifting past unclaimed must also clear (missable, not leaked).
  freshStage(g, {});
  g.deathEchoDone = true;
  g.deathEcho = { x: 10, y: 250, vy: 0.3, callsign: 'KWK', cause: 'bullet', fade: 0 };
  g.playerX = 200; // far away — never communes
  for (let i = 0; i < 400 && g.deathEcho; i++) G.updateDeathEcho();
  ok(!g.deathEcho, 'an ignored wreck drifts away instead of lingering forever');
}
if (ST && typeof G.updateSalvageShards === 'function' && G.__getGame && G.__getGame()) {
  const g = freshStage(G.__getGame(), {});
  g.lvl = { S: 1, N: 1, P: 1 };
  g._coachSalvagePending = false;
  g.salvageShards = [{ x: 112, y: 250, axis: 'S', vx: 0, vy: 0, ttl: 200 }];
  G.updateSalvageShards();
  eq(g.lvl.S, 2, 'catching a shard restores that axis by one level');
  eq(g.salvageShards.length, 0, 'the caught shard leaves the field');

  // Expiry: an ignored shard must vanish, not accumulate forever.
  freshStage(g, {});
  g.lvl = { S: 1, N: 1, P: 1 };
  g.salvageShards = [{ x: 10, y: 60, axis: 'N', vx: 0, vy: 0, ttl: 2 }];
  g.playerX = 200;
  for (let i = 0; i < 30 && g.salvageShards.length; i++) G.updateSalvageShards();
  eq(g.salvageShards.length, 0, 'an uncaught shard expires (the loss is permanent)');
  eq(g.lvl.N, 1, 'and it restores nothing');
} else { console.log('  (skipped — salvage lifecycle not drivable)'); }

section('FLIGHT SCHOOL — lifetime-once verb coaching (registry wired both sides)');
if (G.__getCoachLessons && G.__getCoachLessons()) {
  const L = G.__getCoachLessons();
  const ids = Object.keys(L);
  ok(ids.length >= 4, 'the lesson registry is populated (' + ids.length + ' lessons)');
  ok(ids.every(k => typeof L[k] === 'string' && L[k].length > 0 && L[k].length <= 40),
     'every lesson is a non-empty line short enough to read in play (<=40 chars)');
  ok(ids.every(k => L[k] === L[k].toUpperCase()),
     'lessons speak in the game\'s uppercase HUD voice');

  // BIDIRECTIONAL REGISTRY GUARD (same contract the ACHIEVEMENTS suite uses):
  // scanned from source text so a lesson that is defined but never taught — or
  // taught but never defined — cannot ship.
  const fired = new Set([...html.matchAll(/coachFire\('([a-zA-Z]+)'\)/g)].map(m => m[1]));
  const unreachable = ids.filter(id => !fired.has(id));
  const undefinedFire = [...fired].filter(id => !L[id]);
  eq(unreachable.join(','), '', 'every defined lesson has a coachFire() trigger site');
  eq(undefinedFire.join(','), '', 'every coachFire() call names a defined lesson');

  // The two systems that shipped unexplained are the reason this exists.
  ok(fired.has('salvage') && fired.has('echo'),
     'SALVAGE and DEATH ECHO — the two previously unexplained systems — are taught');

  // The loader must (a) tolerate any stored value and (b) filter ids that are
  // no longer defined, so a removed lesson can't hold a slot forever. Asserted
  // by re-running the loader's own expression against hostile inputs.
  const loadCoached = (raw) => {
    try {
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter(id => L[id]) : []);
    } catch (e) { return new Set(); }
  };
  eq(loadCoached('{not json').size, 0, 'corrupt JSON → no lessons marked learned');
  eq(loadCoached('"a string"').size, 0, 'non-array JSON → empty set');
  eq(loadCoached('{"a":1}').size, 0, 'object JSON → empty set');
  eq(loadCoached(null).size, 0, 'absent key → empty set');
  eq(loadCoached(JSON.stringify(['retiredLesson', 'alsoGone'])).size, 0,
     'ids of removed lessons are filtered out, not resurrected');
  const okSet = loadCoached(JSON.stringify([ids[0], 'notALesson']));
  ok(okSet.size === 1 && okSet.has(ids[0]), 'valid ids survive while unknown ids are dropped');

  // coachFire must be side-effect-safe when there is no live run.
  if (typeof G.coachFire === 'function') {
    const g = G.__getGame && G.__getGame();
    if (g) {
      const savedDemo = g.isDemo;
      g.isDemo = true;
      eq(G.coachFire('parry'), false, 'demo runs are never coached');
      g.isDemo = savedDemo;
    }
    eq(G.coachFire('not-a-lesson'), false, 'an unknown lesson id is a no-op, not a throw');
  }
} else { console.log('  (skipped — COACH_LESSONS not exposed)'); }

section('PIXEL TYPEFACE — embedded base64 woff2 payloads (single-file contract)');
{
  // The fonts are the ONLY binary assets in the project and they are what keeps
  // it a single self-contained file. Guard the payloads themselves: a stripped,
  // truncated, or externalised font must fail the build, not fail silently in a
  // browser as a fallback-metrics layout.
  const faces = [...html.matchAll(/font-family:'([^']+)'[^}]*?base64,([A-Za-z0-9+/=]+)\)/g)];
  eq(faces.length, 2, 'exactly two @font-face payloads are embedded');
  const names = faces.map(f => f[1]).sort();
  eq(names.join(','), 'PressStart2P,VT323', 'the display + body pair are both present');
  for (const [, fam, b64] of faces) {
    const buf = Buffer.from(b64, 'base64');
    ok(buf.length > 4000, fam + ': payload decodes to a plausible font size (' + buf.length + 'B)');
    // woff2 magic number 'wOF2' — proves it is a real font, not truncated base64
    eq(buf.slice(0, 4).toString('latin1'), 'wOF2', fam + ': payload carries the woff2 magic number');
  }
  // No network font may sneak back in — that would break offline/file:// play.
  ok(!/@import\s+url\(https?:/i.test(html), 'no remote @import (offline play preserved)');
  ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), 'no Google Fonts URL remains in the shipped file');
  // The font stack must always keep a generic fallback, so a face that fails to
  // decode degrades to monospace instead of to an unpredictable default.
  // (The document.fonts.load("16px 'VT323'") probes deliberately carry no
  // fallback — they ask about one specific face — so assert on the two real
  // font-stack strings instead of on every occurrence of a family name.)
  ok(/px '(?:VT323)', monospace/.test(html), 'body font stack falls back to monospace');
  ok(/px '(?:PressStart2P)', monospace/.test(html), 'display font stack falls back to monospace');
  // The escape hatch must exist and persist, like every other visual toggle.
  ok(/galagaPixelFontOff/.test(html), 'pixel font toggle persists to localStorage');
}

// ============================================================
console.log(`\n${'='.repeat(48)}`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
if (failed) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('All logic tests passed.');
process.exit(0);
