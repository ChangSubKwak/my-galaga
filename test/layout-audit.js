/*
 * layout-audit.js — off-screen / overflowing text detector.
 *
 * The game draws ~213 text sites procedurally onto a 224x288 playfield. There
 * is no layout engine and no browser in CI, so a string that grows (a longer
 * boss name, a bigger score, a new label) can silently render off the edge and
 * nobody finds out until someone looks at the screen.
 *
 * This runs the real draw() across every screen and overlay page inside the vm
 * sandbox, records every text draw the game issues (text, x, size, align), and
 * computes each one's real pixel width from MEASURED font advances. Both
 * embedded faces are monospaced, so width is exactly chars x advance x size —
 * no font engine required.
 *
 * It checks all three font configurations the game can actually be in, because
 * the pixel faces load asynchronously:
 *     monospace   0.60 em   the fallback shown until the fonts resolve
 *     pixel       0.40 em   VT323 body face
 *                 1.00 em   PressStart2P display face (size >= 12)
 *
 *     node test/layout-audit.js
 *
 * Exit code 1 if any text overflows in any configuration.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE_W = 224, BASE_H = 288;
const PIXEL_DISPLAY_MIN = 12;
// Measured out of the shipped base64 payloads with fontTools (see DESIGN.md).
const ADV = { mono: 0.60, vt323: 0.40, ps2p: 1.00 };

const HTML = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- recording canvas stub ----------------------------------------------
// The stub tracks the full 2D transform stack. Without it, any text drawn
// inside a ctx.translate()/scale() — the stage countdown, the boss taunt
// bubble, every rotated flourish — is recorded at its LOCAL coordinate and
// reported as wildly off-screen. A false positive is worse than no tool: it
// trains people to ignore the output.
const draws = [];
let recording = false, currentScreen = '', frameNo = 0;
function makeCtx() {
  const grad = { addColorStop() {} };
  const state = { font: 'bold 5px monospace', textAlign: 'center' };
  // Canvas matrix convention [a,b,c,d,e,f]: x' = a*x + c*y + e
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (n) => {
    const [a, b, c, d, e, f] = m;
    m = [
      a * n[0] + c * n[1], b * n[0] + d * n[1],
      a * n[2] + c * n[3], b * n[2] + d * n[3],
      a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f,
    ];
  };
  const target = {
    save() { stack.push(m.slice()); },
    restore() { if (stack.length) m = stack.pop(); },
    translate(x, y) { mul([1, 0, 0, 1, Number(x) || 0, Number(y) || 0]); },
    scale(x, y) { mul([Number(x) || 0, 0, 0, Number(y) || 0, 0, 0]); },
    rotate(r) { const c = Math.cos(r || 0), s = Math.sin(r || 0); mul([c, s, -s, c, 0, 0]); },
    transform(...n) { mul(n.map(v => Number(v) || 0)); },
    setTransform(...n) { m = n.length === 6 ? n.map(v => Number(v) || 0) : [1, 0, 0, 1, 0, 0]; },
    fillRect() {}, strokeRect() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
    fill() {}, stroke() {}, clip() {},
    measureText(t) { return { width: String(t).length * 3 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    drawImage() {}, putImageData() {}, getImageData() { return { data: [] }; },
    setLineDash() {}, quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, arcTo() {},
    strokeText() {},
    fillText(t, x, y) {
      if (!recording) return;
      const fm = /(\d+(?:\.\d+)?)px/.exec(state.font || '');
      const lx = Number(x) || 0, ly = Number(y) || 0;
      const [a, b, c, d, e] = m;
      draws.push({
        frame: frameNo,
        screen: currentScreen,
        text: String(t),
        x: a * lx + c * ly + e,          // device-space anchor
        y: b * lx + d * ly + m[5],      // device-space baseline
        xScale: Math.hypot(a, b) || 1,   // how much the matrix stretches width
        rotated: Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6,
        size: fm ? parseFloat(fm[1]) : 5,
        align: state.textAlign || 'center',
      });
    },
  };
  return new Proxy(target, {
    get(o, p) {
      if (p in o) return o[p];
      if (p === 'font' || p === 'textAlign') return state[p];
      return typeof p === 'string' ? () => {} : undefined;
    },
    set(o, p, v) { if (p === 'font' || p === 'textAlign') state[p] = v; return true; },
  });
}

const noop = () => {};
const el = () => ({
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  addEventListener: noop, appendChild: noop, setAttribute: noop,
  getContext: makeCtx, focus: noop, textContent: '', innerHTML: '', value: '',
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
});
const canvas = {
  width: BASE_W, height: BASE_H, style: {}, getContext: makeCtx,
  addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: BASE_W, height: BASE_H }),
};
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
const store = {};
// DETERMINISM — the game calls Math.random() everywhere (formation variants,
// stage mutations, intro slides), so an unseeded run captures a different set
// of frames each time and can MISS a real overflow. That is exactly how this
// tool first reported a clean pass on a deliberately over-long boss name. A
// seeded PRNG makes every run identical and the result trustworthy.
let _seed = 0x2f6e2b1;
const seededRandom = () => {
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) % 1000000) / 1000000;
};
const SeededMath = Object.create(Math);
SeededMath.random = seededRandom;

const sandbox = {
  console, Math: SeededMath, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage: {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: noop, clear: noop,
  },
  document: {
    getElementById: id => (id === 'gc' ? canvas : el()), createElement: el,
    querySelector: el, querySelectorAll: () => [], addEventListener: noop,
    body: el(), documentElement: el(), hidden: false, fullscreenElement: null,
    exitFullscreen: () => Promise.resolve(),
  },
  AudioContext: function () {
    return {
      currentTime: 0, sampleRate: 44100, destination: audioNode, state: 'running',
      createOscillator: () => audioNode, createGain: () => audioNode,
      createBiquadFilter: () => audioNode, createDelay: () => audioNode,
      createStereoPanner: () => audioNode, createDynamicsCompressor: () => audioNode,
      createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
      createBufferSource: () => audioNode, createWaveShaper: () => audioNode,
      createConvolver: () => audioNode, createAnalyser: () => audioNode,
      resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
    };
  },
  navigator: { getGamepads: () => [], vibrate: noop, userAgent: 'node', maxTouchPoints: 0 },
  performance: { now: () => 0 },
};
sandbox.webkitAudioContext = sandbox.AudioContext;
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
// SCALE = min(w/BASE_W, h/BASE_H); sizing the window exactly to the internal
// resolution makes SCALE == 1, so device space IS game space and the 224px
// bound below is directly comparable.
sandbox.window.innerWidth = BASE_W; sandbox.window.innerHeight = BASE_H; sandbox.window.devicePixelRatio = 1;
// FULL-PROGRESS FIXTURE — most overlay rows are CONDITIONAL on a lifetime
// stat existing, so a virgin profile renders the SHORTEST possible panels and
// the audit measures the easy case. Seeding a maxed profile forces every
// conditional row, tier label and badge to draw, which is the layout that can
// actually overflow. (Verified: without this the stats summary page rendered
// 3 fewer rows than a real veteran profile does.)
Object.assign(store, {
  galagaHigh: '999999999', galagaParryTotal: '1234', galagaNearMissTotal: '4321',
  galagaGrazeChainBest: '22', galagaCleanStreakBest: '17', galagaRevengeTotal: '88',
  galagaFlawlessBosses: '19', galagaWitchSaves: '77', galagaPBBeats: '41',
  galagaEliteKills: '2500', galagaRivalWins: '23', galagaSalvageTotal: '450',
  galagaMagpieKills: '61', galagaGhostKills: '140', galagaPerfectParries: '310',
  galagaCritKills: '900', galagaBossesDefeated: '75', galagaMaxComboEver: '150',
  galagaMaxPowerReached: '12', galagaPerfectClears: '48', galagaLastStands: '30',
  galagaUntouchedStages: '55', galagaGoldenClears: '14', galagaBonusWins: '26',
  galagaGameCompleteCount: '5', galagaWishCount: '9', galagaPerfectStreakBest: '11',
  galagaDailyMissionTotal: '95', galagaDailyMissionStreak: '13',
  galagaDailyMissionStreakBest: '31', galagaCallsign: 'KWK',
  galagaStageGrades: '{"S":140,"A":120,"B":90,"C":60,"D":30}',
  galagaKillsByType: '{"bee":9000,"butterfly":6000,"boss":900,"mirror":500,"splitter":400,"shielded":350,"ufo":120,"hoverer":300,"kamikaze":450,"goldenBee":90,"minibee":800,"warper":260}',
  galagaPickupTotals: '{"S":700,"N":600,"P":500,"T":300,"R":320,"W":280,"H":260,"L":150,"B":190,"E":240,"F":170,"D":130}',
  galagaBiomeVisits: '{"planet":30,"ruins":28,"dawn":26,"asteroid":24,"desert":22,"ice":20,"gasGiant":18,"corona":16,"canyon":14,"blackhole":12,"nebula":10,"starfield":8}',
  galagaDeathCauses: '{"bullet":140,"collision":90,"weather":40,"unknown":12}',
  galagaShipsUsed: '["arrow","tank","scout","witch","firebrand"]',
  galagaDifficultiesUsed: '["easy","normal","hard"]',
  galagaBiomesSeen: '["planet","ruins","dawn","asteroid","desert","ice","gasGiant","corona","canyon","blackhole","nebula","starfield"]',
  galagaDailyDays: '["20260801","20260802","20260803","20260804","20260805"]',
  galagaLastRun: '{"stage":97,"score":987654321,"combo":142,"wasPb":true}',
  galagaFlightLog: '[{"d":"08-01","sc":987654321,"st":100,"gr":"S","ca":"BULLET","cs":"KWK","md":"N"},{"d":"08-02","sc":987643210,"st":97,"gr":"A","ca":"COLLISION","cs":"KWK","md":"C"},{"d":"08-03","sc":987632099,"st":94,"gr":"B","ca":"WEATHER","cs":"KWK","md":"D"},{"d":"08-04","sc":987620988,"st":91,"gr":"C","ca":"UNKNOWN","cs":"KWK","md":"N"},{"d":"08-05","sc":987609877,"st":88,"gr":"D","ca":"ABORT","cs":"KWK","md":"C"},{"d":"08-06","sc":987598766,"st":85,"gr":"S","ca":"BULLET","cs":"KWK","md":"D"},{"d":"08-07","sc":987587655,"st":82,"gr":"A","ca":"COLLISION","cs":"KWK","md":"N"},{"d":"08-08","sc":987576544,"st":79,"gr":"B","ca":"WEATHER","cs":"KWK","md":"C"},{"d":"08-09","sc":987565433,"st":76,"gr":"C","ca":"UNKNOWN","cs":"KWK","md":"D"},{"d":"08-10","sc":987554322,"st":73,"gr":"D","ca":"ABORT","cs":"KWK","md":"N"}]',
});

vm.createContext(sandbox);
vm.runInContext(src + `
;globalThis.__g = function(){ return typeof game !== 'undefined' ? game : null; };
;globalThis.__S = function(){ return typeof STATE !== 'undefined' ? STATE : null; };
;globalThis.__pages = function(){ return { help: (typeof HELP_PAGES !== 'undefined' ? HELP_PAGES : 1),
                                            stats: (typeof statsTotalPages === 'function' ? statsTotalPages() : 1) }; };
`, sandbox, { filename: 'game.js' });

const G = sandbox, S = G.__S();

// ---- drive every screen --------------------------------------------------
// A single-frame snapshot per screen MISSES every time-gated banner — the boss
// name card, the stage countdown, transient toasts — which is exactly where the
// longest strings live. (Verified the hard way: an over-long boss name injected
// as a mutation slipped through a one-frame capture.) So each screen is RUN,
// not sampled: update() advances the game's own timers and draw() records every
// frame, so transients get seen.
function capture(label, setup, frames) {
  const g = G.__g();
  currentScreen = label;
  try { setup(g); } catch (e) { /* a screen that cannot be set up shows up as zero draws */ }
  const n = frames || 90;
  for (let i = 0; i < n; i++) {
    recording = true;
    frameNo++;
    try { G.draw(); } catch (e) {
      recording = false;
      console.log('  (draw threw on ' + label + ' frame ' + i + ': ' + e.message + ')');
      break;
    }
    recording = false;
    try { G.update(); } catch (e) { break; }
  }
}

