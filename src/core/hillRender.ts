/* ============================================================
   Hill rendering — ONE white snow hill per debt.
   The ball starts at the rounded crest (0% paid) and rolls down
   the long flank to the payoff flag (100% = cleared). The hill
   is a single smooth Catmull-Rom surface with a full rounded
   snow-mound body: bright on the sunlit upper flank, soft icy
   shade below, pines tucked onto the snow and milestone flags
   along the way. No peak, no pit, no second slope — one hill,
   one direction.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, MILESTONES } from './state';

export const START = { x: 205, y: 138 };   // crest — 0% paid
export const FLAG = { x: 1120, y: 548 };   // base — 100% paid

export interface HillRef {
  container: Phaser.GameObjects.Container;
}

/* ---------- geometry: one fixed path, shared by every debt ---------- */
const CTRL = [
  { x: 205, y: 138 },
  { x: 470, y: 212 },
  { x: 800, y: 340 },
  { x: 1120, y: 548 },
];

function catmull(
  p0: { x: number; y: number }, p1: { x: number; y: number },
  p2: { x: number; y: number }, p3: { x: number; y: number }, t: number,
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

const K = 10;
const PATH: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < CTRL.length - 1; i++) {
    const p0 = CTRL[Math.max(0, i - 1)];
    const p1 = CTRL[i];
    const p2 = CTRL[i + 1];
    const p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
    for (let k = 0; k < K; k++) out.push(catmull(p0, p1, p2, p3, k / K));
  }
  out.push(CTRL[CTRL.length - 1]);
  return out;
})();

/** surface point at progress p (0 = crest, 1 = flag) */
export function pointAt(p: number): { x: number; y: number } {
  const f = Math.max(0, Math.min(1, p)) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const k = f - i;
  return {
    x: Phaser.Math.Linear(PATH[i].x, PATH[i + 1].x, k),
    y: Phaser.Math.Linear(PATH[i].y, PATH[i + 1].y, k),
  };
}

/** ball center: the surface point pushed INTO the snow by ~0.6×r,
    so the ball visibly sits ON the slope instead of hovering on the line */
export function ballPosAt(p: number, r: number): { x: number; y: number } {
  const f = Math.max(0, Math.min(1, p)) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(f));
  const k = f - i;
  const a = PATH[i];
  const b = PATH[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = r * 0.6;
  return {
    x: Phaser.Math.Linear(a.x, b.x, k) + (-dy / len) * off,
    y: Phaser.Math.Linear(a.y, b.y, k) + (dx / len) * off,
  };
}

/* ---------- shared helpers ---------- */
/** soft contact shadow under flags/trees — grounds them without "holes" */
function contactShadow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number): void {
  g.fillStyle(0x0B1524, 0.16);
  g.fillEllipse(x, y + 3, w, w * 0.36);
}

function drawPine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
  g.fillStyle(0xFFFFFF, 0.85);
  g.fillEllipse(x, y + 3, 14 * s, 5 * s);
  g.fillStyle(0xE8F4FA, 1);
  g.fillTriangle(x, y - 20 * s, x - 9 * s, y, x + 9 * s, y);
  g.fillTriangle(x, y - 31 * s, x - 7 * s, y - 9 * s, x + 7 * s, y - 9 * s);
  g.fillStyle(0xF8FCFF, 0.95);
  g.fillRect(x - 1.5, y, 3, 5 * s);
}

function drawFlagPole(
  scene: Phaser.Scene, c: Phaser.GameObjects.Container, x: number, y: number,
  color: number, label?: string, scale = 1,
): void {
  const g = scene.add.graphics();
  contactShadow(g, x, y, 16 * scale);
  g.lineStyle(3 * scale, 0x22334A, 1);
  g.beginPath();
  g.moveTo(x, y - 6);
  g.lineTo(x, y - 40 * scale);
  g.strokePath();
  g.fillStyle(0x22334A, 1);
  g.fillCircle(x, y - 6, 3.5 * scale);
  g.fillStyle(color, 1);
  g.fillTriangle(x, y - 40 * scale, x + 20 * scale, y - 34 * scale, x, y - 27 * scale);
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillTriangle(x, y - 40 * scale, x + 8 * scale, y - 36.5 * scale, x, y - 33 * scale);
  c.add(g);
  if (label) {
    const t = scene.add.text(x, y - 50 * scale, label, {
      fontFamily: '"Baloo 2"', fontSize: `${11 * scale}px`, color: '#F4F8FB',
      stroke: '#16283D', strokeThickness: 3,
    }).setOrigin(0.5);
    c.add(t);
  }
}

