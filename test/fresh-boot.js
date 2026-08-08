/*
 * fresh-boot.js — the first-time player path.
 *
 * The game reads localStorage in 112 places, every one of them behind a
 * try/catch and a default. Nothing verified that a profile with NO storage at
 * all boots and plays: the main suite's sandbox accumulates keys as it runs,
 * and the layout audit deliberately seeds a maxed profile. So the most common
 * first experience there is — someone opening the page for the first time —
 * was the one path never exercised end to end.
 *
 *     node test/fresh-boot.js        (exit 0 = clean)
 *
 * Boots a sandbox whose storage is empty and STAYS empty for the read pass,
 * runs init + a real driven session, and asserts nothing throws, the derived
 * defaults are sane, and the game actually progresses.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

const noop = () => {};
const px = new Proxy({}, { get: () => () => px, set: () => true });
const audioNode = new Proxy({}, {
  get(t, p) {
    if (['connect', 'disconnect', 'start', 'stop', 'setValueAtTime', 'linearRampToValueAtTime',
      'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'].includes(p)) return () => audioNode;
    if (['frequency', 'gain', 'detune', 'pan', 'Q', 'delayTime', 'playbackRate'].includes(p)) {
      return { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop, setTargetAtTime: noop, cancelScheduledValues: noop };
    }
    return () => audioNode;
  },
});
const AC = () => ({
  currentTime: 0, sampleRate: 44100, destination: audioNode, state: 'running',
  createOscillator: () => audioNode, createGain: () => audioNode, createBiquadFilter: () => audioNode,
  createDelay: () => audioNode, createStereoPanner: () => audioNode, createDynamicsCompressor: () => audioNode,
  createBuffer: () => ({ getChannelData: () => new Float32Array(8) }), createBufferSource: () => audioNode,
  createWaveShaper: () => audioNode, createConvolver: () => audioNode, createAnalyser: () => audioNode,
  resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
});

// A storage that is genuinely EMPTY, and records what the game tries to read
// before it has ever written anything.
const store = {};
const readsBeforeWrite = new Set();
const written = new Set();
const localStorage = {
  getItem(k) {
    if (!written.has(k)) readsBeforeWrite.add(k);
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
  },
  setItem(k, v) { written.add(k); store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};

const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage,
  document: {
    getElementById: () => px, createElement: () => px, querySelector: () => px,
    querySelectorAll: () => [], addEventListener: noop, body: px, documentElement: px,
    hidden: false, fullscreenElement: null, exitFullscreen: () => Promise.resolve(),
  },
  AudioContext: AC, webkitAudioContext: AC,
  navigator: { getGamepads: () => [], vibrate: noop, userAgent: 'node', maxTouchPoints: 0 },
  performance: { now: () => 0 },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
sandbox.window.innerWidth = 224;
sandbox.window.innerHeight = 288;
sandbox.window.devicePixelRatio = 1;

let passed = 0;
const fails = [];
const ok = (c, label) => { if (c) passed++; else fails.push(label); };
const eq = (a, b, label) => ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

console.log('\nFRESH BOOT — first-time player, empty localStorage\n');

// ---- 1. the script loads at all ----
let bootErr = null;
try {
  vm.createContext(sandbox);
  vm.runInContext(src + `
;globalThis.__g = () => (typeof game !== 'undefined' ? game : null);
;globalThis.__S = () => (typeof STATE !== 'undefined' ? STATE : null);
;globalThis.__keys = () => (typeof keys !== 'undefined' ? keys : null);
;globalThis.__prefs = () => ({
  bloom: (typeof bloomEnabled !== 'undefined') ? bloomEnabled : null,
  colorBlind: (typeof colorBlindMode !== 'undefined') ? colorBlindMode : null,
  difficulty: (typeof difficultyMode !== 'undefined') ? difficultyMode : null,
});
`, sandbox, { filename: 'game.js' });
} catch (e) { bootErr = e; }
ok(!bootErr, 'the game boots with no stored profile' + (bootErr ? ' — ' + bootErr.message : ''));
if (bootErr) { report(); }

const G = sandbox;
const g0 = G.__g();
ok(!!g0, 'a game object exists after init');

// ---- 2. derived defaults are sane, not NaN/undefined ----
if (g0) {
  ok(typeof g0.lives === 'number' && g0.lives > 0, 'starts with lives (' + g0.lives + ')');
  eq(g0.score, 0, 'starts at zero score');
  ok(typeof g0.stage === 'number' && g0.stage >= 1, 'starts on a real stage (' + g0.stage + ')');
  ok(isFinite(g0.playerX) && isFinite(g0.playerY), 'the ship has a finite position');
  ok(!!g0.lvl && g0.lvl.S === 1 && g0.lvl.N === 1 && g0.lvl.P === 1, 'weapon levels start at 1/1/1');
}
const prefs = G.__prefs ? G.__prefs() : {};
ok(prefs.bloom === true, 'bloom defaults ON for a new profile');
ok(prefs.colorBlind === false, 'colorblind defaults OFF');
ok(typeof prefs.difficulty === 'string', 'a difficulty mode is chosen (' + prefs.difficulty + ')');

// ---- 3. a fresh profile can actually play ----
const S = G.__S();
const K = G.__keys() || {};
let playErr = null;
try {
  G.resetGame();
  const g = G.__g();
  g.stage = 1;
  G.startStage();
  g.playerAlive = true;
  for (let f = 0; f < 900; f++) {
    K[' '] = true;
    K['ArrowLeft'] = (f % 120) < 60;
    K['ArrowRight'] = (f % 120) >= 60;
    G.update();
    if ((f & 15) === 0) G.draw();
  }
  K[' '] = false; K['ArrowLeft'] = false; K['ArrowRight'] = false;
} catch (e) { playErr = e; }
ok(!playErr, 'a fresh profile plays 900 frames without throwing'
   + (playErr ? ' — ' + playErr.message : ''));

const g2 = G.__g();
if (g2) {
  ok((g2.stats && g2.stats.shotsFired || 0) > 0, 'the session actually fired (coverage check)');
  ok(isFinite(g2.score) && g2.score >= 0, 'score stayed finite');
}

// ---- 4. the first run writes a profile back ----
ok(written.size > 0, 'a first session persists something (' + written.size + ' keys)');

// ---- 5. a CORRUPTED profile still boots ----
// The sibling failure of an empty profile, and worse: a player whose storage
// got mangled (a partial write, another tab, a browser bug) is locked out
// permanently — every reload hits the same throw. The existing corrupt-storage
// test covers 5 keys through 2 functions; it cannot see the BOOT path, where
// ~36 keys are read by module-level initialisers before any of that runs.
// Every galaga* key in the source is filled with garbage of a different shape:
// broken JSON, wrong type, empty string, and a huge string.
{
  const keys = [...new Set(src.match(/galaga[A-Za-z]+/g) || [])];
  const junk = ['{not json[', '"a string"', '{"a":1}', '[1,2,3]', '', 'null',
                'NaN', '-1', String('x').repeat(4096)];
  const cstore = {};
  keys.forEach((k, i) => { cstore[k] = junk[i % junk.length]; });

  const cSandbox = Object.assign({}, sandbox, {
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(cstore, k) ? cstore[k] : null),
      setItem: (k, v) => { cstore[k] = String(v); },
      removeItem: k => { delete cstore[k]; },
      clear: noop,
    },
  });
  cSandbox.window = cSandbox;
  cSandbox.globalThis = cSandbox;

  let cErr = null;
  try {
    vm.createContext(cSandbox);
    vm.runInContext(src + `
;globalThis.__g = () => (typeof game !== 'undefined' ? game : null);
;globalThis.__keys = () => (typeof keys !== 'undefined' ? keys : null);
`, cSandbox, { filename: 'game-corrupt.js' });
  } catch (e) { cErr = e; }
  ok(!cErr, 'the game boots with EVERY stored key corrupted'
     + (cErr ? ' — ' + cErr.message : ''));
  ok(keys.length > 40, 'the corruption covered the real key set (' + keys.length + ' keys)');

  if (!cErr) {
    let cPlay = null;
    try {
      cSandbox.resetGame();
      const cg = cSandbox.__g();
      cg.stage = 1;
      cSandbox.startStage();
      cg.playerAlive = true;
      const CK = cSandbox.__keys() || {};
      for (let f = 0; f < 300; f++) {
        CK[' '] = true;
        cSandbox.update();
        if ((f & 15) === 0) cSandbox.draw();
      }
      CK[' '] = false;
    } catch (e) { cPlay = e; }
    ok(!cPlay, 'and plays from a corrupted profile' + (cPlay ? ' — ' + cPlay.message : ''));
    const cg2 = cSandbox.__g();
    ok(!cg2 || (isFinite(cg2.score) && isFinite(cg2.playerX)),
       'corrupt input did not poison the run with NaN');
  }
}

function report() {
  console.log('read before ever written: ' + readsBeforeWrite.size + ' keys (all must have defaults)');
  console.log('\nPASSED: ' + passed + '   FAILED: ' + fails.length);
  if (fails.length) {
    console.log('\nFAILURES:');
    for (const f of fails) console.log('  x ' + f);
    process.exit(1);
  }
  console.log('Fresh boot clean.\n');
  process.exit(0);
}
report();