function baseStage(g, stage) {
  g.stage = stage;
  try { G.startStage(); } catch (e) {}
  g.playerAlive = true; g.allEntered = true; g.stageFrames = 400; g.animFrame = 30;
}

G.resetGame();
const pages = G.__pages();

capture('TITLE', g => { g.state = S.TITLE; });
capture('STAGE_INTRO normal', g => { baseStage(g, 25); g.state = S.STAGE_INTRO; }, 200);
// The boss name card is the longest display-size string in the game and it
// only draws on a BOSS stage intro, past the slide-in — the exact case a
// one-frame capture missed.
capture('STAGE_INTRO boss', g => { baseStage(g, 100); g.state = S.STAGE_INTRO; }, 260);
capture('STAGE_INTRO challenge', g => { baseStage(g, 96); g.state = S.STAGE_INTRO; }, 200);
// 300 frames: longer than the 240-frame achievement toast, so transients are
// observed through their full slide-in / hold / slide-out life.
capture('PLAYING s1', g => { baseStage(g, 1); g.state = S.PLAYING; }, 300);
// Power-ups never drop here (the capture does not fire), so the pickup
// sprite went unrendered and unaudited. Seed one of every type.
capture('PLAYING s100', g => {
  baseStage(g, 100); g.state = S.PLAYING; g.score = 999999999; g.combo = 99;
  const types = ['S','N','P','T','R','W','H','L','B','E','F','D'];
  g.powerUps = types.map((ty, i) => ({
    x: 16 + (i % 6) * 38, y: 80 + Math.floor(i / 6) * 40, vy: 0, type: ty
  }));
}, 300);
capture('CHALLENGING', g => { baseStage(g, 96); g.state = S.CHALLENGING; });
capture('BOSS_STAGE', g => { baseStage(g, 100); g.state = S.BOSS_STAGE; });
capture('RESPAWN', g => { baseStage(g, 50); g.state = S.RESPAWN; g.playerAlive = false; });
capture('GAME_OVER', g => {
  baseStage(g, 100); g.state = S.GAME_OVER; g.score = 999999999;
  g.runEpitaph = 'THE VOID REMEMBERS YOUR NAME';
}, 300);
capture('BONUS_GAME', g => { g.state = S.BONUS_GAME; });
for (let p = 0; p < pages.help; p++) {
  capture('PAUSED help p' + p, g => {
    baseStage(g, 50); g.state = S.PAUSED; g.helpOverlay = true; g.statsOverlay = false; g.helpPage = p;
  });
}
for (let p = 0; p < pages.stats; p++) {
  capture('PAUSED stats p' + p, g => {
    baseStage(g, 50); g.state = S.PAUSED; g.helpOverlay = false; g.statsOverlay = true; g.statsAchPage = p;
  });
}

