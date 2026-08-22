// How much incoming fire is actually on screen? A 40-enemy wall that never fires
// is decorative pressure — this counts what the player is really dodging.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = 'D:/workspace_claude/my-galaga';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const noop = () => {};
const px = new Proxy({}, { get: () => () => px, set: () => true });
const audioNode = new Proxy({}, { get: () => () => audioNode, set: () => true });
const AC = () => new Proxy({ currentTime: 0, sampleRate: 44100, destination: audioNode },
  { get: (t, p) => (p in t ? t[p] : () => audioNode), set: () => true });
const store = {};
let _seed = 0x2f6e2b1;
const rnd = () => { _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5; return ((_seed >>> 0) % 1000000) / 1000000; };
const SM = Object.create(Math); SM.random = rnd;
const sandbox = {
  console, Math: SM, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  Float32Array, Uint8Array,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, clear: noop },
  document: { getElementById: () => px, createElement: () => px, querySelector: () => px, querySelectorAll: () => [], addEventListener: noop, body: px, documentElement: px, hidden: false },
  AudioContext: AC, webkitAudioContext: AC,
  navigator: { getGamepads: () => [], vibrate: noop, userAgent: 'node', maxTouchPoints: 0 },
  performance: { now: () => 0 },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
sandbox.window.innerWidth = 224; sandbox.window.innerHeight = 288; sandbox.window.devicePixelRatio = 1;
vm.createContext(sandbox);
vm.runInContext(script + ';globalThis.__g=()=>game;globalThis.__k=()=>keys;', sandbox, { filename: 'game.js' });
const G = sandbox, K = G.__k();

function probe(stage, frames, seed) {
  _seed = seed;
  G.resetGame();
  const g = G.__g();
  g.stage = stage;
  G.startStage();
  g.playerAlive = true; g.lives = 999; g.cheatInvincible = true;
  for (let f = 0; f < 900 && !g.allEntered; f++) G.update();
  for (const k of [' ', 'ArrowLeft', 'ArrowRight']) K[k] = false;
  let sumInFlight = 0, spawned = 0, prev = 0, framesWithNone = 0, peak = 0;
  let enemySum = 0;
  // ATTRIBUTABLE, and it has to be. The volley consumes randInt(), so every roll
  // downstream of it lands differently and a before/after run is not the same
  // game — six seeds reduce the variance but cannot remove the divergence. These
  // two counters need no baseline: they measure what the volley ITSELF put on
  // screen, and how many frames it filled that would otherwise have held nothing.
  let volleySum = 0, volleyFired = 0, prevVolley = 0, filledFrames = 0;
  for (let f = 0; f < frames; f++) {
    // THE BOT DOES NOT SHOOT. The first cut of this held fire and cleared the
    // wall, so it reported a mean of 7.9 live enemies out of 40 — it was measuring
    // a stage in its MOP-UP phase, where of course nothing is coming at you. The
    // question is what pressure an intact formation applies, so the wall stays up
    // and the bot only weaves.
    K[' '] = false;
    K['ArrowRight'] = ((f >> 6) & 1) === 0;
    K['ArrowLeft'] = ((f >> 6) & 1) === 1;
    G.update();
    const all = (g.enemyBullets || []);
    const n = all.length;
    if (n > prev) spawned += n - prev;
    prev = n;
    sumInFlight += n;
    peak = Math.max(peak, n);
    if (n === 0) framesWithNone++;
    let vn = 0;
    for (const b of all) if (b.kind === 'volley') vn++;
    if (vn > prevVolley) volleyFired += vn - prevVolley;
    prevVolley = vn;
    volleySum += vn;
    if (vn > 0 && n === vn) filledFrames++;   // the screen held ONLY volley fire
    enemySum += (g.enemies || []).filter(e => e.alive).length;
  }
  for (const k of [' ', 'ArrowLeft', 'ArrowRight']) K[k] = false;
  return {
    stage,
    mean: (sumInFlight / frames).toFixed(2),
    peak,
    perMin: Math.round(spawned / (frames / 3600)),
    emptyPct: Math.round(100 * framesWithNone / frames),
    meanEnemies: (enemySum / frames).toFixed(1),
    volleyMean: (volleySum / frames).toFixed(2),
    volleyPerMin: Math.round(volleyFired / (frames / 3600)),
    filledPct: Math.round(100 * filledFrames / frames),
  };
}