/** full rounded mound silhouette: surface path + rounded base on all sides */
function moundBody(): { x: number; y: number }[] {
  const body = [...PATH];
  // rounded bottom-right corner (flag → bulge → ground)
  body.push({ x: FLAG.x + 34, y: FLAG.y + 32 });
  body.push({ x: FLAG.x + 80, y: 600 });
  body.push({ x: FLAG.x + 96, y: 640 });
  // bottom edge
  body.push({ x: 92, y: 640 });
  // rounded bottom-left flank up to the crest
  body.push({ x: 110, y: 560 });
  body.push({ x: 138, y: 450 });
  body.push({ x: 166, y: 330 });
  body.push({ x: 190, y: 232 });
  body.push({ x: START.x - 8, y: START.y + 30 });
  return body;
}

/* ---------- the hill ---------- */
export function drawHill(scene: Phaser.Scene, d: Debt): HillRef {
  ensureGameTextures(scene);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);

  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const body = moundBody();

  /* ----- dark ground plane the hill sits on ----- */
  g.fillStyle(0x16283D, 1);
  g.fillRect(-40, 500, 1360, 150);
  g.fillStyle(0x1E3046, 1);
  g.fillRect(-40, 512, 1360, 138);
  g.fillStyle(0xFFFFFF, 0.08);
  g.fillRect(-40, 508, 1360, 4);
  g.fillStyle(0xFFFFFF, 0.05);
  g.fillEllipse(220, 620, 500, 60);
  g.fillEllipse(900, 630, 600, 70);

  /* ----- hill body — snow white with soft depth shading ----- */
  // soft drop shadow under the whole mound
  g.fillStyle(0x0B1524, 0.18);
  g.fillPoints(body.map((p) => ({ x: p.x, y: p.y + 9 })), true);

  // base snow
  g.fillStyle(thawed ? 0xC9F0DD : 0xEDF5FB, 1);
  g.fillPoints(body, true);

  // depth band 1 — gentle icy shade just under the surface line
  g.fillStyle(thawed ? 0xA8DFC2 : 0xD8E8F2, 0.45);
  g.fillPoints(body.map((p) => ({ x: p.x + 6, y: p.y + 26 })), true);

  // depth band 2 — deeper blue toward the base
  g.fillStyle(thawed ? 0x8FCFB0 : 0xC4DAE8, 0.5);
  g.fillPoints(body.map((p) => ({ x: p.x + 10, y: p.y + 62 })), true);

  // rounded corner bulges so the mound reads as a solid heap, not a slice
  g.fillStyle(thawed ? 0x9AD5B8 : 0xC9DAE8, 0.55);
  g.fillEllipse(120, 620, 210, 80);
  g.fillEllipse(1130, 612, 250, 96);
  g.fillStyle(thawed ? 0xC9F0DD : 0xEDF5FB, 1);
  g.fillEllipse(120, 622, 170, 52);
  g.fillEllipse(1120, 616, 190, 58);

  /* ----- soft drifts breaking up the flank (icy-tinted so they read as snow shade) ----- */
  g.fillStyle(thawed ? 0xBFE5D0 : 0xDEEAF3, 0.65);
  g.fillEllipse(465, 302, 150, 22);
  g.fillEllipse(755, 424, 170, 24);
  g.fillEllipse(985, 524, 180, 26);

  /* ----- rounded crest — the ball starts here ----- */
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillEllipse(START.x + 26, START.y + 14, 200, 60);
  g.fillStyle(thawed ? 0xBFE5D0 : 0xF0F8FD, 1);
  g.fillEllipse(START.x + 34, START.y + 20, 130, 38);
  g.fillStyle(0xFFE29A, 0.9);
  g.fillCircle(START.x - 6, START.y + 6, 2);
  g.fillCircle(START.x + 60, START.y + 16, 1.6);

  /* ----- bright ribbon along the top edge (the roll line) ----- */
  g.lineStyle(7, thawed ? 0xDFF7EA : 0xFFFFFF, 0.35);
  g.beginPath();
  g.moveTo(PATH[0].x, PATH[0].y);
  for (const p of PATH) g.lineTo(p.x, p.y);
  g.strokePath();
  g.lineStyle(2.5, thawed ? 0x7FCFA8 : 0xFFFFFF, 0.95);
  g.beginPath();
  g.moveTo(PATH[0].x, PATH[0].y);
  for (const p of PATH) g.lineTo(p.x, p.y);
  g.strokePath();

  /* ----- snowy pines tucked onto the upper-mid flank ----- */
  for (let i = 0; i < 4; i++) {
    const t = 0.4 + i * 0.12;
    const pos = pointAt(t);
    drawPine(g, pos.x + (i % 2 ? 18 : -20), pos.y + 4, 0.7 + ((i * 37) % 10) / 14);
  }

  /* ----- start marker + milestone flags along the way (hidden once cleared —
         the celebration takes the stage) ----- */
  if (!thawed) {
    drawFlagPole(scene, c, START.x, START.y - 6, 0x3E92CC, 'START', 0.8);
    MILESTONES.forEach((t) => {
      const pos = pointAt(t);
      const crossed = paid >= t;
      drawFlagPole(scene, c, pos.x, pos.y - 8, crossed ? 0x5FC9A8 : 0xF2B84B, `${Math.round(t * 100)}%`, 0.8);
    });
  }

  /* ----- payoff flag at the bottom ----- */
  drawFlagPole(scene, c, FLAG.x, FLAG.y - 10, thawed ? 0x5FC9A8 : 0xFF6B4A, 'PAYOFF', 1.1);
  g.fillStyle(0xFFFFFF, 0.85);
  g.fillEllipse(FLAG.x, FLAG.y + 12, 120, 18);

  return { container: c };
}