// ---- evaluate under each font configuration ------------------------------
function advanceFor(cfg, size) {
  if (cfg === 'mono') return ADV.mono;
  return size >= PIXEL_DISPLAY_MIN ? ADV.ps2p : ADV.vt323;
}
function bounds(d, cfg) {
  const w = d.text.length * advanceFor(cfg, d.size) * d.size * d.xScale;
  if (d.align === 'left') return [d.x, d.x + w];
  if (d.align === 'right') return [d.x - w, d.x];
  return [d.x - w / 2, d.x + w / 2];
}

if (process.env.LAYOUT_DEBUG) {
  for (const t of (process.env.LAYOUT_DEBUG || '').split('|').filter(Boolean)) {
    const u = draws.filter(d => d.text.indexOf(t) !== -1);
    if (!u.length) { console.log('DEBUG ' + t + ': never drawn'); continue; }
    console.log('DEBUG ' + JSON.stringify(t) + ': ' + u.length + ' draws, x '
      + Math.min(...u.map(d => d.x)).toFixed(1) + '..' + Math.max(...u.map(d => d.x)).toFixed(1)
      + '  screens=' + [...new Set(u.map(d => d.screen))].join(',')
      + '  size=' + u[0].size + ' align=' + u[0].align
      + ' xScale=' + u[0].xScale.toFixed(3) + ' rotated=' + u[0].rotated);
  }
}
if (process.env.VDUMP) {
  const scr = process.env.VDUMP;
  const rows = draws.filter(d => d.screen === scr && !d.rotated);
  const ys = rows.map(d => d.y);
  console.log('VDUMP ' + scr + ': ' + rows.length + ' draws, y '
    + Math.min(...ys).toFixed(1) + '..' + Math.max(...ys).toFixed(1) + ' (playfield 0..288)');
  const deep = [...new Set(rows.filter(d => d.y > 250).map(d => d.y.toFixed(0) + '  ' + JSON.stringify(d.text)))];
  deep.sort();
  for (const t of deep) console.log('   y=' + t);
}
console.log('\n' + '='.repeat(72));
console.log('LAYOUT AUDIT — text overflow across every screen and overlay page');
console.log('='.repeat(72));
console.log('\ncaptured ' + draws.length + ' text draws across '
  + new Set(draws.map(d => d.screen)).size + ' screens\n');

