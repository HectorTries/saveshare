/* ============================================================
   Level-screen slope — responsive. Each LEVEL is its own screen:
   a single downhill slope the snowball rolls down. The slope path
   is computed from the current game size, so it flows top→bottom
   on portrait phones and across on landscape.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, LEVELS, levelsCleared } from './state';

let W = 1280;
let H = 720;

export let START = { x: 230, y: 158 };
export let FLAG = { x: 1050, y: 504 };

export interface HillRef { container: Phaser.GameObjects.Container; }

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/* ---------- one smooth downhill curve, sized to W×H ---------- */
let CTRL: { x: number; y: number }[] = [];
let PATH: { x: number; y: number }[] = [];

function buildPath(): void {
  CTRL = [
    { x: 0.18 * W, y: 0.22 * H },
    { x: 0.36 * W, y: 0.38 * H },
    { x: 0.58 * W, y: 0.50 * H },
    { x: 0.82 * W, y: 0.70 * H },
  ];
  START = { x: CTRL[0].x, y: CTRL[0].y };
  FLAG = { x: CTRL[3].x, y: CTRL[3].y };
  const K = 12;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < CTRL.length - 1; i++) {
    const p0 = CTRL[Math.max(0, i - 1)], p1 = CTRL[i], p2 = CTRL[i + 1], p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
    for (let k = 0; k < K; k++) out.push(catmull(p0, p1, p2, p3, k / K));
  }
  out.push(CTRL[CTRL.length - 1]);
  PATH = out;
}
function catmull(
  p0: { x: number; y: number }, p1: { x: number; y: number },
  p2: { x: number; y: number }, p3: { x: number; y: number }, t: number,
): { x: number; y: number } {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

buildPath();

/** recompute the slope for a new game size (called on resize) */
export function setHillSize(w: number, h: number): void {
  if (w <= 0 || h <= 0 || (w === W && h === H)) return;
  W = w; H = h;
  buildPath();
}

/** surface point at within-level fraction p (0 = crest, 1 = base) */
export function pointAt(p: number): { x: number; y: number } {
  const f = clamp01(p) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const k = f - i;
  return { x: Phaser.Math.Linear(PATH[i].x, PATH[i + 1].x, k), y: Phaser.Math.Linear(PATH[i].y, PATH[i + 1].y, k) };
}

/** ball centre: pushed into the snow so it sits ON the slope */
export function ballPosAt(p: number, r: number): { x: number; y: number } {
  const f = clamp01(p) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const k = f - i;
  const a = PATH[i], b = PATH[i + 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: Phaser.Math.Linear(a.x, b.x, k) + (-dy / len) * r * 0.6,
    y: Phaser.Math.Linear(a.y, b.y, k) + (dx / len) * r * 0.6,
  };
}

function pine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillEllipse(x, y + 3, 16 * s, 6 * s);
  g.fillStyle(0xE9F4FA, 1);
  g.fillTriangle(x, y - 22 * s, x - 10 * s, y, x + 10 * s, y);
  g.fillTriangle(x, y - 34 * s, x - 8 * s, y - 10 * s, x + 8 * s, y - 10 * s);
  g.fillStyle(0xF8FCFF, 0.95);
  g.fillRect(x - 1.5, y, 3, 6 * s);
}

/* ---------- the single slope (one screen per level) ---------- */
export function drawHill(scene: Phaser.Scene, d: Debt): HillRef {
  ensureGameTextures(scene);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);

  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const gy = H * 0.88;

  /* ground */
  g.fillStyle(0x1B3049, 1); g.fillRect(-W * 0.05, gy, W * 1.1, H - gy);
  g.fillStyle(0x233A5B, 1); g.fillRect(-W * 0.05, gy + 10, W * 1.1, H - gy - 10);
  g.fillStyle(0xFFE2A8, 0.07); g.fillEllipse(W * 0.5, gy + 50, W * 0.9, H * 0.1);

  /* rounded snow mound following the slope */
  const body: { x: number; y: number }[] = [
    ...PATH,
    { x: FLAG.x + W * 0.03, y: FLAG.y + H * 0.04 },
    { x: FLAG.x + W * 0.07, y: H * 1.05 },
    { x: -W * 0.05, y: H * 1.05 },
    { x: -W * 0.05, y: H * 0.30 },
    { x: START.x - W * 0.02, y: START.y + H * 0.02 },
  ];
  g.fillStyle(thawed ? 0xC9F0DD : 0xEDF5FB, 1);
  g.fillPoints(body, true);

  const shade = PATH.map((p, i) => {
    const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * (H * 0.04), y: p.y + (dx / len) * (H * 0.04) };
  });
  g.fillStyle(thawed ? 0xA8DFC2 : 0xC9DDEB, 0.55);
  g.fillPoints([...shade, { x: FLAG.x + W * 0.03, y: FLAG.y + H * 0.04 }, { x: FLAG.x + W * 0.07, y: H * 1.05 }, { x: -W * 0.05, y: H * 1.05 }, { x: -W * 0.05, y: H * 0.30 }, { x: START.x - W * 0.02, y: START.y + H * 0.02 }], true);

  /* bright roll line */
  g.lineStyle(Math.max(3, H * 0.008), thawed ? 0xDFF7EA : 0xFFFFFF, 0.4);
  g.beginPath(); g.moveTo(PATH[0].x, PATH[0].y);
  for (const p of PATH) g.lineTo(p.x, p.y);
  g.strokePath();

  /* summit snowcap */
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillEllipse(START.x + W * 0.003, START.y - H * 0.01, W * 0.10, H * 0.07);
  g.fillStyle(thawed ? 0xBFE5D0 : 0xEAF3FA, 1);
  g.fillEllipse(START.x + W * 0.006, START.y - H * 0.004, W * 0.065, H * 0.045);

  /* finish line / gate at the base */
  g.fillStyle(0xFFB84B, 0.30);
  g.fillEllipse(FLAG.x, FLAG.y + H * 0.035, W * 0.13, H * 0.06);
  g.lineStyle(Math.max(3, W * 0.004), 0x22334A, 1);
  g.beginPath(); g.moveTo(FLAG.x - W * 0.02, FLAG.y - H * 0.045); g.lineTo(FLAG.x - W * 0.02, FLAG.y + H * 0.01); g.strokePath();
  g.beginPath(); g.moveTo(FLAG.x + W * 0.02, FLAG.y - H * 0.045); g.lineTo(FLAG.x + W * 0.02, FLAG.y + H * 0.01); g.strokePath();
  g.lineStyle(Math.max(2, W * 0.003), thawed ? 0x5FC9A8 : 0xFF6B4A, 1);
  g.beginPath(); g.moveTo(FLAG.x - W * 0.02, FLAG.y - H * 0.04); g.lineTo(FLAG.x + W * 0.02, FLAG.y - H * 0.04); g.strokePath();

  /* pines */
  pine(g, W * 0.11, H * 0.95, 1.2);
  pine(g, W * 0.14, H * 0.98, 0.9);
  pine(g, W * 0.89, H * 0.96, 1.25);
  pine(g, W * 0.92, H * 0.98, 0.9);

  return { container: c };
}