/* ============================================================
   Overview skyline: rounded white hills, one per debt, with the
   ball marker at its current position on the flank.
   ============================================================ */
function miniPath(w: number, h: number): { x: number; y: number }[] {
  const ctrl = [
    { x: -w * 0.52, y: -h * 0.35 },
    { x: -w * 0.2, y: -h },
    { x: w * 0.3, y: -h * 0.5 },
    { x: w * 0.52, y: 0 },
  ];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < K; k++) out.push(catmull(p0, p1, p2, p3, k / K));
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

export function drawMiniHill(
  scene: Phaser.Scene, x: number, baseY: number, w: number, d: Debt, idx: number,
): Phaser.GameObjects.Container {
  ensureGameTextures(scene);
  const c = scene.add.container(x, baseY);
  const g = scene.add.graphics();
  c.add(g);
  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const h = Math.max(64, 150 - Math.min(130, d.balance / 220));
  const pts = miniPath(w, h);

  // hill body — bright snow, full rounded mound (no vertical cuts)
  const body = [...pts, { x: w * 0.52, y: 0 }, { x: -w * 0.52, y: 0 }];
  g.fillStyle(thawed ? 0xC9F0DD : 0xF7FBFF, 1);
  g.fillPoints(body, true);
  // lower flank shade
  const shade = pts.map((p) => ({ x: p.x + 4, y: p.y + 11 }));
  g.fillStyle(thawed ? 0xA8DFC2 : 0xE2EDF6, 0.85);
  g.fillPoints([...shade, { x: w * 0.52, y: 0 }, { x: -w * 0.52, y: 0 }], true);
  // crest highlight (overlaps the body — no floating cap)
  g.fillStyle(0xFFFFFF, 0.95);
  g.fillEllipse(-w * 0.16, -h + 6, w * 0.32, 12);
  g.fillStyle(0xF4FAFD, 0.9);
  g.fillEllipse(-w * 0.18, -h + 8, w * 0.2, 8);

  // ball marker at its honest position (%-of-balance paid)
  const p = Math.max(0, Math.min(1, paid));
  const f = p * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const bx = Phaser.Math.Linear(pts[i].x, pts[i + 1].x, k);
  const by = Phaser.Math.Linear(pts[i].y, pts[i + 1].y, k);
  const r = 3 + 3.2 * paid; // mini ball grows with the debt too
  g.fillStyle(0xFFFFFF, 1);
  g.fillCircle(bx, by, r);
  g.lineStyle(1.5, 0x3E92CC, 1);
  g.beginPath();
  g.arc(bx, by, r, 0, Math.PI * 2);
  g.strokePath();

  // cleared sparkle
  if (thawed) {
    g.fillStyle(0xFFE29A, 1);
    g.fillCircle(-w * 0.32, -h * 0.55, 3);
    g.fillCircle(w * 0.28, -h * 0.4, 2);
    g.fillCircle(-w * 0.05, -h - 14, 3);
  }

  // labels
  const name = scene.add.text(0, 18, d.name, {
    fontFamily: '"Baloo 2"', fontSize: '14px', color: '#F4F8FB',
    stroke: '#0F1A2E', strokeThickness: 4,
  }).setOrigin(0.5, 0);
  c.add(name);
  const sub = scene.add.text(0, 36, thawed ? 'PAID OFF 🎉' : `${principalLeft(d) >= 1000 ? '£' + (principalLeft(d) / 1000).toFixed(1) + 'k' : '£' + Math.round(principalLeft(d))} · APR ${d.apr}%`, {
    fontFamily: '"JetBrains Mono"', fontSize: '10.5px', color: '#B7C7D6',
    stroke: '#0F1A2E', strokeThickness: 3,
  }).setOrigin(0.5, 0);
  c.add(sub);

  // tap zone
  const zone = scene.add.zone(0, -h * 0.5, w + 40, h + 70);
  c.add(zone);
  zone.setData('debtIdx', idx);
  zone.setSize(w + 40, h + 70).setInteractive({ useHandCursor: true });
  return c;
}