// A string that is momentarily off-screen is usually CORRECT: toasts, intercept
// lines and banners deliberately slide in from outside the playfield, and the
// interceptor terminal scrolls. What is never correct is a string that is
// off-screen in EVERY frame it is ever drawn — that one can never be read.
// So the check is per-string minimum overflow across the whole capture: "was
// this text ever fully visible?" Without this the report is 91 false positives
// deep and instantly worthless.
let totalBad = 0;
for (const cfg of ['mono', 'pixel']) {
  const best = new Map();   // key -> smallest overflow this string ever had
  for (const d of draws) {
    if (!d.text.length) continue;
    // Rotated text sweeps its own box; a horizontal extent check would be
    // meaningless, so it is skipped rather than guessed at.
    if (d.rotated) continue;
    const [l, r] = bounds(d, cfg);
    // A 2px tolerance: glyph side-bearings mean the inked pixels stop short of
    // the advance box, so a hairline over is not visible overflow.
    const over = Math.max(-2 - l, r - (BASE_W + 2), 0);
    // Keyed WITHOUT the screen: a toast or banner is a global HUD element,
    // so "is this string ever fully visible?" is a question about the string,
    // not about the screen that happened to be capturing when it spawned.
    // Keying per-screen reports a transient that started late in one capture
    // as permanently clipped, which is how this tool first cried wolf.
    const key = d.text + ' ' + d.size + ' ' + d.align;
    const prev = best.get(key);
    if (!prev || over < prev.over) best.set(key, { d, l, r, over });
  }
  const bad = [...best.values()].filter(b => b.over > 0);
  bad.sort((a, b) => b.over - a.over);
  const label = cfg === 'mono' ? 'monospace fallback (0.60em)' : 'pixel faces (0.40em / 1.00em display)';
  console.log('-- ' + label + ' --');
  if (!bad.length) {
    console.log('   ok  every text draw fits inside the 224px playfield\n');
  } else {
    totalBad += bad.length;
    console.log('   ' + bad.length + ' string(s) NEVER fully visible:');
    for (const b of bad.slice(0, 20)) {
      console.log('     +' + b.over.toFixed(1) + 'px  [' + b.d.screen + '] size ' + b.d.size
        + ' ' + b.d.align + '  ' + JSON.stringify(b.d.text.slice(0, 46)));
    }
    if (bad.length > 20) console.log('     ... and ' + (bad.length - 20) + ' more');
    console.log('');
  }
}

