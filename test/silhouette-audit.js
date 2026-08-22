/*
 * silhouette-audit.js — what the bright pass can actually see, and what the
 * player can actually tell apart.
 *
 *     node test/silhouette-audit.js
 *
 * DESIGN.md commits this game to NEON VECTOR BLOOM and says "let the bloom be
 * the outline — don't fight it with heavy strokes on bright shapes". That advice
 * is TRUE of a 6px power-up diamond and has to be MEASURED for a 15px enemy,
 * because the bloom this game actually ships is not a generic glow:
 *
 *   1. it downsamples the frame to device/5 BEFORE squaring, and squaring does
 *      not commute with a box average — so a 1px logical stroke (3.75 device px
 *      at 1080p, i.e. 0.75 of one bloom-buffer pixel) is DILUTED first and then
 *      penalised QUADRATICALLY;
 *   2. it is a PER-CHANNEL multiply, so what the knee destroys is DESATURATION,
 *      not mid-tone fill. #f4f and #888 sit at almost the same luminance and are
 *      not treated remotely alike.
 *
 * Both of those invert the usual intuition, which is why this exists. It
 * rasterizes the real draw functions — every enemy sprite in this game is pure
 * fillRect/fillStyle/globalAlpha/save/restore/translate, so the raster is exact,
 * not an approximation — and reports:
 *
 *   BLOOM ENERGY   what each sprite contributes through the shipped tail
 *                  (A*(0.72*sq + 0.28*lin + 0.40*sq), A = 0.22 at rest).
 *   BRIGHT AREA    logical pixels at or above half brightness with bloom OFF —
 *                  because E toggles it and the perf valve can suspend it at any
 *                  moment, so a sprite that only reads through the bloom is a
 *                  sprite that disappears on a slow machine.
 *   SILHOUETTE     pairwise IoU of the coverage masks, through the SAME 1/5
 *                  buffer the bloom sees. This is the gate on how far shape can
 *                  be pushed as a type channel: if the worst pairs cannot get
 *                  under the threshold, the honest answer is fewer shape
 *                  families and stronger hue separation — never a 1px seam that
 *                  looks distinct in a zoomed screenshot and vanishes in play.
 *
 * A REPORT, not a gate — logic.test.js owns the hard invariants.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---------------------------------------------------------------------------
// An EXACT rasterizer for the ops the sprite functions actually use.
// ---------------------------------------------------------------------------
const W = 48, H = 48, ORIGIN = 24;      // logical pixels; sprites draw around 0,0
const SS = 15;                          // supersample, so the 4/3-px bloom box is exact

function makeRaster() {
  const w = W * SS, h = H * SS;
  const buf = new Float32Array(w * h * 3);
  const cov = new Float32Array(w * h);
  let fill = '#000', alpha = 1, tx = 0, ty = 0;
  const stack = [];

  const parse = (c) => {
    if (typeof c !== 'string') return [0, 0, 0];
    let s = c.trim();
    if (s[0] === '#') {
      if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
      return [parseInt(s.slice(1, 3), 16) / 255,
              parseInt(s.slice(3, 5), 16) / 255,
              parseInt(s.slice(5, 7), 16) / 255];
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map(Number);
      return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255];
    }
    return [1, 1, 1];
  };

  const ctx = {
    get fillStyle() { return fill; },
    set fillStyle(v) { fill = v; },
    get globalAlpha() { return alpha; },
    set globalAlpha(v) { alpha = (typeof v === 'number' && isFinite(v)) ? v : 1; },
    save() { stack.push([fill, alpha, tx, ty]); },
    restore() { const s = stack.pop(); if (s) { fill = s[0]; alpha = s[1]; tx = s[2]; ty = s[3]; } },
    translate(x, y) { tx += x; ty += y; },
    fillRect(x, y, rw, rh) {
      const [r, g, b] = parse(fill);
      const a = Math.max(0, Math.min(1, alpha));
      const x0 = Math.round((x + tx + ORIGIN) * SS), y0 = Math.round((y + ty + ORIGIN) * SS);
      const x1 = Math.round((x + tx + ORIGIN + rw) * SS), y1 = Math.round((y + ty + ORIGIN + rh) * SS);
      for (let py = Math.max(0, y0); py < Math.min(h, y1); py++) {
        for (let px = Math.max(0, x0); px < Math.min(w, x1); px++) {
          const i = py * w + px;
          buf[i * 3]     = buf[i * 3]     * (1 - a) + r * a;
          buf[i * 3 + 1] = buf[i * 3 + 1] * (1 - a) + g * a;
          buf[i * 3 + 2] = buf[i * 3 + 2] * (1 - a) + b * a;
          cov[i] = Math.max(cov[i], a);
        }
      }
    },
    // everything else a sprite might reach for is absorbed
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {},
    stroke() {}, rect() {}, strokeRect() {}, scale() {}, rotate() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage() {}, clearRect() {}, setTransform() {}, measureText() { return { width: 0 }; },
    fillText() {}, strokeText() {}, clip() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    ellipse() {}, putImageData() {}, getImageData() { return { data: [] }; },
  };
  for (const p of ['strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
                   'shadowColor', 'shadowBlur', 'globalCompositeOperation',
                   'imageSmoothingEnabled', 'lineCap', 'lineJoin', 'filter']) {
    ctx[p] = null;
  }
  const reset = () => {
    buf.fill(0); cov.fill(0);
    fill = '#000'; alpha = 1; tx = 0; ty = 0; stack.length = 0;
  };
  return { ctx, buf, cov, w, h, reset };
}

// ---------------------------------------------------------------------------
// Boot the game with the rasterizer as its 2D context.
// ---------------------------------------------------------------------------
const R = makeRaster();
const noop = () => {};
const px = new Proxy({}, { get: () => () => px, set: () => true });
const audioNode = new Proxy({}, { get: () => () => audioNode, set: () => true });
const AC = () => new Proxy({ currentTime: 0, sampleRate: 44100, destination: audioNode },
  { get: (t, p) => (p in t ? t[p] : () => audioNode), set: () => true });
const store = {};
const fakeCanvas = { width: 840, height: 1080, style: {}, getContext: () => R.ctx,
                     addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 840, height: 1080 }) };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise,
  isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, Error, TypeError, RegExp, Symbol,
  Float32Array, Uint8Array,
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
  localStorage: { getItem: k => (k in store ? store[k] : null),
                  setItem: (k, v) => { store[k] = String(v); },
                  removeItem: k => { delete store[k]; }, clear: noop },
  document: {
    getElementById: (id) => (id === 'gc' ? fakeCanvas : px),
    createElement: () => ({ width: 0, height: 0, getContext: () => px, style: {} }),
    querySelector: () => px, querySelectorAll: () => [], addEventListener: noop,
    body: px, documentElement: px, hidden: false,
  },
  AudioContext: AC, webkitAudioContext: AC,
  navigator: { getGamepads: () => [], vibrate: noop, userAgent: 'node', maxTouchPoints: 0 },
  performance: { now: () => 0 },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
sandbox.window.innerWidth = 840; sandbox.window.innerHeight = 1080;
sandbox.window.devicePixelRatio = 1;
vm.createContext(sandbox);
vm.runInContext(script + `
;globalThis.__info = () => ENEMY_INFO;
;globalThis.__draw = {
  bee: drawBee, butterfly: drawButterfly, boss: drawBoss, mirror: drawMirror,
  splitter: drawSplitter, shielded: (x,y,f) => drawShielded(x,y,f,2),
  ufo: drawUFO, hoverer: drawHoverer, kamikaze: drawKamikaze,
  goldenBee: drawGoldenBee, minibee: drawMiniBee,
  warper: (x,y,f) => drawWarper(x,y,f,0),   // 0 = not warping; 1 would draw it at alpha 0.10
};
`, sandbox, { filename: 'game.js' });

const G = sandbox;
const INFO = G.__info();
const DRAW = G.__draw;

// ---------------------------------------------------------------------------
// THE SHIPPED BLOOM TAIL, reproduced numerically.
//   SCALE at 1080p is 1080/288 = 3.75 device px per logical px.
//   The buffer is device/5, so ONE bloom pixel covers 5/3.75 = 4/3 logical px.
//   Then a per-channel multiply (square), then the three additive draws:
//     A * (KNEE*sq + (1-KNEE)*lin + OCT*sq),  A 0.22, KNEE 0.72, OCT 0.40
// ---------------------------------------------------------------------------
const A = 0.22, KNEE = 0.72, OCT = 0.40;
const BOX = 20;                          // SS(15) * 4/3 — an exact bloom-buffer cell

function bloomEnergy(buf, w, h) {
  let e = 0;
  for (let by = 0; by + BOX <= h; by += BOX) {
    for (let bx = 0; bx + BOX <= w; bx += BOX) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let y = 0; y < BOX; y++) {
          for (let x = 0; x < BOX; x++) s += buf[((by + y) * w + (bx + x)) * 3 + c];
        }
        const v = s / (BOX * BOX);       // the downsample, BEFORE the squaring
        e += A * (KNEE * v * v + (1 - KNEE) * v + OCT * v * v);
      }
    }
  }
  return e;
}

// Logical pixels at or above half brightness, with the bloom OFF.
function brightArea(buf, w, h) {
  let n = 0;
  for (let ly = 0; ly < H; ly++) {
    for (let lx = 0; lx < W; lx++) {
      const i = ((ly * SS + (SS >> 1)) * w + (lx * SS + (SS >> 1))) * 3;
      if (Math.max(buf[i], buf[i + 1], buf[i + 2]) >= 0.5) n++;
    }
  }
  return n;
}

// The coverage mask as the BLOOM sees it — one cell per bloom-buffer pixel.
function maskAtBloomRes(cov, w, h) {
  const cw = Math.floor(w / BOX), ch = Math.floor(h / BOX);
  const m = new Float32Array(cw * ch);
  for (let by = 0; by < ch; by++) {
    for (let bx = 0; bx < cw; bx++) {
      let s = 0;
      for (let y = 0; y < BOX; y++) {
        for (let x = 0; x < BOX; x++) s += cov[((by * BOX + y) * w + (bx * BOX + x))];
      }
      m[by * cw + bx] = s / (BOX * BOX);
    }
  }
  return m;
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0.15 ? 1 : 0, y = b[i] > 0.15 ? 1 : 0;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 0;
}

// ---------------------------------------------------------------------------
// The game's `ctx` IS R.ctx (the fake canvas handed it over at load), so a sprite
// draws straight into the raster. Reset between subjects rather than rebuilding —
// rebinding a captured const is not possible and does not need to be.
const TYPES = Object.keys(DRAW);
const rows = [];
for (const t of TYPES) {
  R.reset();
  // Both animation frames, unioned: a wing flap is one sprite, not two.
  try { DRAW[t](0, 0, 0); DRAW[t](0, 0, 1); } catch (e) {
    console.log('  (' + t + ' threw: ' + e.message + ')');
  }
  rows.push({
    t,
    col: (INFO[t] && INFO[t].col) || '?',
    energy: bloomEnergy(R.buf, R.w, R.h),
    bright: brightArea(R.buf, R.w, R.h),
    mask: maskAtBloomRes(R.cov, R.w, R.h),
  });
}

console.log('');
console.log('  THE FILAMENT — what the bright pass can see, and what you can tell apart');
console.log('  ' + '='.repeat(70));
console.log('');
console.log('  BLOOM ENERGY + BRIGHT AREA (bloom OFF) — per enemy, as shipped today');
console.log('  ' + '-'.repeat(70));
console.log('    type          col      bloom energy    bright px (bloom off)');
rows.sort((a, b) => a.energy - b.energy);
for (const r of rows) {
  console.log('    ' + r.t.padEnd(13) + r.col.padEnd(9)
    + r.energy.toFixed(1).padStart(9) + r.bright.toString().padStart(19));
}
const lowest = rows[0], highest = rows[rows.length - 1];
console.log('');
console.log('    lowest:  ' + lowest.t + ' at ' + lowest.energy.toFixed(1)
  + '   highest: ' + highest.t + ' at ' + highest.energy.toFixed(1)
  + '   spread ' + (highest.energy / Math.max(0.01, lowest.energy)).toFixed(1) + 'x');

console.log('');
console.log('  DESATURATION IS THE ENEMY, NOT MID-TONE — the per-channel knee, priced');
console.log('  ' + '-'.repeat(70));
const swatch = (hex) => {
  let s = hex.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const c = [0, 1, 2].map(i => parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255);
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const lin = c.reduce((a, v) => a + A * ((1 - KNEE) * v), 0);
  const sq = c.reduce((a, v) => a + A * ((KNEE + OCT) * v * v), 0);
  const now = lin + sq;
  const before = c.reduce((a, v) => a + 0.36 * v, 0);   // the old flat linear pass
  return { hex, lum, keep: now / before };
};
console.log('    colour    luminance   keeps of its old bloom contribution');
for (const hex of ['#f4f', '#ff0', '#0ff', '#f44', '#0f8', '#fc4', '#888', '#a85', '#bbb', '#332']) {
  const s = swatch(hex);
  console.log('    ' + s.hex.padEnd(10) + s.lum.toFixed(2).padStart(8)
    + (Math.round(s.keep * 100) + '%').padStart(12)
    + (s.keep < 0.75 ? '   <- the knee is eating this' : ''));
}

console.log('');
console.log('  SILHOUETTE — pairwise IoU through the same 1/5 buffer the bloom sees');
console.log('  ' + '-'.repeat(70));
const pairs = [];
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    pairs.push({ a: rows[i].t, b: rows[j].t, v: iou(rows[i].mask, rows[j].mask) });
  }
}
pairs.sort((a, b) => b.v - a.v);
const THRESH = 0.45;
const over = pairs.filter(p => p.v > THRESH);
console.log('    worst 10 pairs (threshold ' + THRESH + '):');
for (const p of pairs.slice(0, 10)) {
  console.log('      ' + (p.a + ' / ' + p.b).padEnd(30) + p.v.toFixed(2)
    + (p.v > THRESH ? '   ** indistinguishable by shape' : ''));
}
console.log('');
console.log('    ' + over.length + ' of ' + pairs.length + ' pairs are over the threshold.');
console.log('');
console.log('  ' + '-'.repeat(70));
if (over.length > pairs.length * 0.4) {
  console.log('  -> SHAPE CANNOT CARRY TYPE at this size through this buffer. HUE must stay');
  console.log('     the primary channel and shape can only ever be redundancy. Pushing');
  console.log('     shape further here buys a distinction that exists in a zoomed');
  console.log('     screenshot and nowhere in play.');
} else {
  console.log('  -> Shape separates well enough to carry redundancy alongside hue.');
}
console.log('');
