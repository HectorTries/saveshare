/* ============================================================
   Level-screen slope — v8. Each LEVEL is its own screen: a single
   short downhill slope the snowball rolls down. Clear it and the
   loop flows straight into the next level's slope. A £500 payment
   (5 levels) rolls the ball through 5 slopes back-to-back.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, LEVELS, levelsCleared } from './state';

export const START = { x: 250, y: 158 };   // crest — top of this level's slope
export const FLAG = { x: 1030, y: 500 };   // base — bottom / finish line

export interface HillRef { container: Phaser.GameObjects.Container; }

/* ---------- one smooth downhill curve ---------- */
const CTRL = [
  { x: 250, y: 158 },
  { x: 470, y: 244 },
  { x: 760, y: 372 },
  { x: 1030, y: 500 },
];

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

const K = 12;
const PATH: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < CTRL.length - 1; i++) {
    const p0 = CTRL[Math.max(0, i - 1)], p1 = CTRL[i], p2 = CTRL[i + 1], p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
    for (let k = 0; k < K; k++) out.push(catmull(p0, p1, p2, p3, k / K));
  }
  out.push(CTRL[CTRL.length - 1]);
  return out;
})();

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** surface point at within-level fraction p (0 = crest, 1 = base) */
export function pointAt(p: number): { x: number; y: number } {
  const f = clamp01(p) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const k = f - i;
  return {
    x: Phaser.Math.Linear(PATH[i].x, PATH[i + 1].x, k),
    y: Phaser.Math.Linear(PATH[i].y, PATH[i + 1].y, k),
  };
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

/* ---------- helpers ---------- */
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

  /* ground */
  g.fillStyle(0x1B3049, 1); g.fillRect(-40, 566, 1360, 84);
  g.fillStyle(0x233A5B, 1); g.fillRect(-40, 576, 1360, 74);
  g.fillStyle(0xFFE2A8, 0.07); g.fillEllipse(640, 620, 1150, 72);

  /* rounded snow mound following the slope */
  const body = [...PATH, { x: FLAG.x + 40, y: FLAG.y + 30 }, { x: FLAG.x + 90, y: 646 }, { x: -40, y: 646 }, { x: -40, y: 190 }, { x: START.x - 20, y: START.y + 10 }];
  g.fillStyle(thawed ? 0xC9F0DD : 0xEDF5FB, 1);
  g.fillPoints(body, true);

  // lower-face shade
  const shade = PATH.map((p, i) => {
    const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * 26, y: p.y + (dx / len) * 26 };
  });
  g.fillStyle(thawed ? 0xA8DFC2 : 0xC9DDEB, 0.55);
  g.fillPoints([...shade, { x: FLAG.x + 40, y: FLAG.y + 30 }, { x: FLAG.x + 90, y: 646 }, { x: -40, y: 646 }, { x: -40, y: 190 }, { x: START.x - 20, y: START.y + 10 }], true);

  /* bright roll line */
  g.lineStyle(5, thawed ? 0xDFF7EA : 0xFFFFFF, 0.4);
  g.beginPath(); g.moveTo(PATH[0].x, PATH[0].y);
  for (const p of PATH) g.lineTo(p.x, p.y);
  g.strokePath();

  /* summit snowcap */
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillEllipse(START.x + 4, START.y - 6, 130, 44);
  g.fillStyle(thawed ? 0xBFE5D0 : 0xEAF3FA, 1);
  g.fillEllipse(START.x + 8, START.y - 2, 84, 30);

  /* finish line / gate at the base */
  g.fillStyle(0xFFB84B, 0.30);
  g.fillEllipse(FLAG.x, FLAG.y + 24, 170, 40);
  g.fillStyle(0xFF6B4A, 0.16);
  g.fillEllipse(FLAG.x, FLAG.y + 24, 120, 30);
  // finish gate posts
  g.lineStyle(4, 0x22334A, 1);
  g.beginPath(); g.moveTo(FLAG.x - 26, FLAG.y - 30); g.lineTo(FLAG.x - 26, FLAG.y + 6); g.strokePath();
  g.beginPath(); g.moveTo(FLAG.x + 26, FLAG.y - 30); g.lineTo(FLAG.x + 26, FLAG.y + 6); g.strokePath();
  g.lineStyle(3, thawed ? 0x5FC9A8 : 0xFF6B4A, 1);
  g.beginPath(); g.moveTo(FLAG.x - 26, FLAG.y - 26); g.lineTo(FLAG.x + 26, FLAG.y - 26); g.strokePath();

  /* pines */
  pine(g, 140, 610, 1.2); pine(g, 178, 626, 0.9);
  pine(g, 1140, 612, 1.25); pine(g, 1180, 628, 0.9);

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

  // progress fill (cleared portion tinted green)
  const px = -w * 0.34 + paid * (w * 0.84);
  g.fillStyle(0x5FC9A8, 0.35);
  g.fillPoints([{ x: -w * 0.34, y: -h }, { x: px, y: -h + paid * (h * 0.62) }, { x: px, y: 0 }, { x: -w * 0.34, y: 0 }], true);

  // ball marker
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
