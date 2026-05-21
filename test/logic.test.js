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
section('computePilotMomentum');
ok(typeof G.computePilotMomentum === 'function', 'computePilotMomentum exists');
{
  const g = fresh();
  g.lives = 3; g.combo = 0; g.cleanStreak = 0; g.stageDied = false;
  eq(G.computePilotMomentum(), 'STEADY', 'default = STEADY');

  g.lives = 1;
  eq(G.computePilotMomentum(), 'CORNERED', 'lives 1 = CORNERED');

  g.lives = 3; g.combo = 20; g.cleanStreak = 3;
  eq(G.computePilotMomentum(), 'ASCENDING', 'combo20 + clean3 = ASCENDING');

  g.combo = 19; g.cleanStreak = 3;
  eq(G.computePilotMomentum(), 'STEADY', 'combo19 below threshold = STEADY');

  g.combo = 20; g.cleanStreak = 2;
  eq(G.computePilotMomentum(), 'STEADY', 'cleanStreak2 below threshold = STEADY');

  g.combo = 0; g.cleanStreak = 0; g.stageDied = true;
  eq(G.computePilotMomentum(), 'STRAINED', 'died + low combo = STRAINED');

  g.stageDied = true; g.combo = 5;
  eq(G.computePilotMomentum(), 'STEADY', 'died but combo>=5 = STEADY (recovered)');

  // CORNERED takes priority over ASCENDING
  g.lives = 1; g.combo = 30; g.cleanStreak = 5; g.stageDied = false;
  eq(G.computePilotMomentum(), 'CORNERED', 'CORNERED priority over ASCENDING');
}

// ============================================================
section('moraleStateFor (enemy morale thresholds)');
if (typeof G.moraleStateFor === 'function') {
  eq(G.moraleStateFor(-100), 'CONFIDENT', '<= -50 = CONFIDENT');
  eq(G.moraleStateFor(0), 'NORMAL', '0 = NORMAL');
  eq(G.moraleStateFor(100), 'SHAKEN', '100 = SHAKEN');
  eq(G.moraleStateFor(200), 'ROUTED', '>=150 = ROUTED');
} else { console.log('  (skipped — moraleStateFor not exposed)'); }

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
  eq(G.eliteRateForStage(50, 'normal'), 0.05,'stage 50 = 5%');
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
section('computeMoraleScore — enemy-confidence weighted inputs');
{
  const mg = G.__getGame && G.__getGame();
  if (mg && typeof G.computeMoraleScore === 'function') {
    const save = { stats: mg.stats, lives: mg.lives, witchSaves: mg.witchSaves,
                   bossesKilledThisRun: mg.bossesKilledThisRun, parryCount: mg.parryCount,
                   eliteKills: mg.eliteKills };
    const near = (a, b, m) => ok(Math.abs(a - b) < 1e-9, m);
    const reset = () => { mg.stats = { kills: 0, maxStage: 1 }; mg.lives = 3; mg.witchSaves = 0;
                          mg.bossesKilledThisRun = 0; mg.parryCount = 0; mg.eliteKills = 0; };
    reset(); near(G.computeMoraleScore(), 0, 'baseline = 0');
    reset(); mg.stats = { kills: 10, maxStage: 1 }; near(G.computeMoraleScore(), 5, 'kills ×0.5');
    reset(); mg.lives = 1; near(G.computeMoraleScore(), -24, 'lost 2 lives → -24 (enemies confident)');
    reset(); mg.bossesKilledThisRun = 1; near(G.computeMoraleScore(), 30, 'boss kill → +30');
    reset(); mg.parryCount = 10; near(G.computeMoraleScore(), 15, 'parries ×1.5');
    reset(); mg.eliteKills = 5; near(G.computeMoraleScore(), 15, 'elite kills ×3');
    reset(); mg.stats = { kills: 0, maxStage: 11 }; near(G.computeMoraleScore(), 50, 'depth (maxStage-1)×5');
    reset(); mg.stats = { kills: 0, maxStage: 11 }; mg.witchSaves = 4;
    near(G.computeMoraleScore(), 70, 'witch saves ×5 stack on depth');
    Object.assign(mg, save);
  } else { console.log('  (skipped — computeMoraleScore / game not exposed)'); }
}

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
section('stats overlay page model — Tab navigation invariants');
if (typeof G.statsAchGridPages === 'function' && typeof G.statsTotalPages === 'function') {
  const gp = G.statsAchGridPages();
  const tp = G.statsTotalPages();
  ok(gp >= 1, 'at least one achievement grid page');
  // summary(1) + grids(gp) + bestiary(1) + profile(1)
  eq(tp, gp + 3, 'total pages = grid pages + 3 (summary/bestiary/profile)');
  // The four draw branches key off these indices; assert they stay distinct and
  // ordered so a future ACHIEVEMENTS change can't collapse two pages onto one
  // index or push a page out of the Tab cycle.
  const summaryPage  = 0;
  const firstGridPg  = 1;
  const lastGridPg   = gp;
  const bestiaryPage = gp + 1;
  const profilePage  = gp + 2;
  ok(firstGridPg <= lastGridPg, 'grid page range is non-empty');
  ok(summaryPage < firstGridPg, 'summary precedes grids');
  ok(lastGridPg < bestiaryPage, 'grids precede bestiary');
  ok(bestiaryPage < profilePage, 'bestiary precedes profile');
  eq(profilePage, tp - 1, 'profile is the last page (Tab wraps after it)');
  // every page index in [0, tp) maps to exactly one of the four kinds
  let covered = 0;
  for (let p = 0; p < tp; p++) {
    const kinds = (p === summaryPage ? 1 : 0)
                + (p >= firstGridPg && p <= lastGridPg ? 1 : 0)
                + (p === bestiaryPage ? 1 : 0)
                + (p === profilePage ? 1 : 0);
    if (kinds === 1) covered++;
  }
  eq(covered, tp, 'every Tab page maps to exactly one kind (no gaps/overlaps)');
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
section('tauntFor: graceful fallback for every archetype × situation (incl. phantom/rune)');
if (typeof G.tauntFor === 'function') {
  // All 6 archetypes (phantom/rune lack their own BOSS_TAUNTS entry → fall back to
  // standard). All situations the code triggers. Must never throw; returns a
  // string (a line) or null (no line for that situation) — both are valid.
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
  // phantom/rune specifically resolve via the standard fallback for a known situation
  ok(G.tauntFor('phantom', 'intro') === G.tauntFor('standard', 'intro'), 'phantom intro falls back to standard');
  ok(G.tauntFor('rune', 'intro') === G.tauntFor('standard', 'intro'), 'rune intro falls back to standard');
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
  // via dynamic refs (morale state map, endurance tiers) the literal scan can't see.
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
console.log(`\n${'='.repeat(48)}`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
if (failed) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('All logic tests passed.');
process.exit(0);
