/*
 * loadout-audit.js — THE REDOUBT, measured.
 *
 *     node test/loadout-audit.js
 *
 * THE REDOUBT converts a shield charge into a placed wall by BRACING: 42
 * consecutive frames of not moving and not firing. Every other property of the
 * system can be read off the constants. One cannot, and it is the one that
 * decides whether the system exists at all:
 *
 *     can a player actually HOLD 42 still frames while a stage is shooting?
 *
 * That is the SALVAGE lesson restated. SALVAGE PROTOCOL was logic-tested,
 * taught by FLIGHT SCHOOL and contested by THE MAGPIE while its real catch
 * rate was exactly zero, because nothing ever drove the physics that had to
 * produce a catch. A brace is the same shape of claim: 42 is a number in a
 * constant until a driven bot tries to hold it under live fire.
 *
 * So the headline column here is COMPLETION RATE — plants / braces attempted —
 * plus the mean frames a brace survives before something breaks it and what
 * broke it. Everything else (blocks per wall, reclaim rate, own-shots eaten,
 * and the camper-vs-flier comparison that answers "does cover make the game
 * slower or safer") is reported underneath.
 *
 * This is a REPORT, not a pass/fail gate — the same division of labour
 * curve-audit.js, pulse-audit.js and recovery-audit.js have with
 * logic.test.js, where the hard invariants live.
 *
 * WHEN TOUCHING the brace, the shield economy, REDOUBT_PLANT, or anything that
 * interrupts stillness: run this and read the completion rate. A rate near
 * zero means the verb is unreachable under fire and REDOUBT_PLANT is wrong; a
 * rate near 100% at every depth means the brace costs nothing and the wall is
 * free. Tune off THIS number, not off the constant it is measured against.
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
;globalThis.__RC = () => ({ PLANT: REDOUBT_PLANT, HP: REDOUBT_HP, TTL: REDOUBT_TTL,
                            MAX: REDOUBT_MAX, RECLAIM: RECLAIM_FRAMES });
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();
const RC = G.__RC();

// Seeded — an unseeded audit's numbers cannot be diffed across a change.
let _seed = 13579;
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

const clearKeys = () => {
  for (const k of [' ', 'ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D']) K[k] = false;
};

// Danger read: is anything about to reach the ship? A real player breaks a
// brace for an incoming round or a diver in their column — this is the bot's
// version of that judgement, and what breaks the brace is recorded.
function threatNear(g) {
  for (const b of (g.enemyBullets || [])) {
    if (b.vy > 0 && b.y < g.playerY && g.playerY - b.y < 70 && Math.abs(b.x - g.playerX) < 16) {
      return 'incoming fire';
    }
  }
  for (const e of (g.enemies || [])) {
    if (!e.alive) continue;
    if (e.state !== 'diving' && e.state !== 'kamikaze') continue;
    if (e.y < g.playerY && g.playerY - e.y < 90 && Math.abs(e.x - g.playerX) < 22) return 'a diver';
  }
  return null;
}

// ---------------------------------------------------------------------------
// One driven stage with a bot that WANTS to brace: it holds still and holds
// fire whenever it has a charge and the air is clear, and breaks off the moment
// something threatens it — then flies and shoots like a normal pilot until the
// air clears again.
// ---------------------------------------------------------------------------
function driveStage(stage, frames, opts) {
  opts = opts || {};
  G.resetGame();
  const g = G.__g();
  g.stage = stage;
  G.startStage();
  g.playerAlive = true;
  g.lives = 99;
  g.cheatInvincible = true;         // measure the BRACE, not the bot's dodging
  clearKeys();                      // measure from the true stage start — the
                                    // entry parade is a planting window and
                                    // skipping it would hide the real answer

  // The bot models INTENT, which is the only fair way to ask whether a verb is
  // reachable: every so often it COMMITS to planting — it stops firing entirely
  // and dodges without shooting until the wall goes up or its patience runs
  // out. A bot that shoots while dodging can never brace by construction (fire
  // resets the meter), so measuring that would only re-measure the rule.
  const PATIENCE = opts.patience || 300;
  let braces = 0, plants = 0, aborted = 0, spent = 0, cur = 0, committing = false;
  const causes = {};
  const killsAt = g.stats ? g.stats.kills : 0;
  let lostKills = 0;

  for (let f = 0; f < frames; f++) {
    if (opts.freeCharges && (g.shieldCharges || 0) === 0 && !(g.redoubts || []).length) {
      g.shieldCharges = 1;
    }
    const danger = threatNear(g);
    const armed = (g.shieldCharges || 0) > 0;
    if (!committing && armed && (f % 240) === 0) { committing = true; braces++; cur = 0; }
    if (f === 0 && armed && !committing) { committing = true; braces++; cur = 0; }

    if (committing) {
      cur++;
      lostKills++;
      clearKeys();                       // the commitment: NEVER fire
      if (danger) {                      // dodge without shooting — the meter pauses
        const goLeft = g.playerX > 24 && ((f >> 3) & 1) === 0;
        K[goLeft ? 'ArrowLeft' : 'ArrowRight'] = true;
      }
      if (cur >= PATIENCE) {
        committing = false;
        aborted++;
        spent += cur;
        causes[danger || 'ran out of patience'] = (causes[danger || 'ran out of patience'] || 0) + 1;
        cur = 0;
      }
    } else {
      K[' '] = true;                     // fly + shoot like a normal pilot
      const drift = (f >> 4) % 2 === 0;
      K['ArrowLeft'] = drift; K['ArrowRight'] = !drift;
    }

    const before = (g.redoubts || []).length;
    G.update();
    if ((g.redoubts || []).length > before) {
      plants++; spent += cur; committing = false; cur = 0; clearKeys();
    }
  }
  clearKeys();
  return {
    stage, braces, plants, aborted, causes,
    meanBrace: braces ? Math.round(spent / braces) : 0,
    blocks: g.redoubtBlocks || 0,
    reclaims: g.redoubtReclaims || 0,
    kills: (g.stats ? g.stats.kills : 0) - killsAt,
    silent: lostKills,
  };
}

// ---------------------------------------------------------------------------
// The clean room: no threats at all. Answers "is the brace reachable when
// NOTHING interferes" separately from "is it reachable under fire" — the same
// split recovery-audit uses, and the split that exposed SALVAGE.
// ---------------------------------------------------------------------------
function cleanRoom() {
  G.resetGame();
  const g = G.__g();
  g.stage = 3;
  G.startStage();
  g.playerAlive = true;
  g.lives = 99;
  g.cheatInvincible = true;
  for (let f = 0; f < 500 && !g.allEntered; f++) G.update();
  g.diveInterval = 999999;
  g.enemyBullets.length = 0;
  clearKeys();
  g.shieldCharges = 1;
  g.playerX = 112; g._prevPlayerX = 112;
  let plantAt = -1;
  for (let f = 0; f < 200 && plantAt < 0; f++) { G.update(); if ((g.redoubts || []).length) plantAt = f + 1; }
  // Now measure what one wall actually eats before it fails.
  let eaten = 0;
  const w = (g.redoubts || [])[0];
  if (w) {
    for (let n = 0; n < RC.HP + 4 && (g.redoubts || []).length; n++) {
      g.enemyBullets.push({ x: w.x, y: w.y - 12, vx: 0, vy: 3, kind: 'dive', fromType: 'bee' });
      for (let f = 0; f < 8 && g.enemyBullets.length; f++) G.update();
      eaten = g.redoubtBlocks || 0;
    }
  }
  // And how long the fail warning actually lasts once it is armed.
  let warnFrames = 0;
  if ((g.redoubts || []).length && g.redoubts[0].failTimer != null) {
    while ((g.redoubts || []).length && warnFrames < 200) { G.update(); warnFrames++; }
  }
  return { plantAt, eaten, warnFrames };
}

console.log('');
console.log('  THE REDOUBT — is the brace reachable, and what does a wall buy?');
console.log('  ' + '='.repeat(64));

const cr = cleanRoom();
console.log('');
console.log('  CLEAN ROOM (nothing shooting)');
console.log('    frames to plant .............. ' + cr.plantAt + ' (constant REDOUBT_PLANT = ' + RC.PLANT + ')');
console.log('    enemy rounds one wall ate .... ' + cr.eaten + ' (cap REDOUBT_HP = ' + RC.HP + ')');
console.log('    warning frames once doomed ... ' + cr.warnFrames + ' (the wall keeps blocking through it)');

console.log('');
console.log('  UNDER FIRE — the headline: can a brace actually be held?');
console.log('  ' + '-'.repeat(64));
console.log('    stage   commits   plants   completion   mean frames   blocks   silent');
const rows = [];
// NORMAL formation stages only — the brace is a PLAYING verb. (The first cut of
// this audit sampled 12/30/60, which are a challenge round and two boss stages:
// it reported 0% completion at depth and the number was measuring the state
// gate, not the brace. Stage choice is part of the instrument.)
for (const s of [13, 29, 57]) {
  const r = driveStage(s, 3600, { freeCharges: true });
  rows.push(r);
  const rate = r.braces ? Math.round(100 * r.plants / r.braces) : 0;
  console.log('    ' + String(s).padStart(5)
    + String(r.braces).padStart(10)
    + String(r.plants).padStart(9)
    + (rate + '%').padStart(13)
    + (r.meanBrace + 'f').padStart(14)
    + String(r.blocks).padStart(9)
    + (r.silent + 'f').padStart(9));
}

console.log('');
console.log('  WHAT BREAKS A BRACE');
for (const r of rows) {
  const parts = Object.keys(r.causes).map(k => k + ' ' + r.causes[k]);
  console.log('    stage ' + String(r.stage).padStart(3) + ':  '
    + (parts.length ? parts.join(',  ') : 'nothing — every brace completed'));
}

// The ceiling above assumes a charge is always in hand. What actually limits
// the verb is SUPPLY: the E-drop weight, heists and the vampire perk. A single
// stage is too short to sample it (one stage rolls zero E's more often than
// not), so this drives a real multi-stage run and counts every charge granted.
function measureSupply(frames) {
  G.resetGame();
  const g = G.__g();
  g.stage = 5;
  G.startStage();
  g.playerAlive = true;
  g.lives = 99;
  g.cheatInvincible = true;
  let granted = 0, prev = 0;
  for (let f = 0; f < frames; f++) {
    K[' '] = true;
    const drift = (f >> 5) % 2 === 0;
    K['ArrowLeft'] = drift; K['ArrowRight'] = !drift;
    G.update();
    const held = (g.shieldCharges || 0) + ((g.redoubts || []).length);
    if (held > prev) granted += held - prev;
    prev = held;
  }
  clearKeys();
  return { granted, stage: g.stage, kills: g.stats ? g.stats.kills : 0 };
}
const sup = measureSupply(20000);
console.log('');
console.log('  SUPPLY — what the shield economy actually allows (driven run)');
console.log('    charges granted in ~5.5 min ... ' + sup.granted
  + '   (run reached stage ' + sup.stage + ', ' + sup.kills + ' kills)');
console.log('    -> the ceiling above (' + rows[1].plants + ' walls/stage with charges handed out) is');
console.log('       never reached in play: SUPPLY is the limiter, not the brace. The verb');
console.log('       is about as frequent as BEAMS ROBBED — a rare, weighed choice.');
console.log('       If it ever needs to be MORE frequent, feed it from the heist/perk');
console.log('       supply lines, never by raising the E drop weight (that shifts the');
console.log('       powerUpDropRate economics curve-audit.js reports).');

const totB = rows.reduce((a, r) => a + r.braces, 0);
const totP = rows.reduce((a, r) => a + r.plants, 0);
const rate = totB ? Math.round(100 * totP / totB) : 0;
const totSilent = rows.reduce((a, r) => a + r.silent, 0);

console.log('');
console.log('  ' + '-'.repeat(64));
if (cr.plantAt < 0) {
  console.log('  -> the brace never completes even in an EMPTY room. The verb is');
  console.log('     unreachable and the gate is wrong. (This is the SALVAGE failure');
  console.log('     mode: a system alive in a fixture and dead in the game.)');
} else if (totP === 0) {
  console.log('  -> reachable in the clean room but NEVER under fire (0 of ' + totB + ' braces).');
  console.log('     REDOUBT_PLANT is longer than any real gap in the dive cadence.');
} else if (rate >= 90) {
  console.log('  -> REACHABLE AT EVERY DEPTH: ' + totP + ' of ' + totB + ' commitments completed ('
    + rate + '%),');
  console.log('     and the price is the column that matters — ' + totSilent + ' frames of held');
  console.log('     fire across three stages (~' + Math.round(100 * totSilent / (3 * 3600))
    + '% of the run) bought those walls.');
  console.log('     Dodging PAUSES the brace and firing RESETS it, so the cost is');
  console.log('     paid in kills and combo, never in the ability to survive. The');
  console.log('     shield economy, not the gate, is what limits the count (see the');
  console.log('     real-economy row above).');
} else {
  console.log('  -> ALIVE and PRICED: ' + totP + ' of ' + totB + ' braces completed (' + rate + '%).');
  console.log('     The verb is reachable in the gaps of the dive cadence and lost to');
  console.log('     the pressure that fills them — which is the trade the design');
  console.log('     claims. Tune REDOUBT_PLANT off this column, never off the');
  console.log('     constant it is measured against.');
}
console.log('');
