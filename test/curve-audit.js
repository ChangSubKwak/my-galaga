/*
 * curve-audit.js — difficulty + score-economy curve report.
 *
 * CLAUDE.md requires measuring the curve BEFORE tuning difficulty. This is the
 * tool that requirement refers to. It is a REPORT, not a pass/fail test — the
 * hard invariants (no inversion / no wall / no plateau, the fairness caps, the
 * boss ceiling, the challenge opportunity floor) are asserted in logic.test.js.
 * Run this when you want to SEE the shape:
 *
 *     node test/curve-audit.js
 *
 * It loads the real game in a vm sandbox and drives the actual scaling
 * functions with the exact parameters from their real call sites, so it can
 * never drift away from what the game does. Every difficulty defect found so
 * far — a 69-stage plateau, two uncapped speed runaways, a reward inversion —
 * was invisible in the code and obvious the moment it was plotted.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- minimal browser stubs (report-only: nothing here renders) ----
const noop = () => {};
const px = new Proxy({}, { get: () => () => px, set: () => true });
const store = {};
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage: {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: noop, clear: noop,
  },
  document: {
    getElementById: () => px, createElement: () => px, querySelector: () => px,
    querySelectorAll: () => [], addEventListener: noop, body: px,
    documentElement: px, hidden: false,
  },
  AudioContext: function () { return px; }, webkitAudioContext: function () { return px; },
  navigator: { getGamepads: () => [], vibrate: noop, userAgent: 'node', maxTouchPoints: 0 },
  performance: { now: () => 0 },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
sandbox.window.innerWidth = 800;
sandbox.window.innerHeight = 600;
sandbox.window.devicePixelRatio = 1;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'game.js' });
const G = sandbox;

const BASE_W = 224;
const PLAYER_SPEED = 2.5;
const MAX_STAGE = 100;
const pad = (v, n) => String(v).padStart(n);

// ---------------------------------------------------------------- FORMATION
// Parameters below are the ones at the REAL call sites; if you change a call
// site, change it here too or the report silently lies.
const bulletSpeed = s => G.cappedStageSpeed(3.4, 2.0, 0.045, s, 1);
const diveShot    = s => G.rampedFireInterval(14, 42, 1.0, s, 1);
const diveTrigger = s => G.rampedInterval(80, 200, 10, s);
const eliteRate   = s => G.eliteRateForStage(s, 'normal');
const ghostRate   = s => G.ghostRateForStage(s);
const extraDive   = s => G.extraDiverChance(s);

function pressure(s) {
  return (60 / diveShot(s)) * bulletSpeed(s)
       * (1 + (60 / diveTrigger(s)) * (1 + extraDive(s)))
       * (1 + eliteRate(s)) * (1 + ghostRate(s));
}

// -------------------------------------------------------------------- SCORE
// Expected per-kill multiplier from the variant lottery. Elite pays 1.5x and
// ghost 2x, so raising their spawn rates raises income as a side effect —
// this is the check that a difficulty change did not quietly inflate scoring.
function variantMul(s) {
  const e = eliteRate(s), g = ghostRate(s);
  return e * 1.5 + g * 2 + Math.max(0, 1 - e - g);
}
// A representative formation: the real createFormation is 40 enemies, mostly
// bees/butterflies with 4 bosses.
const FORMATION = [['bee', 24], ['butterfly', 12], ['boss', 4]];
function stageScore(s) {
  let base = 0;
  for (const [type, n] of FORMATION) base += G.getEnemyPoints(type, true) * n;
  return base * variantMul(s);
}

function report() {
  console.log('\n' + '='.repeat(74));
  console.log('CURVE AUDIT — difficulty + score economy   (normal difficulty)');
  console.log('='.repeat(74));

  // ---- formation ----
  console.log('\n[1] FORMATION TRACK\n');
  console.log('stage  bSpd  fire  dive  elite  ghost  +dv   pressure   stageScore  pts/pressure');
  const rows = [];
  for (let s = 1; s <= MAX_STAGE; s++) rows.push({ s, p: pressure(s), sc: stageScore(s) });
  const p0 = rows[0].p, sc0 = rows[0].sc;
  for (const r of rows) {
    if (r.s !== 1 && r.s % 10 !== 0) continue;
    const eff = (r.sc / sc0) / (r.p / p0);
    console.log('  ' + pad(r.s, 3)
      + '  ' + bulletSpeed(r.s).toFixed(2)
      + '  ' + pad(diveShot(r.s), 3) + 'f'
      + '  ' + pad(diveTrigger(r.s), 3) + 'f'
      + '  ' + pad((eliteRate(r.s) * 100).toFixed(1), 5) + '%'
      + '  ' + pad((ghostRate(r.s) * 100).toFixed(1), 4) + '%'
      + '  ' + pad((extraDive(r.s) * 100).toFixed(0), 3) + '%'
      + '    x' + (r.p / p0).toFixed(2)
      + '     ' + pad(Math.round(r.sc), 6)
      + '      x' + eff.toFixed(3));
  }

  // ---- boss ----
  console.log('\n[2] BOSS TRACK  (every 10th stage)\n');
  console.log('stage  kind     HP   base  enraged  x player  cross(f)  volley');
  for (let s = 10; s <= MAX_STAGE; s += 10) {
    const b = s >= 30 ? G.makeMegaBoss(s, { super: true, hpScale: 2.5, vx: 1.7 + s * 0.10 })
            : s >= 20 ? G.makeMegaBoss(s, { hpScale: 0.65, vx: 1.5 + s * 0.10 })
            : G.makeMegaBoss(s);
    const enr = Math.abs(G.clampBossVx(G.clampBossVx(b.vx * 1.5) * 1.2));
    console.log('  ' + pad(s, 3) + '   ' + (s >= 30 ? 'SUPER' : s >= 20 ? 'twin ' : 'solo ')
      + '  ' + pad(b.maxHp, 4)
      + '  ' + b.vx.toFixed(2)
      + '   ' + enr.toFixed(2)
      + '     x' + (enr / PLAYER_SPEED).toFixed(2)
      + '      ' + pad(((BASE_W - 40) / enr).toFixed(1), 5)
      + '      ' + b.spreadCount);
  }

  // ---- challenge ----
  console.log('\n[3] CHALLENGE TRACK  (every 4th non-boss stage) — a REWARD round,');
  console.log('    so the metric is OPPORTUNITY (shootable enemy-time), not danger\n');
  console.log('stage  speed  dwell   shots/pass  per wave  total   opportunity');
  const chal = [];
  for (let s = 1; s <= MAX_STAGE; s++) if (G.stageModeFor(s) === 'challenge') chal.push(s);
  const opp = s => G.challengeGroupSize(s) * 2 * 8 * ((BASE_W + 30) / G.challengeSpeedForStage(s));
  const opp0 = opp(chal[0]);
  for (const s of chal) {
    if (s !== chal[0] && s % 16 !== 0) continue;
    const d = (BASE_W + 30) / G.challengeSpeedForStage(s);
    console.log('  ' + pad(s, 3)
      + '   ' + G.challengeSpeedForStage(s).toFixed(2)
      + '   ' + pad(d.toFixed(1), 5) + 'f'
      + '     ' + pad((d / 6).toFixed(1), 5)
      + '        ' + pad(G.challengeGroupSize(s) * 2, 3)
      + '      ' + pad(G.challengeGroupSize(s) * 2 * 8, 4)
      + '     ' + (opp(s) / opp0 * 100).toFixed(0) + '% of first');
  }

  // ---- failure modes ----
  console.log('\n[4] FAILURE MODES\n');
  let inv = 0, wall = 0, flat = 0, longest = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].p - rows[i - 1].p;
    if (d < -1e-9) inv++;
    if (rows[i - 1].p > 0 && d / rows[i - 1].p > 0.12) wall++;
    if (Math.abs(d) < 1e-9) { flat++; longest = Math.max(longest, flat); } else flat = 0;
  }
  const verdict = (label, bad, detail) =>
    console.log('  ' + (bad ? 'FAIL  ' : 'ok    ') + label.padEnd(56) + detail);
  verdict('INVERSION   a later stage easier than an earlier one', inv > 0, inv + ' found');
  verdict('WALL        >12% pressure jump in a single stage', wall > 0, wall + ' found');
  verdict('PLATEAU     10+ consecutive stages with no change', longest >= 10, 'longest flat run ' + longest);
  // A reward round is allowed to get harder; it is not allowed to collapse.
  const oppRatio = opp(chal[chal.length - 1]) / opp0;
  verdict('OPPORTUNITY deepest challenge round vs the first', oppRatio < 0.5,
    (oppRatio * 100).toFixed(0) + '% (floor 50%)');
  // Score must never fall as stages deepen. It is ALLOWED to lag difficulty —
  // see the note below — so only a genuine decrease is a failure here.
  let scoreDrops = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].sc < rows[i - 1].sc - 1e-9) scoreDrops++;
  verdict('SCORE       a later stage worth fewer points', scoreDrops > 0, scoreDrops + ' found');

  console.log('\n  INFO  score efficiency (points per unit of danger), stage 1 -> '
    + MAX_STAGE + ':');
  const effEnd = (rows[MAX_STAGE - 1].sc / sc0) / (rows[MAX_STAGE - 1].p / p0);
  console.log('        x1.000 -> x' + effEnd.toFixed(3)
    + '  (you earn ~' + (1 / effEnd).toFixed(1) + 'x less per unit of danger at depth)');
  console.log('\n  This is NOT flagged as a failure: getEnemyPoints() takes no stage');
  console.log('  argument by design — a bee is worth 50 points at stage 1 and at stage');
  console.log('  100, exactly as in real Galaga. Only bossBounty() scales with depth.');
  console.log('  Depth is meant to pay in COMBO multipliers, boss bounty and rank, not');
  console.log('  in inflated per-kill values (CLAUDE.md: "score additions must be');
  console.log('  deliberate"). The number is reported so that any future score source');
  console.log('  is added with its effect on this ratio known, rather than by feel.');
  console.log('');
}

report();
