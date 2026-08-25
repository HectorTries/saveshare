/* ============================================================
   Summit mountain rendering.
   Geometry: peak at the centre, right slope descends to the
   payoff flag, left slope descends to the spiral pit.
   Right-slope segments have weighted drops ∝ terrain steepness,
   normalised so the flag always sits at the fixed base point —
   flattening ahead of the ball makes the REMAINING climb gentler.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, SEGMENTS } from './state';

export const PEAK = { x: 640, y: 168 };
export const FLAG = { x: 1132, y: 548 };
export const PIT = { x: 148, y: 502 };

export interface MountainRef {
  container: Phaser.GameObjects.Container;
  swirl: Phaser.GameObjects.Graphics;
}

/* ---------- geometry ---------- */
export function terrainPoints(d: Debt): { x: number; y: number }[] {
  const totalDrop = FLAG.y - PEAK.y;
  const sum = d.terrain.reduce((a, b) => a + b, 0) || 1;
  const pts: { x: number; y: number }[] = [{ x: PEAK.x, y: PEAK.y }];
  let y = PEAK.y;
  for (let i = 0; i < SEGMENTS; i++) {
    const x = PEAK.x + ((FLAG.x - PEAK.x) * (i + 1)) / SEGMENTS;
    y += totalDrop * (d.terrain[i] / sum);
    pts.push({ x, y });
  }
  return pts;
}

/** ball position on the mountain for a progress value (0 peak, 1 flag, <0 left slope) */
export function pointAt(d: Debt, progress: number): { x: number; y: number } {
  if (progress < 0) {
    const t = Math.min(1, -progress / 0.35);
    return {
      x: Phaser.Math.Linear(PEAK.x, PIT.x, t),
      y: Phaser.Math.Linear(PEAK.y, PIT.y, t),
    };
  }
  const pts = terrainPoints(d);
  const f = Math.max(0, Math.min(1, progress)) * SEGMENTS;
  const i = Math.min(SEGMENTS - 1, Math.floor(f));
  const k = f - i;
  return {
    x: Phaser.Math.Linear(pts[i].x, pts[i + 1].x, k),
    y: Phaser.Math.Linear(pts[i].y, pts[i + 1].y, k),
  };
}

export function ballRadius(d: Debt): number {
  return 16 + 9 * pctPaid(d);
}

/* ---------- shared helpers ---------- */
function lerpColor(c1: number, c2: number, t: number): number {
  const a = Phaser.Display.Color.ValueToColor(c1);
  const b = Phaser.Display.Color.ValueToColor(c2);
  const r = Math.round(a.red + (b.red - a.red) * t);
  const g = Math.round(a.green + (b.green - a.green) * t);
  const bl = Math.round(a.blue + (b.blue - a.blue) * t);
  return Phaser.Display.Color.GetColor(r, g, bl);
}

function drawPine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
  g.fillStyle(0x2E4A57, 1);
  g.fillTriangle(x, y - 22 * s, x - 9 * s, y, x + 9 * s, y);
  g.fillTriangle(x, y - 34 * s, x - 7 * s, y - 10 * s, x + 7 * s, y - 10 * s);
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillRect(x - 1.5, y, 3, 6 * s);
}

function drawFlagPole(
  scene: Phaser.Scene, c: Phaser.GameObjects.Container, x: number, y: number,
  color: number, label?: string, scale = 1,
): void {
  const g = scene.add.graphics();
  g.lineStyle(3 * scale, 0x22334A, 1);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 34 * scale);
  g.strokePath();
  g.fillStyle(0x22334A, 1);
  g.fillCircle(x, y, 3.5 * scale);
  g.fillStyle(color, 1);
  g.fillTriangle(x, y - 34 * scale, x + 20 * scale, y - 28 * scale, x, y - 21 * scale);
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillTriangle(x, y - 34 * scale, x + 8 * scale, y - 30.5 * scale, x, y - 27 * scale);
  c.add(g);
  if (label) {
    const t = scene.add.text(x, y - 44 * scale, label, {
      fontFamily: '"Baloo 2"', fontSize: `${11 * scale}px`, color: '#F4F8FB',
      stroke: '#16283D', strokeThickness: 3,
    }).setOrigin(0.5);
    c.add(t);
  }
}