// VERTICAL BOUNDS — the horizontal check above cannot see a panel whose rows
// have grown past the bottom of the screen. Same 'ever fully visible' rule.
{
  const bestV = new Map();
  for (const d of draws) {
    if (!d.text.length || d.rotated) continue;
    // textBaseline is 'middle' throughout this game, so the glyph box is
    // centred on y with height approximately the font size.
    const half = d.size * 0.5 * (d.xScale || 1);
    const over = Math.max(-2 - (d.y - half), (d.y + half) - (BASE_H + 2), 0);
    const key = d.text + ' ' + d.size;
    const prev = bestV.get(key);
    if (!prev || over < prev.over) bestV.set(key, { d, over });
  }
  const badV = [...bestV.values()].filter(b => b.over > 0).sort((a, b) => b.over - a.over);
  console.log('-- vertical bounds (0..' + BASE_H + 'px) --');
  if (!badV.length) {
    console.log('   ok  every string sits inside the playfield vertically\n');
  } else {
    totalBad += badV.length;
    console.log('   ' + badV.length + ' string(s) never vertically visible:');
    for (const b of badV.slice(0, 20)) {
      console.log('     +' + b.over.toFixed(1) + 'px  [' + b.d.screen + '] y='
        + b.d.y.toFixed(0) + ' size ' + b.d.size + '  ' + JSON.stringify(b.d.text.slice(0, 40)));
    }
    console.log('');
  }
}

