/* ============================================================
   Staircase hill — v7. Each debt is a 100-step staircase down a
   snowy slope. Every step = 1% of the original balance (a discrete
   LEVEL). The snowball rolls down the steps; each step it passes
   turns to green grass behind it. 100 steps, 100 win-moments.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, MILESTONES, LEVELS, levelsCleared } from './state';

export const START = { x: 258, y: 176 };   // summit — level 1 begins here
export const FLAG = { x: 1012, y: 534 };   // base — level 100 / payoff

const STEPS = LEVELS;                       // 100
const stepW = (FLAG.x - START.x) / STEPS;   // tread width
const stepH = (FLAG.y - START.y) / STEPS;   // riser height

export interface HillRef { container: Phaser.GameObjects.Container; }

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** ball/flags ride a smooth line just above the staircase centre */
export function pointAt(p: number): { x: number; y: number } {
  const f = clamp01(p);
  return { x: START.x + f * (FLAG.x - START.x), y: START.y + f * (FLAG.y - START.y) };
}

export function ballPosAt(p: number, r: number): { x: number; y: number } {
  const s = pointAt(p);
  return { x: s.x, y: s.y - r * 0.52 };
}

/* ---------- shared drawing bits ---------- */
function pine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillEllipse(x, y + 3, 16 * s, 6 * s);
  g.fillStyle(0xE9F4FA, 1);
  g.fillTriangle(x, y - 22 * s, x - 10 * s, y, x + 10 * s, y);
  g.fillTriangle(x, y - 34 * s, x - 8 * s, y - 10 * s, x + 8 * s, y - 10 * s);
  g.fillStyle(0xF8FCFF, 0.95);
  g.fillRect(x - 1.5, y, 3, 6 * s);
}

function flagPole(
  scene: Phaser.Scene, c: Phaser.GameObjects.Container, x: number, y: number,
  color: number, label?: string, scale = 1,
): void {
  const g = scene.add.graphics();
  g.fillStyle(0x0B1524, 0.18);
  g.fillEllipse(x, y + 4, 18 * scale, 7 * scale);
  g.lineStyle(3 * scale, 0x22334A, 1);
  g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y - 44 * scale); g.strokePath();
  g.fillStyle(0x22334A, 1);
  g.fillCircle(x, y - 6, 4 * scale);
  g.fillStyle(color, 1);
  g.fillTriangle(x, y - 44 * scale, x + 22 * scale, y - 37 * scale, x, y - 30 * scale);
  c.add(g);
  if (label) {
    const t = scene.add.text(x, y - 56 * scale, label, {
      fontFamily: '"Baloo 2"', fontSize: `${12 * scale}px`, color: '#F4F8FB',
      stroke: '#16283D', strokeThickness: 4,
    }).setOrigin(0.5);
    c.add(t);
  }
}