/* ---------- main mountain ---------- */
export function drawMountain(scene: Phaser.Scene, d: Debt): MountainRef {
  ensureGameTextures(scene);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);

  const pts = terrainPoints(d);
  const paid = pctPaid(d);
  const thawed = paid >= 1;

  /* ----- left slope (the spiral side — always steep, never flattens) ----- */
  g.fillStyle(0x33435E, 1);
  g.fillTriangle(PEAK.x, PEAK.y, PIT.x, PIT.y, PEAK.x - 60, PEAK.y + 180);
  g.fillStyle(0x26354C, 1);
  g.fillTriangle(PIT.x - 40, PIT.y + 60, PIT.x, PIT.y, PIT.x + 40, PIT.y + 60);
  // rock shading lines
  g.lineStyle(2, 0x4A5C7A, 0.5);
  for (let i = 0; i < 6; i++) {
    const t = (i + 1) / 7;
    const x1 = Phaser.Math.Linear(PEAK.x, PIT.x, t);
    const y1 = Phaser.Math.Linear(PEAK.y, PIT.y, t);
    g.beginPath();
    g.moveTo(x1 - 6, y1 + 8);
    g.lineTo(x1 + 6, y1 + 18);
    g.strokePath();
  }
  // danger label near the pit
  const pitLbl = scene.add.text(PIT.x, PIT.y - 34, 'THE SPIRAL', {
    fontFamily: '"Baloo 2"', fontSize: '13px', color: '#8FA4C4',
    stroke: '#16283D', strokeThickness: 4,
  }).setOrigin(0.5);
  c.add(pitLbl);

  /* ----- right slope — one polygon, then bench highlights ----- */
  // base fill with vertical gradient feel (two passes)
  const bodyPts = [...pts, { x: FLAG.x + 40, y: FLAG.y + 60 }, { x: PEAK.x - 30, y: PEAK.y + 170 }];
  g.fillStyle(thawed ? 0x7FCFA8 : 0xDFF1F9, 1);
  g.fillPoints(bodyPts, true);
  // shaded under-layer for depth
  g.fillStyle(thawed ? 0x4FA97F : 0xB8D9E8, 1);
  const shadePts = [...pts, { x: FLAG.x + 40, y: FLAG.y + 60 }, { x: PEAK.x - 30, y: PEAK.y + 170 }];
  for (let i = 0; i < shadePts.length; i++) {
    shadePts[i] = { x: shadePts[i].x, y: shadePts[i].y + 8 };
  }
  g.fillPoints(shadePts, true);

  // per-segment top surface — flattened segments show as lighter benches
  for (let i = 0; i < SEGMENTS; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const s = d.terrain[i];
    const flatness = 1 - s; // 0 steep → 1 flat
    const topCol = thawed
      ? lerpColor(0x7FCFA8, 0xDFF7EA, flatness)
      : lerpColor(0xEAF7FC, 0xFFFFFF, flatness * 0.9);
    g.fillStyle(topCol, 1);
    g.fillTriangle(a.x, a.y, b.x, b.y, b.x, b.y + 10);
    g.fillTriangle(a.x, a.y, b.x, b.y + 10, a.x, a.y + 10);
    // bench edge on flattened segments
    if (flatness > 0.35) {
      g.lineStyle(2, thawed ? 0x5FBF92 : 0xBFE3F2, 0.9);
      g.beginPath();
      g.moveTo(a.x, a.y + 1);
      g.lineTo(b.x, b.y + 1);
      g.strokePath();
    }
  }

  // a few pines on the lower right slope
  for (let i = 0; i < 5; i++) {
    const t = 0.55 + i * 0.09;
    const x = Phaser.Math.Linear(PEAK.x, FLAG.x, t);
    const y = pts[Math.min(SEGMENTS, Math.floor(t * SEGMENTS))].y - 6;
    const s = 0.7 + ((i * 37) % 10) / 12;
    drawPine(g, x + (i % 2 ? 14 : -16), y, s);
  }

  /* ----- snowcap at the peak ----- */
  g.fillStyle(0xFFFFFF, 1);
  g.fillTriangle(PEAK.x - 26, PEAK.y + 8, PEAK.x + 26, PEAK.y + 8, PEAK.x, PEAK.y - 12);
  g.fillStyle(0xEAF7FC, 1);
  g.fillTriangle(PEAK.x - 16, PEAK.y + 4, PEAK.x, PEAK.y - 8, PEAK.x + 4, PEAK.y + 4);
  // small "START" dot at the peak
  g.fillStyle(0xF2B84B, 1);
  g.fillCircle(PEAK.x, PEAK.y - 2, 4);
  const startLbl = scene.add.text(PEAK.x, PEAK.y + 20, 'start', {
    fontFamily: '"Baloo 2"', fontSize: '11px', color: '#8FA4C4',
    stroke: '#16283D', strokeThickness: 3,
  }).setOrigin(0.5);
  c.add(startLbl);

  /* ----- milestone flags at 25/50/75 along the right slope ----- */
  [0.25, 0.5, 0.75].forEach((t) => {
    const i = Math.floor(t * SEGMENTS);
    const f = t * SEGMENTS - i;
    const x = Phaser.Math.Linear(pts[i].x, pts[i + 1].x, f);
    const y = Phaser.Math.Linear(pts[i].y, pts[i + 1].y, f);
    const crossed = paid >= t;
    drawFlagPole(scene, c, x, y - 6, crossed ? 0x5FC9A8 : 0xF2B84B, `${Math.round(t * 100)}%`, 0.8);
  });

  /* ----- payoff flag ----- */
  drawFlagPole(scene, c, FLAG.x, FLAG.y - 10, thawed ? 0x5FC9A8 : 0xFF6B4A, 'PAYOFF', 1.1);
  g.fillStyle(0xFFFFFF, 0.85);
  g.fillEllipse(FLAG.x, FLAG.y + 6, 90, 14);

  /* ----- spiral pit swirl (animated by the scene) ----- */
  const swirl = scene.add.graphics();
  c.add(swirl);
  drawSwirl(swirl, PIT.x, PIT.y + 14, 0);

  return { container: c, swirl };
}

