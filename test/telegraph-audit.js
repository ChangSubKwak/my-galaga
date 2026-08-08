/*
 * telegraph-audit.js — the fairness budget, measured.
 *
 *     node test/telegraph-audit.js
 *
 * Every threat in this game is supposed to announce itself before it can hurt
 * you. That promise lived only in scattered constants, so nothing compared the
 * threats to each other and nothing noticed when one of them promised nothing
 * at all: the tractor beam ran for years with a 60-frame wind-up that drew
 * NOTHING, making the beam's first visible frame its first grabbing frame — on
 * the only threat that costs a whole life. It was invisible in the code and
 * obvious the moment the numbers sat in one column.
 *
 * This is a REPORT, not a pass/fail test — the same division of labour
 * curve-audit.js has with logic.test.js, where the hard invariants live.
 *
 * It MEASURES rather than restates: each threat is driven in a real session
 * and the warning is counted in frames actually observed between "a player
 * looking at the screen could know" and "this can now take something from
 * you". Restating the constants would just re-encode the bug.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const noop = () => {};
const px = new Proxy({}, { get: () => () => px, set: () => true });
const audioNode = new Proxy({}, {
  get(t, p) {
    if (['frequency', 'gain', 'detune', 'pan', 'Q', 'delayTime', 'playbackRate'].includes(p)) {
      return { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop,
               exponentialRampToValueAtTime: noop, setTargetAtTime: noop,
               cancelScheduledValues: noop };
    }
    return () => audioNode;
  },
});
const AC = () => ({
  currentTime: 0, sampleRate: 44100, destination: audioNode, state: 'running',
  createOscillator: () => audioNode, createGain: () => audioNode,
  createBiquadFilter: () => audioNode, createDelay: () => audioNode,
  createStereoPanner: () => audioNode, createDynamicsCompressor: () => audioNode,
  createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
  createBufferSource: () => audioNode, createWaveShaper: () => audioNode,
  createConvolver: () => audioNode, createAnalyser: () => audioNode,
  resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
});
const store = {};
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: noop,
  },
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

vm.createContext(sandbox);
vm.runInContext(script + `
;globalThis.__g = () => game;
;globalThis.__S = () => STATE;
;globalThis.__keys = () => keys;
;globalThis.__k = n => { try { return eval(n); } catch (e) { return undefined; } };
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();

const rows = [];
function row(threat, cost, frames, how) {
  rows.push({ threat, cost, frames, how });
}

// ---------------------------------------------------------------------------
// 1. FORMATION DIVE — previewTimer counts down while the enemy stays put.
//    Measured by watching a real enemy from the frame its preview appears to
//    the frame it actually starts moving down the path.
// ---------------------------------------------------------------------------
function measureDive() {
  let best = null;
  for (let attempt = 0; attempt < 40 && best === null; attempt++) {
    G.resetGame();
    const g = G.__g();
    g.stage = 3 + attempt % 5;
    G.startStage();
    g.playerAlive = true;
    g.lives = 99;
    const seen = new Map();          // enemy -> frames its preview was up
    for (let f = 0; f < 1400; f++) {
      K['ArrowLeft'] = (f % 160) < 80;
      K['ArrowRight'] = (f % 160) >= 80;
      G.update();
      for (const e of g.enemies || []) {
        if ((e.previewTimer || 0) > 0) seen.set(e, (seen.get(e) || 0) + 1);
        else if (seen.has(e) && e.state === 'diving') {
          best = Math.max(best === null ? 0 : best, seen.get(e));
          seen.delete(e);
        }
      }
      if (best !== null) break;
    }
    K['ArrowLeft'] = false; K['ArrowRight'] = false;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 2. CAPTURE BEAM — telegraph frames before the grab check goes live.
//    Counted through the pure helper so it reflects what is actually drawn.
// ---------------------------------------------------------------------------
function measureCapture() {
  if (typeof G.captureTelegraphProgress !== 'function') return null;
  let n = 0;
  for (let t = 0; t < 600; t++) if (G.captureTelegraphProgress(t) >= 0) n++;
  return n;
}

// ---------------------------------------------------------------------------
// 3. WEATHER STRIKE — telegraph phase length, measured by walking the real
//    phase machine rather than reading STRIKE_TELEGRAPH back out.
// ---------------------------------------------------------------------------
function measureStrike() {
  if (typeof G.strikePhase !== 'function') return null;
  const interval = 600;
  let n = 0;
  for (let t = 0; t < interval + 60; t++) {
    if (G.strikePhase(t, interval) === 'telegraph') n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 4. BOSS SIGNATURE — how long `sigLocking` (the crosshair + tick) is up
//    before the attack fires. Driven on a real boss stage.
// ---------------------------------------------------------------------------
function measureBossSig() {
  let best = null;
  for (const stage of [10, 20, 30, 60]) {
    G.resetGame();
    const g = G.__g();
    g.stage = stage;
    G.startStage();
    g.playerAlive = true;
    g.lives = 99;
    let run = 0;
    for (let f = 0; f < 1800; f++) {
      K[' '] = (f % 9) < 3;
      G.update();
      const mb = (g.megaBosses || [])[0];
      if (!mb) continue;
      if (mb.sigLocking) run++;
      else if (run > 0) {
        best = best === null ? run : Math.min(best, run);
        run = 0;
      }
    }
    K[' '] = false;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 5. ENEMY BULLETS — no telegraph by design; fairness is bought with a SPEED
//    CAP instead, so the read time is travel time. Measured as the frames a
//    capped-speed bullet needs to cross the playfield.
// ---------------------------------------------------------------------------
function measureBullet() {
  if (typeof G.cappedStageSpeed !== 'function') return null;
  const BASE_H = G.__k('BASE_H') || 288;
  // the deep-stage worst case: fully saturated speed, hard difficulty
  const v = G.cappedStageSpeed(3.4, 1.2, 0.05, 100, 1.15);
  return Math.round(BASE_H / v);
}

console.log('\nTELEGRAPH AUDIT — how long does each threat warn you?\n');

row('formation dive',   'a hit',   measureDive(),    'previewTimer, enemy frozen + path dots');
row('boss signature',   'a hit',   measureBossSig(), 'sigLocking crosshair + tick sfx');
row('weather strike',   'a hit',   measureStrike(),  'tinted column + edge dashes + chevron');
row('CAPTURE BEAM',     'A LIFE',  measureCapture(), 'growing dashed column + chevron');
row('enemy bullet',     'a hit',   measureBullet(),  'no telegraph — bought with a speed cap');

const BASELINE = 30;   // the dive preview: the cheapest threat's warning
console.log('threat            costs    warning        vs dive   how');
console.log('------------------------------------------------------------------------');
for (const r of rows) {
  const f = r.frames;
  const shown = f === null ? '  ?  ' : (String(f).padStart(3) + 'f ' + (f / 60).toFixed(2) + 's');
  let verdict = '   -  ';
  if (f !== null) {
    const ratio = f / BASELINE;
    verdict = (ratio >= 1 ? '+' : '') + ((ratio - 1) * 100).toFixed(0) + '%';
    verdict = verdict.padStart(6);
  }
  console.log('%s %s %s %s   %s',
    r.threat.padEnd(17), r.cost.padEnd(8), shown.padEnd(13), verdict, r.how);
}
console.log('------------------------------------------------------------------------');

// The one rule this report exists to make checkable: a threat that takes MORE
// from the player must not warn LESS. Cost and courtesy have to move together.
const life = rows.find(r => r.cost === 'A LIFE');
const hits = rows.filter(r => r.cost === 'a hit' && r.frames !== null);
if (life && life.frames !== null && hits.length) {
  const worstHit = Math.min(...hits.map(r => r.frames));
  const okOrder = life.frames >= worstHit;
  console.log('\nthe life-costing threat warns %sf; the tightest hit-costing threat warns %sf.',
    life.frames, worstHit);
  console.log(okOrder
    ? 'ORDER HOLDS — the more a threat takes, the earlier it speaks.'
    : 'INVERTED — the most expensive threat is also the least announced.');
}

const tightest = rows.filter(r => r.frames !== null).sort((a, b) => a.frames - b.frames)[0];
if (tightest) {
  console.log('\ntightest warning in the game: %s at %sf (%sms).',
    tightest.threat, tightest.frames, Math.round(tightest.frames / 60 * 1000));
  if (tightest.frames < 18) {
    console.log('  NOTE: below ~300ms a player can begin reacting but cannot finish');
    console.log('  an evasion. Anything here needs periodicity or a second cue.');
  }
}
console.log('');