console.log('');
console.log('  HOW MUCH IS ACTUALLY COMING AT YOU?');
console.log('  ' + '='.repeat(64));
// SIX SEEDS PER STAGE, AVERAGED. One seed measures a single game, and the
// formation variant, the stage mutation and every dive roll differ between runs
// — the first cut of this reported stage 3 going from 84% empty to 73% and then
// to 83% under a change that could only ever ADD bullets. That was variance,
// not an effect, and tuning on it would have been tuning on noise.
const SEEDS = [1, 12345, 0x2f6e2b1, 777333, 99991, 424242];
const vol = [];
console.log('    stage   live enemies   bullets on screen   peak   spawned/min   frames w/ NONE');
for (const s of [3, 7, 13, 33, 57, 99]) {
  let mean = 0, peak = 0, perMin = 0, empty = 0, enemies = 0;
  let vMean = 0, vPerMin = 0, filled = 0;
  for (const sd of SEEDS) {
    const r = probe(s, 7000, sd ^ (s * 7919));
    mean += parseFloat(r.mean); peak = Math.max(peak, r.peak);
    perMin += r.perMin; empty += r.emptyPct; enemies += parseFloat(r.meanEnemies);
    vMean += parseFloat(r.volleyMean); vPerMin += r.volleyPerMin; filled += r.filledPct;
  }
  const k = SEEDS.length;
  console.log('    ' + String(s).padStart(5) + (enemies / k).toFixed(1).padStart(15)
    + (mean / k).toFixed(2).padStart(20) + String(peak).padStart(7)
    + String(Math.round(perMin / k)).padStart(14)
    + (Math.round(empty / k) + '%').padStart(17));
  vol.push({ s, vMean: vMean / k, vPerMin: Math.round(vPerMin / k), filled: Math.round(filled / k) });
}
console.log('');
console.log('  WHAT THE WALL ITSELF PUT THERE — attributable, so it needs no baseline');
console.log('  ' + '-'.repeat(64));
console.log('    stage   volley bullets on screen   volleys/min   frames held by volley ALONE');
for (const v of vol) {
  console.log('    ' + String(v.s).padStart(5) + v.vMean.toFixed(2).padStart(24)
    + String(v.vPerMin).padStart(14) + (v.filled + '%').padStart(28));
}
console.log('');
console.log('  BASELINE, before THE FIRING LINE — same six seeds, same intact wall:');
console.log('     stage  3:  0.95 on screen, 25% of frames EMPTY   (now 1.93 /  3%)');
console.log('     stage  7:  2.14 on screen, 15% EMPTY             (now 3.01 /  3%)');
console.log('     stage 13:  4.10 on screen,  2% EMPTY             (now 4.90 /  2%)');
console.log('     stage 33:  4.68 on screen,  3% EMPTY             (now 5.21 /  3%)');
console.log('  The floor rose where the game was empty and barely moved where it was');
console.log('  already full: +103% at stage 3, +11% at stage 33. That is the shape a');
console.log('  FLOOR has. A difficulty multiplier would have lifted the deep end too,');
console.log('  which is the trade THE DEEP PRESSURE LADDER forbids.');
console.log('  A formation member sitting in the wall never fired: all thirteen');
console.log('  enemyBullets.push sites belonged to a DIVING enemy, the hoverer, the');
console.log('  mirror, the rival, a mega-boss, a bullet split or an elite death burst.');
console.log('  Forty enemies were decoration, and parking under them was optimal play.');
console.log('');
