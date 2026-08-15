/*
 * recovery-audit.js — THE RECOVERY BUDGET, measured.
 *
 *     node test/recovery-audit.js
 *
 * Death wipes the whole S/N/P build to 1/1/1 — the classic arcade death
 * spiral: the weaker ship makes the next death likelier. SALVAGE PROTOCOL is
 * the designed counterplay — shards of the lost build scatter from the wreck,
 * catch one and an axis recovers. Its planner is logic-tested, its lesson is
 * taught by FLIGHT SCHOOL, and its loot is contested by THE MAGPIE.
 *
 * What nothing ever measured was whether a shard is ever actually CAUGHT.
 *
 * The answer was ZERO. Not low — zero, in every band, at every difficulty,
 * and structurally rather than by bad tuning: `playerY` is a CONSTANT
 * (BASE_H - 28). The player has no vertical movement, so the only y a shard
 * can ever be caught at is that one line. A shard popped out of the wreck,
 * fell back through that line during frames ~75-105 — entirely inside the
 * 90-120f RESPAWN where `playerAlive` is false — then dropped below a ship
 * that cannot descend, and fizzled off the bottom of the screen at barely
 * half its own TTL. The suite stayed green the whole time because its shard
 * tests HAND-PLACED shards inside the catch band, teleporting them past the
 * physics that made every real catch impossible.
 *
 * The fix (salvageStep, pure): a falling shard SETTLES into the player's lane
 * and patrols it. Recovery becomes the one verb this player actually has — a
 * horizontal race — and it stays priced: chasing means leaving your dodge
 * lane (the one THE SWARM MIND profiles), and a shard that patrols long
 * enough is exactly the neglected loot THE MAGPIE contests.
 *
 * This is a REPORT, not a pass/fail gate — the same division of labour
 * curve-audit.js and pulse-audit.js have with logic.test.js, where the hard
 * invariants live. It MEASURES driven play rather than restating constants,
 * because both the constants and the comments were true while the system was
 * dead ("outlives the 90f respawn cutscene" — it did; it outlived the clock
 * and not the lane).
 *
 * WHEN TOUCHING death, respawn, shard physics, TTLs, or the magpie: run this
 * and read three numbers — catchable-after-respawn must stay near 100%, the
 * driven catch rate must stay well off zero, and recovered/lost must stay a
 * SOFTENER (never 100%; death has to keep hurting).
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
;globalThis.__plan = (l, m) => salvageShardPlan(l, m);
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();

// Seeded — an unseeded audit's numbers cannot be diffed across a change.
let _seed = 24680;
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const lsum = g => (g.lvl ? (g.lvl.S || 1) + (g.lvl.N || 1) + (g.lvl.P || 1) : 3);

// ---------------------------------------------------------------------------
// The clean-room measurement: one death with a full build, nothing interfering.
// Answers the structural question — is the shard catchable AT ALL after the
// respawn — separately from the melee of a full session.
// ---------------------------------------------------------------------------
function cleanRoom() {
  G.resetGame();
  const g = G.__g();
  g.stage = 12;
  G.startStage();
  g.state = ST.PLAYING;
  g.playerAlive = true;
  g.lives = 5;
  g.lvl = { S: 5, N: 3, P: 3 };
  g.shieldCharges = 0;
  const laneY = g.playerY;
  G.killPlayer(g.playerX, g.playerY, 'bullet', 'bee');
  g.cheatInvincible = true;                 // nothing may re-kill mid-measurement
  const spawned = (g.salvageShards || []).length;
  let bandDead = 0, bandAlive = 0, backFrame = -1;
  for (let f = 0; f < 400 && (g.salvageShards || []).length; f++) {
    G.update();
    if (g.playerAlive && backFrame < 0) backFrame = f;
    for (const s of g.salvageShards || []) {
      if (Math.abs(s.y - laneY) < 10) { if (g.playerAlive) bandAlive++; else bandDead++; }
    }
    // Chase with the only verb the player has: horizontal movement.
    const t = (g.salvageShards || [])[0];
    if (g.playerAlive && t) {
      K['ArrowLeft'] = t.x < g.playerX - 2;
      K['ArrowRight'] = t.x > g.playerX + 2;
    }
  }
  K['ArrowLeft'] = false; K['ArrowRight'] = false;
  g.cheatInvincible = false;
  return { spawned, caught: g.salvageCount || 0, bandDead, bandAlive, backFrame,
           recovered: lsum(g) - 3 };
}

// ---------------------------------------------------------------------------
// A full driven session: deaths under fire, shards contested by everything.
// ---------------------------------------------------------------------------
function session(startStage, frames) {
  G.resetGame();
  const g = G.__g();
  g.stage = startStage;
  G.startStage();
  g.playerAlive = true;
  g.lives = 999;

  let deaths = 0, prevLives = g.lives;
  let lostLevels = 0, lvlLive = 3;
  let spawned = 0, prevN = 0, caught = 0, prevC = 0;
  let backToBack = 0, lastDeathF = -99999;
  const traj = new Map();
  let lastBack = -99999;

  for (let f = 0; f < frames; f++) {
    K['ArrowLeft']  = (f % 190) < 80;
    K['ArrowRight'] = (f % 190) >= 120;
    K[' ']          = (f % 7) < 3;
    if (g.hitStopFrames > 0) { g.hitStopFrames--; g.animFrame++; }
    else G.update();

    const n = (g.salvageShards || []).length;
    if (n > prevN) spawned += n - prevN;
    prevN = n;
    if ((g.salvageCount || 0) > prevC) { caught += (g.salvageCount || 0) - prevC; prevC = g.salvageCount || 0; }

    if (g.lives < prevLives) {
      deaths++;
      lostLevels += lvlLive - 3;
      if (f - lastDeathF < 430) backToBack++;   // within ~7s of the previous death
      lastDeathF = f;
      prevLives = g.lives;
    }
    if (g.playerAlive && g.state !== ST.RESPAWN) {
      lvlLive = lsum(g);
      const since = f - lastBack;
      if (since >= 0 && since < 600) {
        const b = Math.floor(since / 120) * 120;
        if (!traj.has(b)) traj.set(b, []);
        traj.get(b).push(lsum(g));
      }
    }
    if (g.state === ST.RESPAWN && g.respawnTimer === 1) lastBack = f + 1;
  }
  return { stage: startStage, deaths, backToBack, spawned, caught, lostLevels, traj };
}

// ---------------------------------------------------------------------------
console.log('\n============================================================');
console.log('  THE RECOVERY BUDGET — does the death spiral have a brake?');
console.log('============================================================');

console.log('\n  CLEAN ROOM — one death, full build, nothing else interfering');
console.log('  ' + '-'.repeat(58));
const cr = cleanRoom();
console.log('  shards scattered           : ' + cr.spawned);
console.log('  player back in control at  : frame ' + cr.backFrame);
console.log('  shard-frames in the catch band while DEAD  : ' + cr.bandDead);
console.log('  shard-frames in the catch band while ALIVE : ' + cr.bandAlive
  + (cr.bandAlive === 0 ? '   <- UNREACHABLE BY CONSTRUCTION' : ''));
console.log('  caught by pure horizontal chase            : ' + cr.caught + ' of ' + cr.spawned);
console.log('  levels recovered                           : ' + cr.recovered);

console.log('\n  DRIVEN SESSIONS — deaths under fire (3 min per band)');
console.log('  ' + '-'.repeat(58));
console.log('  band  deaths  <7s-repeat  shards spawned/caught  recovered/lost');
let totCaught = 0, totSpawned = 0;
const sessions = [];
for (const st of [1, 9, 23, 47]) {
  const r = session(st, 10800);
  sessions.push(r);
  totCaught += r.caught; totSpawned += r.spawned;
  console.log('  ' + String(st).padStart(4) + '  ' + String(r.deaths).padStart(6)
    + '  ' + String(r.backToBack).padStart(10)
    + '  ' + (r.spawned + '/' + r.caught).padStart(21)
    + '  ' + (r.caught + '/' + r.lostLevels).padStart(14));
}

console.log('\n  POWER AFTER A RESPAWN — mean S+N+P (base 3, max 11), by seconds back');
console.log('  ' + '-'.repeat(58));
for (const r of sessions) {
  const ks = [...r.traj.keys()].sort((a, b) => a - b).slice(0, 5);
  if (!ks.length) continue;
  console.log('  stage ' + String(r.stage).padStart(3) + '  ' + ks.map(k => {
    const a = r.traj.get(k);
    return (k / 60) + 's:' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  }).join('  '));
}

console.log('\n  THE PLANNER — how much of a build scatters (cap by difficulty)');
console.log('  ' + '-'.repeat(58));
for (const [name, lvl] of [['mid 3/2/2', { S: 3, N: 2, P: 2 }],
                           ['maxed 5/3/3', { S: 5, N: 3, P: 3 }]]) {
  const lost = (lvl.S - 1) + (lvl.N - 1) + (lvl.P - 1);
  const row = ['easy', 'normal', 'hard'].map(m => {
    const p = G.__plan(lvl, m);
    return m + ' [' + p.join('') + '] ' + Math.round(100 * p.length / lost) + '%';
  }).join('   ');
  console.log('  ' + name.padEnd(13) + row);
}

console.log('\n  ' + '-'.repeat(58));
if (cr.bandAlive === 0) {
  console.log('  -> the shard NEVER coexists with a live player in the only band');
  console.log('     the player can reach. The system is dead. (This was the shipped');
  console.log('     state for its entire life: catch rate exactly zero.)');
} else if (totSpawned > 0 && totCaught === 0) {
  console.log('  -> reachable in the clean room but never caught under fire — the');
  console.log('     TTL or the drift is mistuned for real play. Investigate.');
} else {
  console.log('  -> ALIVE. The shard settles into the player\'s lane and survives to');
  console.log('     be raced for (' + totCaught + '/' + totSpawned + ' caught under fire). Recovery stays a');
  console.log('     SOFTENER: the planner caps it below what death takes, so the');
  console.log('     spiral is braked, not cancelled.');
}
console.log('');