export function drawSwirl(g: Phaser.GameObjects.Graphics, x: number, y: number, rot: number): void {
  g.clear();
  const cols = [0x16283D, 0x2A3D5C, 0x3D5274];
  for (let ring = 0; ring < 3; ring++) {
    const r = 14 + ring * 11;
    g.lineStyle(4 - ring, cols[ring], 0.85 - ring * 0.2);
    g.beginPath();
    const start = rot + ring * 1.4;
    for (let a = 0; a <= Math.PI * 1.9; a += 0.25) {
      const px = x + Math.cos(start + a) * r;
      const py = y + Math.sin(start + a) * r * 0.55;
      if (a === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }
  // core
  g.fillStyle(0x0E1B2E, 0.9);
  g.fillCircle(x, y, 7);
  g.fillStyle(0x8FA4C4, 0.8);
  g.fillCircle(x, y, 3);
}

/* ============================================================
   Overview skyline: one mini mountain per debt with the ball
   marker at its current position.
   ============================================================ */
export function drawMiniMountain(
  scene: Phaser.Scene, x: number, baseY: number, w: number, d: Debt, idx: number,
): Phaser.GameObjects.Container {
  ensureGameTextures(scene);
  const c = scene.add.container(x, baseY);
  const g = scene.add.graphics();
  c.add(g);
  const paid = pctPaid(d);
  const thawed = paid >= 1;
  const h = Math.max(100, 190 - Math.min(160, d.balance / 160)); // bigger debt → taller peak
  const peakX = 0;
  const peakY = -h;
  const rightX = w / 2;
  const leftX = -w / 2;
  const rightY = 0;
  const leftY = -h * 0.45;

  // mountain body
  g.fillStyle(thawed ? 0x7FCFA8 : 0x3E5A76, 1);
  g.fillTriangle(peakX, peakY, rightX, rightY, leftX, leftY + 6);
  g.fillStyle(thawed ? 0xDFF7EA : 0xDCEAF2, 1);
  g.fillTriangle(peakX, peakY, peakX + rightX * 0.7, peakY + h * 0.42, peakX - rightX * 0.55, peakY + h * 0.5);
  // right slope surface (the playable side)
  g.fillStyle(thawed ? 0x9FDDBB : 0xEAF7FC, 1);
  g.fillTriangle(peakX, peakY, rightX, rightY, peakX + 8, peakY + h * 0.45);

  // ball marker at progress (clamped to the mini right slope)
  const p = Math.max(0, Math.min(1, d.progress));
  const bx = Phaser.Math.Linear(peakX, rightX, p);
  const by = Phaser.Math.Linear(peakY, rightY, p);
  g.fillStyle(0xFFFFFF, 1);
  g.fillCircle(bx, by, 4);
  g.lineStyle(1.5, 0x3E92CC, 1);
  g.beginPath();
  g.arc(bx, by, 4, 0, Math.PI * 2);
  g.strokePath();

  // cleared sparkle
  if (thawed) {
    g.fillStyle(0xFFE29A, 1);
    g.fillCircle(-w * 0.32, -h * 0.7, 3);
    g.fillCircle(w * 0.28, -h * 0.5, 2);
    g.fillCircle(0, -h - 10, 3);
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