/* ---------- the staircase slope ---------- */
export function drawHill(scene: Phaser.Scene, d: Debt): HillRef {
  ensureGameTextures(scene);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);

  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const lv = levelsCleared(d);

  /* ----- soft ground with a warm horizon ----- */
  g.fillStyle(0x1B3049, 1); g.fillRect(-40, 566, 1360, 84);
  g.fillStyle(0x233A5B, 1); g.fillRect(-40, 576, 1360, 74);
  g.fillStyle(0xFFE2A8, 0.07); g.fillEllipse(640, 620, 1150, 72);

  /* ----- big smooth snow slope (rounded silhouette, follows the descent) ----- */
  const slope: { x: number; y: number }[] = [
    { x: 130, y: 640 }, { x: 92, y: 470 }, { x: 122, y: 300 },
    { x: 204, y: 168 }, { x: 306, y: 116 }, { x: 424, y: 116 },
    { x: 560, y: 182 }, { x: 720, y: 300 }, { x: 900, y: 440 },
    { x: 1060, y: 560 }, { x: 1224, y: 640 },
  ];
  g.fillStyle(thawed ? 0xD6F2E2 : 0xEDF5FB, 1);
  g.fillPoints(slope, true);
  // lower-face shade
  g.fillStyle(thawed ? 0xA8DFC2 : 0xC9DDEB, 0.55);
  g.fillPoints([
    { x: 424, y: 116 }, { x: 560, y: 182 }, { x: 720, y: 300 }, { x: 900, y: 440 },
    { x: 1060, y: 560 }, { x: 1224, y: 640 }, { x: 130, y: 640 }, { x: 92, y: 470 },
    { x: 122, y: 300 }, { x: 204, y: 168 }, { x: 306, y: 116 },
  ], true);

  /* ----- the 100 bold steps ----- */
  for (let i = 0; i < STEPS; i++) {
    const x0 = START.x + i * stepW;
    const y0 = START.y + i * stepH;
    const cleared = i < lv;
    // riser (dark front face)
    g.fillStyle(cleared ? 0x2E8F66 : 0x66809A);
    g.fillRect(x0 + stepW - 1, y0, 2.4, stepH + 1);
    // tread (bright top face)
    g.fillStyle(cleared ? 0x54C48F : 0xFDFEFF);
    g.fillRect(x0, y0 - 1.5, stepW + 0.4, 4);
  }

  /* ----- cleared "melted" wash (more visible) ----- */
  if (paid > 0 && !thawed) {
    const px = START.x + paid * (FLAG.x - START.x);
    const py = START.y + paid * (FLAG.y - START.y);
    g.fillStyle(0x5FC9A8, 0.12);
    g.fillTriangle(START.x - 12, START.y - 22, px, py, START.x - 170, py);
  }

  /* ----- gold tread on the step you're currently clearing ----- */
  if (!thawed && lv < STEPS) {
    const x0 = START.x + lv * stepW;
    const y0 = START.y + lv * stepH;
    g.fillStyle(0xF2B84B, 0.95);
    g.fillRect(x0, y0 - 1.5, stepW + 0.4, 4);
    g.fillStyle(0xFFE29A, 0.7);
    g.fillRect(x0, y0 - 1.5, stepW + 0.4, 1.4);
  }

  /* ----- summit snowcap + payoff warm glow ----- */
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillEllipse(START.x - 8, START.y - 24, 62, 26);
  g.fillStyle(thawed ? 0xBFE5D0 : 0xEAF3FA, 1);
  g.fillEllipse(START.x - 10, START.y - 18, 42, 16);
  g.fillStyle(0xFFB84B, 0.28);
  g.fillEllipse(FLAG.x, FLAG.y + 22, 170, 40);
  g.fillStyle(0xFF8A5C, 0.16);
  g.fillEllipse(FLAG.x, FLAG.y + 22, 120, 30);

  /* ----- pines at the base ----- */
  pine(g, 120, 600, 1.2); pine(g, 160, 618, 0.9);
  pine(g, 1140, 604, 1.25); pine(g, 1180, 620, 0.9);

  /* ----- flags ----- */
  if (!thawed) {
    flagPole(scene, c, START.x - 6, START.y - 30, 0x3E92CC, 'START', 0.85);
    MILESTONES.forEach((t) => {
      const pos = pointAt(t);
      flagPole(scene, c, pos.x, pos.y - 14, paid >= t ? 0x5FC9A8 : 0xF2B84B, `${Math.round(t * 100)}%`, 0.8);
    });
  }
  flagPole(scene, c, FLAG.x, FLAG.y - 14, thawed ? 0x5FC9A8 : 0xFF6B4A, 'PAYOFF', 1.15);

  return { container: c };
}

/* ---------- overview mini-hill: small staircase + level count ---------- */
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

  for (let i = 0; i < 6; i++) {
    const t = (i + 1) / 7;
    const px = -w * 0.34 + t * (w * 0.84);
    const py = -h + t * (h * 0.62);
    g.fillStyle(t <= paid ? 0x54BE8B : 0x7E96AE);
    g.fillRect(px, py, w * 0.08, 2.4);
  }

  const p = Math.max(0, Math.min(1, paid));
  const bx = -w * 0.34 + p * (w * 0.84);
  const by = -h + p * (h * 0.62);
  const r = 3 + 3.2 * paid;
  g.fillStyle(0xFFFFFF, 1);
  g.fillCircle(bx, by, r);
  g.lineStyle(1.5, 0x3E92CC, 1);
  g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.strokePath();

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