/* ---------- overview mini-slope + level count ---------- */
export function drawMiniHill(
  scene: Phaser.Scene, x: number, baseY: number, w: number, d: Debt, idx: number,
): Phaser.GameObjects.Container {
  ensureGameTextures(scene);
  const c = scene.add.container(x, baseY);
  const g = scene.add.graphics();
  c.add(g);
  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const lv = levelsCleared(d);
  const h = Math.max(70, 150 - Math.min(120, d.balance / 220));

  const body: { x: number; y: number }[] = [
    { x: -w * 0.5, y: 0 }, { x: -w * 0.34, y: -h }, { x: -w * 0.05, y: -h * 0.86 },
    { x: w * 0.3, y: -h * 0.4 }, { x: w * 0.5, y: 0 },
  ];
  g.fillStyle(thawed ? 0xC9F0DD : 0xF4FAFE, 1);
  g.fillPoints(body, true);
  g.fillStyle(thawed ? 0xA8DFC2 : 0xDCEAF4, 0.55);
  g.fillPoints([
    { x: -w * 0.34, y: -h }, { x: -w * 0.05, y: -h * 0.86 }, { x: w * 0.3, y: -h * 0.4 },
    { x: w * 0.5, y: 0 }, { x: -w * 0.5, y: 0 },
  ], true);

  const px = -w * 0.34 + paid * (w * 0.84);
  g.fillStyle(0x5FC9A8, 0.35);
  g.fillPoints([{ x: -w * 0.34, y: -h }, { x: px, y: -h + paid * (h * 0.62) }, { x: px, y: 0 }, { x: -w * 0.34, y: 0 }], true);

  const r = 3 + 3.2 * paid;
  g.fillStyle(0xFFFFFF, 1);
  g.fillCircle(px, -h + paid * (h * 0.62), r);
  g.lineStyle(1.5, 0x3E92CC, 1);
  g.beginPath(); g.arc(px, -h + paid * (h * 0.62), r, 0, Math.PI * 2); g.strokePath();

  if (thawed) {
    g.fillStyle(0xFFE29A, 1);
    g.fillCircle(-w * 0.3, -h * 0.5, 3);
    g.fillCircle(w * 0.26, -h * 0.4, 2);
  }

  const name = scene.add.text(0, 20, d.name, {
    fontFamily: '"Baloo 2"', fontSize: '14px', color: '#F4F8FB',
    stroke: '#0F1A2E', strokeThickness: 4,
  }).setOrigin(0.5, 0);
  c.add(name);
  const sub = scene.add.text(0, 38, thawed ? 'PAID OFF 🎉' : `L${lv}/100 · £${principalLeft(d) >= 1000 ? (principalLeft(d) / 1000).toFixed(1) + 'k' : Math.round(principalLeft(d))}`, {
    fontFamily: '"JetBrains Mono"', fontSize: '10.5px', color: '#B7C7D6',
    stroke: '#0F1A2E', strokeThickness: 3,
  }).setOrigin(0.5, 0);
  c.add(sub);

  const zone = scene.add.zone(0, -h * 0.5, w + 40, h + 70);
  c.add(zone);
  zone.setData('debtIdx', idx);
  zone.setSize(w + 40, h + 70).setInteractive({ useHandCursor: true });
  return c;
}
