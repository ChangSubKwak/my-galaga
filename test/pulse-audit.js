/*
 * pulse-audit.js — THE CONTROL BUDGET, measured.
 *
 *     node test/pulse-audit.js
 *
 * telegraph-audit.js asks "does a threat warn you BEFORE it takes something?".
 * This asks the mirror question, which nothing here had ever asked:
 *
 *     AFTER it takes something, how long until you are allowed to play again?
 *
 * Every pause in this game was added on its own and for a good reason — the
 * hit-stop that punctuates a boss kill, the letterbox on a metamorphosis, the
 * respawn wait that carries the death recap, the capture cutscene. None of them
 * knew about each other and nothing ever added them up. So the answer to "what
 * fraction of a session does the player's input do nothing?" was unknown, and
 * "which single event holds the hands longest?" was unknowable without sitting
 * with a stopwatch.
 *
 * It MEASURES rather than restates. The loop here is the real gameLoop's
 * accumulator body — including the hit-stop branch that skips update()
 * entirely — driven with a bot that moves, shoots and dies, so what is counted
 * is what a player would actually sit through. Restating the constants would
 * just re-encode whatever is wrong.
 *
 * This is a REPORT, not a pass/fail test — same division of labour that
 * curve-audit.js has with logic.test.js, where the hard invariants live.
 *
 * WHAT IT FOUND (2026-08-15, the run that motivated THE STRUGGLE):
 *
 *     hit-stop        4-14f per event     healthy — that is punctuation
 *     stage intro     ~35-64f             healthy — and skippable with fire
 *     respawn         132f  (12f + 120f)  the death-recap read window
 *     CAPTURED        211f  (120 + 91)    <- the outlier, and it costs A LIFE
 *
 * 211 consecutive frames is 3.5 seconds, the longest stretch in the game, on
 * the single most expensive thing that can happen to you, and across the whole
 * of it the game did not read one input. That is being punished twice: once in
 * lives, once in time. The rule it broke is the mirror of the fairness rule —
 * A THREAT THAT TAKES MORE MUST NOT HOLD YOUR HANDS LONGER — and the fix was
 * not a shorter cutscene but a contest inside it (THE STRUGGLE).
 *
 * The second column here is DEAD AIR: frames the player IS in control but
 * nothing on screen can hurt them. It is the opposite failure (boredom rather
 * than frustration) and it is reported for the same reason the score economy is
 * reported in curve-audit.js — so it is a known number rather than a feeling.
 *
 * WHEN ADDING ANY PAUSE, FREEZE, CUTSCENE OR CINEMATIC: add it here and check
 * the cost/downtime column stays ordered. A pause that costs the player nothing
 * may be long; a pause that costs a life must be short or must be playable.
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
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const ST = G.__S();
const K = G.__keys();

// Seeded, so two runs of this report are comparable. An unseeded audit samples
// different frames every time and its numbers cannot be diffed across a change
// — the same lesson layout-audit.js learned the hard way.
let _seed = 987654321;
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };

// ---------------------------------------------------------------------------
// Is anything on screen currently able to hurt the player? Used for DEAD AIR.
// ---------------------------------------------------------------------------
function threatLive(g) {
  if ((g.enemyBullets || []).length > 0) return true;
  if ((g.megaBosses || []).length > 0) return true;
  if ((g.kamikazes || []).length > 0) return true;
  if (g.rival || g.magpie) return true;
  for (const e of (g.enemies || [])) {
    if (e.state === 'diving' || e.state === 'capturing' || (e.previewTimer || 0) > 0) return true;
  }
  if (g.state === ST.CHALLENGING) return true;
  return false;
}

// Which bucket does this frame fall in? 'control' is the only one where the
// player's hands are on the game.
function bucket(g, ranUpdate) {
  if (!ranUpdate) return 'hit-stop';
  if (g.state === ST.CAPTURED) return 'captured';
  if (g.state === ST.RESPAWN) return 'respawn';
  if (g.state === ST.STAGE_INTRO) return 'stage intro';
  if (g.state === ST.GAME_OVER) return 'game over';
  if (g.state === ST.BONUS_GAME) return 'control';   // the bonus stage is played
  if (!g.playerAlive) return 'dying';
  return 'control';
}

// ---------------------------------------------------------------------------
// One driven session. `struggler` decides whether the bot fights the beam —
// running both tells us THE STRUGGLE actually moves the number rather than
// merely existing.
// ---------------------------------------------------------------------------
function session(startStage, frames, struggler) {
  G.resetGame();
  const g = G.__g();
  g.stage = startStage;
  G.startStage();
  g.playerAlive = true;
  g.lives = 99;

  const cat = {};
  const worst = {};                 // bucket -> longest single run of it
  let run = 0, runCause = '';
  let deadRun = 0, worstDead = 0, worstDeadCause = '';
  let air = 0, worstAir = 0, airTotal = 0, ctlTotal = 0;
  const airWhy = {};

  for (let f = 0; f < frames; f++) {
    // Ordinary flying: sweep, shoot.
    K['ArrowLeft']  = (f % 210) < 90;
    K['ArrowRight'] = (f % 210) >= 130;
    K[' ']          = (f % 7) < 3;
    // A struggling pilot. The flip rate is deliberately HUMAN — one reversal
    // every 9 frames is ~6.7/s, brisk but sustainable. A 2-frame flip would be
    // ~15/s, and an audit that reports a superhuman escape time is lying about
    // what the mechanic costs.
    if (struggler && g.state === ST.CAPTURED) {
      const flip = Math.floor(f / 9) % 2 === 0;
      K['ArrowLeft'] = flip; K['ArrowRight'] = !flip;
    }

    // The real gameLoop body: hit-stop skips update() outright.
    let ran = true;
    if (g.hitStopFrames > 0) { g.hitStopFrames--; g.animFrame++; ran = false; }
    else G.update();

    const b = bucket(g, ran);
    cat[b] = (cat[b] || 0) + 1;
    if (b === runCause) run++; else { runCause = b; run = 1; }
    if (run > (worst[b] || 0)) worst[b] = run;

    if (b === 'control') {
      if (deadRun > worstDead) { worstDead = deadRun; }
      deadRun = 0;
      ctlTotal++;
      if (threatLive(g)) air = 0;
      else {
        air++; airTotal++; if (air > worstAir) worstAir = air;
        // WHY is it quiet? Three very different answers, and only one of them
        // is a problem: the entry parade is Galaga's own vocabulary, a lull in
        // a held formation is the player's window to line up shots, and an
        // empty playfield is genuinely nothing to do.
        const es = g.enemies || [];
        const why = es.length === 0 ? 'empty'
          : es.every(e => e.state === 'entering') ? 'parade' : 'lull';
        airWhy[why] = (airWhy[why] || 0) + 1;
      }
    } else {
      if (deadRun === 0) worstDeadCause = b;
      deadRun++;
      air = 0;
    }
  }
  if (deadRun > worstDead) worstDead = deadRun;

  const dead = frames - (cat.control || 0);
  return {
    stage: startStage, reached: g.stage, frames, cat, worst, dead,
    worstDead, worstDeadCause, airTotal, ctlTotal, worstAir, airWhy,
    escaped: g.capturesEscaped || 0,
  };
}

function pct(a, b) { return (100 * a / Math.max(1, b)).toFixed(1) + '%'; }
function secs(f) { return (f / 60).toFixed(2) + 's'; }

// ---------------------------------------------------------------------------
console.log('\n============================================================');
console.log('  THE CONTROL BUDGET — how much of the game do you play?');
console.log('============================================================');

const BANDS = [[1, 'EARLY'], [9, 'BOSS BAND'], [23, 'MID'], [47, 'DEEP']];
const FRAMES = 7200;   // 2 minutes each

console.log('\n  band        stage  DEAD HANDS        longest stretch');
console.log('  ' + '-'.repeat(56));
const runs = [];
for (const [st, label] of BANDS) {
  const r = session(st, FRAMES, false);
  runs.push([label, r]);
  console.log('  ' + label.padEnd(11) + String(r.stage).padEnd(6)
    + (r.dead + 'f ' + pct(r.dead, r.frames)).padEnd(18)
    + r.worstDead + 'f (' + secs(r.worstDead) + ') ' + r.worstDeadCause);
}

// -------- per-event downtime: the column that matters ----------------------
console.log('\n  PER-EVENT DOWNTIME — longest uninterrupted run of each bucket');
console.log('  ' + '-'.repeat(56));
const merged = {};
for (const [, r] of runs) {
  for (const k of Object.keys(r.worst)) merged[k] = Math.max(merged[k] || 0, r.worst[k]);
}
const COST = {
  'hit-stop':    'nothing (it punctuates a KILL)',
  'stage intro': 'nothing (skippable with fire)',
  'respawn':     'a life, already spent',
  'dying':       'a life, already spent',
  'captured':    'A LIFE — the most expensive event',
  'game over':   'the run',
};
const order = Object.keys(merged).filter(k => k !== 'control')
  .sort((a, b) => merged[b] - merged[a]);
for (const k of order) {
  console.log('  ' + k.padEnd(13) + (merged[k] + 'f').padStart(6) + '  '
    + secs(merged[k]).padStart(7) + '   ' + (COST[k] || ''));
}

// -------- does THE STRUGGLE actually change it? ----------------------------
console.log('\n  THE STRUGGLE — a bot that fights the beam vs one that does not');
console.log('  ' + '-'.repeat(56));
let fightWorst = 0, fightSeen = 0, breakouts = 0;
for (const [st, label] of BANDS) {
  const limp = session(st, FRAMES, false);
  const fight = session(st, FRAMES, true);
  const lc = limp.worst.captured || 0;
  const fc = fight.worst.captured || 0;
  breakouts += fight.escaped;
  if (fc > 0) { fightSeen++; fightWorst = Math.max(fightWorst, fc); }
  const cell = fc === 0
    ? 'no capture landed on the fighting bot'
    : 'limp ' + (lc ? (lc + 'f').padStart(5) : '  n/a') + '   fighting '
      + (fc + 'f').padStart(5) + '   breakouts ' + fight.escaped
      + (lc ? '   (' + Math.round(100 * (1 - fc / lc)) + '% shorter)'
            : '   (no limp capture sampled)');
  console.log('  ' + label.padEnd(11) + cell);
}

// -------- dead air: the opposite failure -----------------------------------
console.log('\n  DEAD AIR — in control, but nothing on screen can hurt you');
console.log('  ' + '-'.repeat(56));
for (const [label, r] of runs) {
  const w = r.airWhy;
  console.log('  ' + label.padEnd(11) + (r.airTotal + 'f of ' + r.ctlTotal).padEnd(18)
    + pct(r.airTotal, r.ctlTotal).padStart(7) + '   longest ' + r.worstAir + 'f ('
    + secs(r.worstAir) + ')');
  console.log('  ' + ' '.repeat(11) + '  parade ' + (w.parade || 0) + 'f   lull '
    + (w.lull || 0) + 'f   empty ' + (w.empty || 0) + 'f');
}
console.log('  (parade = the entry flight, which is Galaga\'s own vocabulary and is');
console.log('   MEANT to be quiet. Only `empty` is dead time with no reading to do.)');

// -------- the verdict ------------------------------------------------------
const capMax = merged.captured || 0;
const respMax = merged.respawn || 0;
const stopMax = merged['hit-stop'] || 0;
console.log('\n  ' + '-'.repeat(56));
console.log('  RULE: a threat that takes MORE must not hold your hands LONGER.');
console.log('  hit-stop ' + stopMax + 'f  <  respawn ' + respMax + 'f  <  capture ' + capMax + 'f');
console.log('');
if (capMax === 0) {
  console.log('  -> no capture landed in any sample; re-run or widen the bands.');
} else if (fightSeen === 0) {
  console.log('  -> the fighting bot was never captured in this sample, so the');
  console.log('     escape path is unmeasured here. Re-run before trusting it.');
} else if (fightWorst < capMax) {
  console.log('  -> the ' + capMax + 'f silence is now a CHOICE. A pilot who goes limp still');
  console.log('     pays it (and keeps the shot at a wingman); a pilot who fights is');
  console.log('     back on the stick in ' + fightWorst + 'f (' + secs(fightWorst) + ') — '
    + Math.round(100 * (1 - fightWorst / capMax)) + '% of it handed back.');
  console.log('     ' + breakouts + ' breakouts across the sample. The longest unplayable');
  console.log('     stretch in the game is no longer something that merely happens to you.');
} else {
  console.log('  -> fighting the beam did not shorten it (' + fightWorst + 'f vs ' + capMax + 'f).');
  console.log('     THE STRUGGLE is not reaching the player. This is a defect.');
}
console.log('');
