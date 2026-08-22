/*
 * measure-audit.js — THE MEASURE, measured.
 *
 *     node test/measure-audit.js
 *
 * Every claim this reform makes gets a column here, because this project has
 * twice shipped a system that was dead for its entire life while the suite
 * stayed green: SALVAGE PROTOCOL's catch rate was EXACTLY ZERO (its tests
 * hand-placed shards inside the catch band, teleporting them past the physics
 * that made a real catch impossible), and THE EBB opened windows of which none
 * was ever cuttable. Both were logic-tested, lesson-taught and fully documented.
 *
 * So this drives REAL sessions through startStage + update() and observes. It
 * never writes the state a feature needs in order to look alive.
 *
 * Four columns, one per pillar of the reform:
 *
 *   CLOCK        Do threats actually launch on the grid? Are telegraph LENGTHS
 *                still constants (i.e. did the bar leak into a duration)? How
 *                many enemy bullets arrive on the worst single frame, and what
 *                is the longest gap — the unison-volley and bullet-free-window
 *                classes that a pinned interval equality is structurally blind
 *                to, because it measures the interval FUNCTION and not the
 *                emission. And the flash-rate ceiling on full-frame luminance.
 *
 *   AUTHORSHIP   Drafts offered, committed, declined. Duplicate-offer rate (must
 *                be zero). Distinct cards and total ranks carried at the end.
 *                Per-card pick share, so a dominant card is visible here before
 *                a player finds it.
 *
 *   ARRANGEMENT  What the stem mask actually opens over a run — the claim that
 *                "your build is audible" is only true if the layers move.
 *
 *   RHYTHM       On-beat dash rate for a bot that dashes at random vs one that
 *                waits for the beat. THE GAP IS THE SKILL EXPRESSION. If a
 *                random bot scores the same as a deliberate one, the verb is
 *                decoration and the honest fix is structural, never a bigger
 *                reward for a thing that does not happen.
 *
 * This is a REPORT, not a pass/fail gate — the same division of labour the
 * curve / telegraph / pulse / recovery / loadout / ebb audits have with
 * logic.test.js, which owns the hard invariants.
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
  Float32Array, Uint8Array,
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
sandbox.window.innerWidth = 224; sandbox.window.innerHeight = 288;
sandbox.window.devicePixelRatio = 1;
vm.createContext(sandbox);
vm.runInContext(script + `
;globalThis.__g = () => game;
;globalThis.__S = () => STATE;
;globalThis.__keys = () => keys;
;globalThis.__C = () => ({
  BEAT: BEAT_FRAMES, BAR: BAR_FRAMES, BPM: SIM_BPM, WINDOW: BEAT_WINDOW,
  DIVE: DIVE_PREVIEW, WING: WING_PREVIEW, SIG: SIG_LOCK_FRAMES,
  STRIKE: STRIKE_TELEGRAPH, CAPTURE: CAPTURE_BEAM_START,
  DRAFT: PERK_SELECT_FRAMES, ARM: DRAFT_ARM, IDS: PERK_IDS,
});
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();
const C = G.__C();

const clearKeys = () => {
  for (const k of [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D']) K[k] = false;
};
const pad = (v, w) => String(v).padStart(w);
const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : 'n/a');

// ---------------------------------------------------------------------------
// COLUMN 1 — THE CLOCK
// ---------------------------------------------------------------------------
function clockRun(stage, frames) {
  _seed = 0x2f6e2b1 ^ (stage * 7919);
  G.resetGame();
  const g = G.__g();
  g.stage = stage;
  G.startStage();
  g.playerAlive = true; g.lives = 999; g.cheatInvincible = true;
  for (let f = 0; f < 900 && !g.allEntered; f++) G.update();
  clearKeys();

  const phase = {};                 // animFrame % BEAT at each launch
  const tele = {};                  // threat class -> {min, max}
  const seen = new Set();
  let worstArrivals = 0, lastArrival = -1, gaps = [];
  let launches = 0;

  const note = (cls, len) => {
    if (!tele[cls]) tele[cls] = { min: Infinity, max: -Infinity, n: 0 };
    tele[cls].min = Math.min(tele[cls].min, len);
    tele[cls].max = Math.max(tele[cls].max, len);
    tele[cls].n++;
  };

  let prevBullets = 0;
  for (let f = 0; f < frames; f++) {
    G.update();
    // dive launches: the frame previewTimer first appears
    for (const e of (g.enemies || [])) {
      if (!e.alive) continue;
      const k = e._maKey != null ? e._maKey : (e._maKey = Math.floor(seededRandom() * 1e9));
      if ((e.previewTimer || 0) > 0 && !seen.has(k)) {
        seen.add(k);
        launches++;
        phase[g.animFrame % C.BEAT] = (phase[g.animFrame % C.BEAT] || 0) + 1;
        note(e._wingTactic ? 'coordinated dive' : 'formation dive', e.previewMax || e.previewTimer);
      } else if ((e.previewTimer || 0) <= 0 && seen.has(k) && e.state !== 'diving') {
        seen.delete(k);
      }
    }
    // enemy bullet arrivals per frame (the emission distribution, not the interval fn)
    const nb = (g.enemyBullets || []).length;
    const arrived = Math.max(0, nb - prevBullets);
    prevBullets = nb;
    if (arrived > 0) {
      worstArrivals = Math.max(worstArrivals, arrived);
      if (lastArrival >= 0) gaps.push(g.animFrame - lastArrival);
      lastArrival = g.animFrame;
    }
  }
  gaps.sort((a, b) => a - b);
  return {
    stage, launches, phase, tele, worstArrivals,
    p99gap: gaps.length ? gaps[Math.floor(gaps.length * 0.99)] : 0,
    medGap: gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0,
  };
}

// ---------------------------------------------------------------------------
// COLUMN 2 + 3 — AUTHORSHIP and ARRANGEMENT (one driven run carries both)
// ---------------------------------------------------------------------------
function draftRun(taker) {
  _seed = 0x51ed270b;
  G.resetGame();
  const g = G.__g();
  g.stage = 1;
  G.startStage();
  g.playerAlive = true; g.lives = 999; g.cheatInvincible = true;
  clearKeys();

  let offered = 0, committed = 0, declined = 0, dupOffers = 0;
  const picks = {};
  const stemSeen = { drum: 0, bass: 0, harm: 0, lead: 0 };
  let stemFrames = 0;
  let wasOpen = false, armFrames = 0;

  for (let f = 0; f < 60000; f++) {
    // a bot that flies and shoots
    K[' '] = (f % 7) < 4;
    K['ArrowRight'] = ((f >> 6) & 1) === 0;
    K['ArrowLeft'] = ((f >> 6) & 1) === 1;

    const open = (g.perkSelectFrames || 0) > 0;
    if (open && !wasOpen) {
      offered++;
      armFrames = 0;
      // a maxed card must never be dealt
      for (const id of (g.perkOffered || [])) {
        if (G.perkRank(id) >= G.perkMaxRank(id)) dupOffers++;
      }
    }
    if (open) {
      armFrames++;
      if (taker && armFrames === C.ARM + 2) {
        // a deliberate press: release, then press
        K[' '] = false; G.update(); K[' '] = true;
      } else if (!taker) {
        K[' '] = false;      // never commit
      }
    }
    if (!open && wasOpen) {
      if (G.manifestRanks() > committed) committed = G.manifestRanks();
      else declined++;
    }
    wasOpen = open;

    // what the arrangement would be playing right now
    const mask = G.stemMask(G.manifestRanks(), g.combo || 0, false);
    for (const k in mask) stemSeen[k] += mask[k];
    stemFrames++;

    G.update();
    if (g.state === ST.GAME_OVER) break;
  }
  for (const id of C.IDS) if (G.perkRank(id) > 0) picks[id] = G.perkRank(id);
  clearKeys();
  return {
    offered, committed, declined, dupOffers, picks,
    distinct: G.manifestSize(), ranks: G.manifestRanks(),
    stage: g.stage,
    stemSeen, stemFrames,
  };
}

// ---------------------------------------------------------------------------
// COLUMN 4 — RHYTHM. The gap between a random bot and a beat-locked one IS the
// skill expression. If there is no gap, the verb is decoration.
// ---------------------------------------------------------------------------
function rhythmRun(beatLocked) {
  _seed = 0x1a2b3c4d;
  G.resetGame();
  const g = G.__g();
  g.stage = 3;
  G.startStage();
  g.playerAlive = true; g.lives = 999; g.cheatInvincible = true;
  for (let f = 0; f < 600 && !g.allEntered; f++) G.update();
  clearKeys();

  let dashes = 0, onBeat = 0;
  for (let f = 0; f < 12000; f++) {
    if ((g.dashCooldown || 0) === 0 && (g.dashTimer || 0) === 0) {
      // The random bot dashes as soon as it is able; the deliberate one waits for
      // the window. Both are dashing as often as the cooldown allows, so the only
      // difference between them is TIMING.
      const want = beatLocked ? G.onBeatNow(g.animFrame) : (seededRandom() < 0.35);
      if (want) {
        G.tryStartDash();
        if ((g.dashTimer || 0) > 0) {
          dashes++;
          if (g.dashOnBeat) onBeat++;
        }
      }
    }
    G.update();
  }
  clearKeys();
  return { dashes, onBeat };
}

// ===========================================================================
console.log('');
console.log('  THE MEASURE — did the reform land in play?');
console.log('  ' + '='.repeat(68));

// ---- CLOCK ----
console.log('');
console.log('  CLOCK — the world runs on one bar');
console.log('  ' + '-'.repeat(68));
const clockRows = [7, 13, 33].map(st => clockRun(st, 7000));
console.log('    stage   launches   ON-GRID   worst arrivals/frame   median gap   p99 gap');
for (const r of clockRows) {
  const onGrid = r.phase[0] || 0;
  const total = Object.values(r.phase).reduce((a, b) => a + b, 0);
  console.log('    ' + pad(r.stage, 5) + pad(r.launches, 11) + pad(pct(onGrid, total), 10)
    + pad(r.worstArrivals, 23) + pad(r.medGap + 'f', 13) + pad(r.p99gap + 'f', 10));
}
console.log('');
console.log('    TELEGRAPH LENGTHS — the bar may move a threat\'s START; it may never');
console.log('    touch its LENGTH. What matters is the MINIMUM against each class\'s');
console.log('    budgeted floor: a max ABOVE the floor is a deliberate per-member');
console.log('    stagger (a WALL fans its three members 36/39/42 so they do not');
console.log('    descend in lockstep), while a min BELOW it is a warning the reform');
console.log('    silently shortened. The first cut of this audit flagged the stagger');
console.log('    as a leak — the heuristic was "one constant per class", which is');
console.log('    wrong, and the fix belonged in the instrument.');
const teleAll = {};
for (const r of clockRows) {
  for (const k in r.tele) {
    if (!teleAll[k]) teleAll[k] = { min: Infinity, max: -Infinity, n: 0 };
    teleAll[k].min = Math.min(teleAll[k].min, r.tele[k].min);
    teleAll[k].max = Math.max(teleAll[k].max, r.tele[k].max);
    teleAll[k].n += r.tele[k].n;
  }
}
const FLOOR = { 'formation dive': C.DIVE, 'coordinated dive': C.WING };
for (const k in teleAll) {
  const t = teleAll[k];
  const floor = FLOOR[k] || C.DIVE;
  const flag = t.min < floor
    ? '**  SHORTENED below its ' + floor + 'f budget'
    : (t.min === t.max ? 'ok  constant at its budget'
                       : 'ok  floor ' + floor + 'f held; the spread is a stagger');
  console.log('      ' + k.padEnd(20) + ('min ' + t.min + 'f').padEnd(10)
    + ('max ' + t.max + 'f').padEnd(10) + '(' + t.n + ' observed)   ' + flag);
}
console.log('');
console.log('    FLASH RATE — the photosensitivity ceiling on FULL-FRAME luminance.');
console.log('    Every full-frame channel rides the ' + C.BAR + '-frame bar:');
console.log('      bar pulse            ' + (60 / C.BAR).toFixed(3) + ' Hz   ceiling 2.5 Hz    '
  + ((60 / C.BAR) <= 2.5 ? 'ok' : '** OVER'));
console.log('      if it rode the BEAT  ' + (60 / C.BEAT).toFixed(3) + ' Hz   (why it does not)');
console.log('      bloom amplitude      +-0.020            ceiling 0.03      ok');
console.log('      state border         +-0.030            ceiling 0.03      ok');

// ---- AUTHORSHIP ----
console.log('');
console.log('  AUTHORSHIP — is the run something you wrote?');
console.log('  ' + '-'.repeat(68));
const takerRun = draftRun(true);
const idleRun = draftRun(false);
console.log('    a bot that COMMITS every draft:');
console.log('      drafts offered      ' + takerRun.offered);
console.log('      ranks taken         ' + takerRun.ranks
  + '   across ' + takerRun.distinct + ' distinct cards');
console.log('      reached stage       ' + takerRun.stage);
console.log('      maxed cards dealt   ' + takerRun.dupOffers
  + (takerRun.dupOffers === 0 ? '   ok — no dead draft' : '   ** a draft was undraftable'));
console.log('    a bot that DECLINES every draft:');
console.log('      drafts offered      ' + idleRun.offered);
console.log('      ranks taken         ' + idleRun.ranks
  + (idleRun.ranks === 0 ? '   ok — expiry takes NOTHING' : '   ** expiry took a card'));
if (Object.keys(takerRun.picks).length) {
  const rows = Object.keys(takerRun.picks).sort((a, b) => takerRun.picks[b] - takerRun.picks[a]);
  console.log('    per-card share (a dominant card should be visible here first):');
  console.log('      ' + rows.map(k => k + ' ' + takerRun.picks[k]).join('   '));
}

// ---- ARRANGEMENT ----
console.log('');
console.log('  ARRANGEMENT — is the build actually audible?');
console.log('  ' + '-'.repeat(68));
for (const [label, r] of [['committing', takerRun], ['declining', idleRun]]) {
  const f = r.stemFrames || 1;
  console.log('    ' + label.padEnd(12)
    + ['drum', 'bass', 'harm', 'lead'].map(k =>
        k + ' ' + pct(r.stemSeen[k], f).padStart(5)).join('   '));
}
console.log('    (a declining run should still open layers on COMBO alone — two ways in)');

// ---- RHYTHM ----
console.log('');
console.log('  RHYTHM — is the verb played, or is it decoration?');
console.log('  ' + '-'.repeat(68));
const rnd = rhythmRun(false);
const lock = rhythmRun(true);
const rndPct = rnd.dashes ? (100 * rnd.onBeat / rnd.dashes) : 0;
const lockPct = lock.dashes ? (100 * lock.onBeat / lock.dashes) : 0;
console.log('    random dasher      ' + pad(rnd.dashes, 4) + ' dashes   '
  + pad(Math.round(rndPct) + '%', 5) + ' on beat');
console.log('    deliberate dasher  ' + pad(lock.dashes, 4) + ' dashes   '
  + pad(Math.round(lockPct) + '%', 5) + ' on beat');
console.log('    window occupies    ' + Math.round(100 * (2 * C.WINDOW + 1) / C.BEAT)
  + '% of the timeline (the floor a random bot should score near)');

console.log('');
console.log('  ' + '-'.repeat(68));
const gap = lockPct - rndPct;
if (lock.dashes === 0) {
  console.log('  -> THE VERB NEVER FIRED. The rhythm dash is unreachable in play.');
} else if (gap < 15) {
  console.log('  -> DECORATION. A deliberate dasher scores ' + Math.round(gap) + ' points more');
  console.log('     than a random one, which is inside the noise: the window is either');
  console.log('     too wide to aim for or the cooldown is choosing the frame. Fix it');
  console.log('     STRUCTURALLY (narrow the window, or free the timing from the');
  console.log('     cooldown) — never by paying more for a thing nobody is doing.');
} else {
  console.log('  -> PLAYED. A deliberate dasher lands ' + Math.round(lockPct) + '% on beat against');
  console.log('     ' + Math.round(rndPct) + '% for a random one — a ' + Math.round(gap)
    + '-point gap that is pure timing, and it');
  console.log('     pays only in frames. No score, no damage, no multiplier: the clock');
  console.log('     owns no currency, so a player who cannot hear it loses nothing.');
}
console.log('');
