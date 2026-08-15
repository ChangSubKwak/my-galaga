/*
 * ebb-audit.js — THE EBB, measured.
 *
 *     node test/ebb-audit.js
 *
 * THE EBB's claim is a played loop: the swarm's sortie empties part of its own
 * wall, that hole becomes a live keystone, and the player cuts it before the
 * squad flies home. Every step of that is verifiable in a fixture. Whether the
 * WHOLE CHAIN is ever available in a real stage is not — and that is exactly
 * the question SALVAGE PROTOCOL answered wrong for its entire shipped life
 * (planner logic-tested, lesson taught, loot contested, catch rate zero).
 *
 * Adversarial review of THE EBB claimed the same failure mode here: that the
 * window (net down) and the payoff (live cuts) need antagonistic wall states,
 * because an intact 4-connected grid has NO articulation points, so cuts need a
 * CARVED wall — and carving is killing, which shrinks the wall the window opens
 * in. This audit exists to settle that with numbers instead of argument.
 *
 * It reports, per normal stage band:
 *   - SORTIES        coordinated maneuvers launched
 *   - WINDOWS        sorties that actually dropped the net (commander led)
 *   - ARMED          windows that contained at least one CUTTABLE keystone
 *                    (drawn AND collapsible: cooldown clear, no live telegraph)
 *   - LENGTH         mean frames a window stayed open
 *   - CUTS           spans actually dropped inside a window by a hunting bot
 *
 * This is a REPORT, not a pass/fail gate — the same division of labour
 * curve/telegraph/pulse/recovery/loadout audits have with logic.test.js.
 *
 * WHEN TOUCHING the commander, the lattice, WING TACTICS or the collapse
 * cooldown: run this. ARMED near zero means the loop is decorative and the
 * honest fix is structural (more of the wall standing when the sortie leaves),
 * never a bigger reward for a thing that does not happen.
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
;globalThis.__wingTelegraphing = (e) => wingTelegraphing(e);
;globalThis.__C = () => ({ MIN_CHUNK: LAT_MIN_CHUNK, COOL: LAT_COOLDOWN,
                           WING_PREVIEW: WING_PREVIEW, DIVE_PREVIEW: DIVE_PREVIEW });
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();
const C = G.__C();

let _seed = 777333;
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const clearKeys = () => {
  for (const k of [' ', 'ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D']) K[k] = false;
};

// A bot that HUNTS the mechanic: it shoots the wall normally, but the moment a
// window is open with an armed keystone it flies under the nearest one and
// fires. If the loop is available at all, this bot finds it.
function hunt(stage, frames) {
  G.resetGame();
  const g = G.__g();
  g.stage = stage;
  G.startStage();
  g.playerAlive = true;
  g.lives = 999;
  g.cheatInvincible = true;          // measure availability, not the bot's dodging
  for (let f = 0; f < 600 && !g.allEntered; f++) G.update();
  clearKeys();

  let sorties = 0, windows = 0, armedWindows = 0, winFrames = 0;
  let inWindow = false, thisWindowArmed = false, curLen = 0;
  let prevWing = false, closedByDeath = 0, closedByReturn = 0;
  const cutsAtStart = g.ebbCuts || 0;

  for (let f = 0; f < frames; f++) {
    const L = g.lattice;
    const cmd = (g.enemies || []).find(e => e.alive && e.isCommander);
    // A sortie is counted when a coordinated telegraph begins.
    const wingNow = (g.enemies || []).some(e => e.alive && e._wingTactic
      && ((e.previewTimer || 0) > 0 || e.state === 'diving'));
    if (wingNow && !prevWing) sorties++;
    prevWing = wingNow;

    const netDown = !!(L && !L.netIntact && cmd && cmd.state !== 'formation');
    const armed = !!(L && L.cuts && L.cuts.length
      && (L.cool || 0) <= 0 && !G.__wingTelegraphing(g.enemies));
    if (netDown) {
      if (!inWindow) { inWindow = true; windows++; thisWindowArmed = false; curLen = 0; }
      curLen++;
      if (armed) thisWindowArmed = true;
    } else if (inWindow) {
      inWindow = false;
      winFrames += curLen;
      if (thisWindowArmed) armedWindows++;
      // WHY did it close? A commander that FLEW HOME is the designed close; a
      // commander that DIED closes it by the other rule — and if that is the
      // common case, "spare the commander" is not a flyable counter-play,
      // because leading a sortie flies it into the player's guns.
      if (!cmd) closedByDeath++; else closedByReturn++;
    }

    // --- the hunting bot ---
    clearKeys();
    K[' '] = true;
    let tx = null;
    if (netDown && armed && L) {
      let bd = Infinity;
      for (const c of L.cuts) {
        const e = L.ents[c.i];
        if (!e || !e.alive || e.state !== 'formation') continue;
        const d = Math.abs(e.x - g.playerX);
        if (d < bd) { bd = d; tx = e.x; }
      }
    }
    if (tx == null) tx = 112;
    if (g.playerX < tx - 2) K['ArrowRight'] = true;
    else if (g.playerX > tx + 2) K['ArrowLeft'] = true;

    G.update();
  }
  if (inWindow) { winFrames += curLen; if (thisWindowArmed) armedWindows++; }
  clearKeys();
  return {
    stage, sorties, windows, armedWindows, closedByDeath, closedByReturn,
    meanLen: windows ? Math.round(winFrames / windows) : 0,
    cuts: (g.ebbCuts || 0) - cutsAtStart,
    spans: g.spansDropped || 0,
  };
}

console.log('');
console.log('  THE EBB — is the window ever actually cuttable?');
console.log('  ' + '='.repeat(66));
console.log('');
console.log('    stage   sorties   windows   armed   mean len   sortie cuts   spans');
const rows = [];
for (const s of [7, 13, 29]) {
  const r = hunt(s, 9000);
  rows.push(r);
  console.log('    ' + String(s).padStart(5)
    + String(r.sorties).padStart(10)
    + String(r.windows).padStart(10)
    + String(r.armedWindows).padStart(8)
    + (r.meanLen + 'f').padStart(11)
    + String(r.cuts).padStart(14)
    + String(r.spans).padStart(8));
}

console.log('');
console.log('  HOW WINDOWS CLOSED  (a window closed by DEATH means "spare the');
console.log('  commander" is not flyable — leading a sortie flies it into your guns)');
for (const r of rows) {
  console.log('    stage ' + String(r.stage).padStart(3) + ':  flew home ' + r.closedByReturn
    + ',  died mid-sortie ' + r.closedByDeath);
}

const tW = rows.reduce((a, r) => a + r.windows, 0);
const tA = rows.reduce((a, r) => a + r.armedWindows, 0);
const tC = rows.reduce((a, r) => a + r.cuts, 0);
const armedPct = tW ? Math.round(100 * tA / tW) : 0;

console.log('');
console.log('  ' + '-'.repeat(66));
if (tW === 0) {
  console.log('  -> NO WINDOW EVER OPENED. The commander never led a sortie: the sally');
  console.log('     is not firing, or the commander is dying first. The loop does not');
  console.log('     exist in play at all.');
} else if (tA === 0) {
  console.log('  -> ' + tW + ' windows opened and NONE was cuttable. The window and the payoff');
  console.log('     need antagonistic wall states — an intact grid has no articulation');
  console.log('     points, and by the time the wall is carved the sortie pool is thin.');
  console.log('     This is SALVAGE\'s failure mode: a loop alive in a fixture, dead in');
  console.log('     the game. Fix it STRUCTURALLY (more of the wall standing when the');
  console.log('     sortie leaves), never by rewarding a thing that does not happen.');
} else if (tC === 0) {
  console.log('  -> ' + tA + ' of ' + tW + ' windows (' + armedPct + '%) were ARMED, but a bot that hunts');
  console.log('     the mechanic landed ZERO cuts. The window exists and is too short,');
  console.log('     or the keystone is too far from where the window opens. Report the');
  console.log('     mean length (' + rows.map(r => r.meanLen).join('/') + 'f) against the time to cross to a diamond.');
} else {
  console.log('  -> ALIVE: ' + tA + ' of ' + tW + ' windows (' + armedPct + '%) held a cuttable keystone, and');
  console.log('     a hunting bot converted ' + tC + ' of them. The loop is available in real');
  console.log('     play; what limits it is the wall\'s own geometry, which is the');
  console.log('     intended tension — an intact wall has nothing to cut.');
}
console.log('');