// OVERLAP (opt-in: OVERLAP=1) - two different strings drawn on top of each
// other in the same frame. NOT a gate: overlay panels legitimately cover the
// HUD and full-width banners legitimately sweep across it, so the residual
// false-positive rate is too high to fail a build on. It is kept because it
// earns its keep as a probe - it found two real collisions (the GAME OVER
// title against the pilot label, and the combo decay countdown against the
// combo tier name), neither of which any other check can see.
// Original note: two different strings drawn on top of each other in the same
// frame. Identical text is skipped (glow/shadow passes redraw the same
// string at the same spot) and a graze is not enough: the intersection has
// to cover most of the smaller box before it counts as a collision.
if (process.env.OVERLAP) {
  const byFrame = new Map();
  for (const d of draws) {
    if (!d.text.trim() || d.rotated) continue;
    if (!byFrame.has(d.frame)) byFrame.set(d.frame, []);
    byFrame.get(d.frame).push(d);
  }
  const seen = new Map();
  for (const [, list] of byFrame) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.text === b.text) continue;
        const [al, ar] = bounds(a, 'pixel');
        const [bl, br] = bounds(b, 'pixel');
        const capOf = d => (d.size >= PIXEL_DISPLAY_MIN ? 0.875 : 0.560);
        const ah = a.size * capOf(a) * 0.5 * (a.xScale || 1);
        const bh = b.size * capOf(b) * 0.5 * (b.xScale || 1);
        const ox = Math.min(ar, br) - Math.max(al, bl);
        const oy = Math.min(a.y + ah, b.y + bh) - Math.max(a.y - ah, b.y - bh);
        if (ox <= 0 || oy <= 0) continue;
        const areaA = Math.max(1, (ar - al) * ah * 2);
        const areaB = Math.max(1, (br - bl) * bh * 2);
        const frac = (ox * oy) / Math.min(areaA, areaB);
        if (frac < 0.55) continue;
        const key = [a.text, b.text].sort().join(' | ');
        const prev = seen.get(key);
        if (!prev || frac > prev.frac) seen.set(key, { frac, screen: a.screen });
      }
    }
  }
  const bad = [...seen.entries()].sort((x, y) => y[1].frac - x[1].frac);
      console.log('-- text overlap --');
  if (!bad.length) {
    console.log('   ok  no two strings collide\n');
  } else {
    console.log('   ' + bad.length + ' colliding pair(s) [informational]:');
    for (const [k, v] of bad.slice(0, 15)) {
      console.log('     ' + Math.round(v.frac * 100) + '%  [' + v.screen + ']  ' + k);
    }
    console.log('');
  }
}

if (totalBad) {
  console.log('RESULT: ' + totalBad + ' string(s) never fully visible - see above.\n');
  process.exit(1);
}
console.log('RESULT: no text overflows in any font configuration.\n');
process.exit(0);
