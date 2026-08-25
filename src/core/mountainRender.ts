/* ============================================================
   Summit mountain rendering.
   A smooth, rounded snow hill: peak at the centre, right slope
   descends to the payoff flag, left slope drops into the spiral
   pit. The right slope is a Catmull-Rom curve through terrain-
   weighted points; flattening shows as soft snow-benches.
   The whole hill reads as snow — bright white on the sunlit
   side, pale icy blue in shade, with a rounded dome summit.
   ============================================================ */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
import { type Debt, pctPaid, principalLeft, SEGMENTS } from './state';

export const PEAK = { x: 640, y: 150 };
export const FLAG = { x: 1132, y: 560 };
export const PIT = { x: 148, y: 500 };

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

function catmull(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, t: number): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

const K = 6;

/** dense smooth curve points for the right slope (peak → flag) */
export function smoothCurve(d: Debt): { x: number; y: number }[] {
  const pts = terrainPoints(d);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(SEGMENTS, i + 2)];
    for (let k = 0; k < K; k++) out.push(catmull(p0, p1, p2, p3, k / K));
  }
  out.push(pts[SEGMENTS]);
  return out;
}

/** left slope smooth curve (peak → pit) */
function leftCurve(): { x: number; y: number }[] {
  const ctrl = [
    { x: PEAK.x, y: PEAK.y },
    { x: PEAK.x - 130, y: PEAK.y + 80 },
    { x: PEAK.x - 210, y: PEAK.y + 200 },
    { x: PIT.x, y: PIT.y },
  ];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < K * 2; k++) out.push(catmull(p0, p1, p2, p3, k / (K * 2)));
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** ball position on the mountain for a progress value (0 peak, 1 flag, <0 left slope) */
export function pointAt(d: Debt, progress: number): { x: number; y: number } {
  if (progress < 0) {
    const t = Math.min(1, -progress / 0.35);
    const pts = leftCurve();
    const f = t * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const k = f - i;
    return {
      x: Phaser.Math.Linear(pts[i].x, pts[i + 1].x, k),
      y: Phaser.Math.Linear(pts[i].y, pts[i + 1].y, k),
    };
  }
  const pts = smoothCurve(d);
  const f = Math.max(0, Math.min(1, progress)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
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
function snowMound(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number): void {
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillEllipse(x, y, w, w * 0.4);
  g.fillStyle(0xDCEAF2, 0.5);
  g.fillEllipse(x, y + w * 0.06, w * 0.7, w * 0.22);
}

function drawPine(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
  snowMound(g, x, y + 2, 16 * s);
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
  snowMound(g, x, y, 16 * scale);
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

/* ---------- main mountain ---------- */
export function drawMountain(scene: Phaser.Scene, d: Debt): MountainRef {
  ensureGameTextures(scene);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  c.add(g);

  const right = smoothCurve(d);
  const left = leftCurve();
  const paid = pctPaid(d);
  const thawed = paid >= 1;

  /* ----- dark ground plane the hill sits on (contrast for the base) ----- */
  g.fillStyle(0x16283D, 1);
  g.fillRect(-40, 500, 1360, 150);
  g.fillStyle(0x1E3046, 1);
  g.fillRect(-40, 512, 1360, 138);
  g.fillStyle(0xFFFFFF, 0.08);
  g.fillRect(-40, 508, 1360, 4);
  g.fillStyle(0xFFFFFF, 0.05);
  g.fillEllipse(220, 620, 500, 60);
  g.fillEllipse(900, 630, 600, 70);

  /* ----- hill silhouette: right slope up to peak, left slope down to pit,
         with a softly curved base between pit and flag ----- */
  const body: { x: number; y: number }[] = [...right];
  const basePts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const bx = Phaser.Math.Linear(FLAG.x + 30, PIT.x - 20, t);
    const by = Phaser.Math.Linear(FLAG.y + 34, PIT.y + 40, t) + Math.sin(t * Math.PI) * 26;
    basePts.push({ x: bx, y: by });
  }
  for (const p of basePts) body.push(p);
  for (let i = left.length - 1; i >= 0; i--) body.push({ x: left[i].x - 24, y: left[i].y + 10 });

  // soft drop shadow under the whole hill (kept INSIDE the silhouette)
  const shadowPts = body.map((p) => ({ x: p.x, y: p.y + 9 }));
  g.fillStyle(0x0B1524, 0.2);
  g.fillPoints(shadowPts, true);

  // hill base — snow white
  g.fillStyle(thawed ? 0xC9F0DD : 0xEDF5FB, 1);
  g.fillPoints(body, true);

  /* ----- left slope — snow in shade (pale icy blue, no harsh ridge) ----- */
  const leftBody: { x: number; y: number }[] = [...left];
  leftBody.push({ x: PIT.x - 44, y: PIT.y + 44 });
  leftBody.push({ x: PEAK.x - 60, y: PEAK.y + 150 });
  g.fillStyle(thawed ? 0xA8D9C2 : 0xD8E8F2, 0.82);
  g.fillPoints(leftBody, true);
  g.fillStyle(thawed ? 0xA8D9C2 : 0xC4DAE8, 0.55);
  g.fillPoints(leftBody.map((p) => ({ x: p.x, y: p.y + 4 })), true);
  // soft drifts on the shady side to break up the flatness
  g.fillStyle(thawed ? 0xBFE5D0 : 0xEDF5FB, 0.85);
  g.fillEllipse(PEAK.x - 110, PEAK.y + 120, 100, 18);
  g.fillEllipse(PEAK.x - 190, PEAK.y + 230, 120, 20);
  g.fillEllipse(PEAK.x - 60, PEAK.y + 60, 70, 14);
  // deeper shade right at the pit mouth
  g.fillStyle(thawed ? 0x7FAF9B : 0x9FB4CE, 1);
  g.fillEllipse(PIT.x, PIT.y + 30, 110, 40);

  const pitLbl = scene.add.text(PIT.x, PIT.y - 26, 'THE SPIRAL', {
    fontFamily: '"Baloo 2"', fontSize: '13px', color: '#8FA4C4',
    stroke: '#16283D', strokeThickness: 4,
  }).setOrigin(0.5);
  c.add(pitLbl);

  /* ----- sunlit right slope — bright white ribbon along the curve ----- */
  const ribbon: { x: number; y: number }[] = [...right];
  for (let i = right.length - 1; i >= 0; i--) ribbon.push({ x: right[i].x, y: right[i].y + 11 });
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillPoints(ribbon, true);
  // soft top edge
  g.lineStyle(2.5, thawed ? 0x7FCFA8 : 0xDCEAF2, 0.85);
  g.beginPath();
  g.moveTo(right[0].x, right[0].y);
  for (let i = 1; i < right.length; i++) g.lineTo(right[i].x, right[i].y);
  g.strokePath();

  /* ----- rounded dome summit (blends the two slopes together) ----- */
  g.fillStyle(thawed ? 0xDFF7EA : 0xFFFFFF, 1);
  g.fillEllipse(PEAK.x, PEAK.y + 14, 140, 52);
  g.fillStyle(thawed ? 0xBFE5D0 : 0xEDF5FB, 1);
  g.fillEllipse(PEAK.x, PEAK.y + 20, 100, 34);
  g.fillStyle(0xFFE29A, 0.9);
  g.fillCircle(PEAK.x - 20, PEAK.y + 8, 2);
  g.fillCircle(PEAK.x + 24, PEAK.y + 16, 1.6);

  /* ----- flattening: soft snow-benches where the terrain was flattened ----- */
  const pts = terrainPoints(d);
  for (let i = 0; i < SEGMENTS; i++) {
    const flatness = 1 - d.terrain[i];
    if (flatness > 0.35) {
      const a = pts[i];
      const b = pts[i + 1];
      g.lineStyle(2.5, thawed ? 0x8FD9B4 : 0xBFE3F2, Math.min(0.95, 0.4 + flatness * 0.5));
      g.beginPath();
      g.moveTo(a.x, a.y + 1);
      g.lineTo(b.x, b.y + 1);
      g.strokePath();
      g.fillStyle(0xFFFFFF, 0.85);
      g.fillCircle((a.x + b.x) / 2, (a.y + b.y) / 2 + 3, 2.2);
    }
  }

  /* ----- snowy pines on the lower right slope ----- */
  for (let i = 0; i < 5; i++) {
    const t = 0.5 + i * 0.1;
    const pos = pointAt(d, t);
    const s = 0.7 + ((i * 37) % 10) / 12;
    drawPine(g, pos.x + (i % 2 ? 20 : -22), pos.y - 2, s);
  }

  /* ----- milestone flags at 25/50/75 along the slope ----- */
  [0.25, 0.5, 0.75].forEach((t) => {
    const pos = pointAt(d, t);
    const crossed = paid >= t;
    drawFlagPole(scene, c, pos.x, pos.y - 8, crossed ? 0x5FC9A8 : 0xF2B84B, `${Math.round(t * 100)}%`, 0.8);
  });

  /* ----- payoff flag ----- */
  drawFlagPole(scene, c, FLAG.x, FLAG.y - 10, thawed ? 0x5FC9A8 : 0xFF6B4A, 'PAYOFF', 1.1);
  g.fillStyle(0xFFFFFF, 0.85);
  g.fillEllipse(FLAG.x, FLAG.y + 8, 110, 16);

  /* ----- spiral pit swirl (animated by the scene) ----- */
  const swirl = scene.add.graphics();
  c.add(swirl);
  drawSwirl(swirl, PIT.x, PIT.y + 16, 0);

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
  g.fillStyle(0x0E1B2E, 0.9);
  g.fillCircle(x, y, 7);
  g.fillStyle(0x8FA4C4, 0.8);
  g.fillCircle(x, y, 3);
}

/* ============================================================
   Overview skyline: rounded white hills, one per debt, with the
   ball marker at its current position.
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
  const h = Math.max(64, 150 - Math.min(130, d.balance / 220));

  // rounded hill: two quadratic segments with controls bulging above the peak
  const hillPts: { x: number; y: number }[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const half = t < 0.5;
    const u = half ? t * 2 : (t - 0.5) * 2;
    if (half) {
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, cc = u * u;
      hillPts.push({ x: a * (-w / 2) + b * (-w / 4) + cc * 0, y: a * 0 + b * (-h * 1.3) + cc * (-h) });
    } else {
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, cc = u * u;
      hillPts.push({ x: a * 0 + b * (w / 4) + cc * (w / 2), y: a * (-h) + b * (-h * 1.3) + cc * 0 });
    }
  }

  // hill body — bright snow
  g.fillStyle(thawed ? 0xC9F0DD : 0xF7FBFF, 1);
  g.beginPath();
  g.moveTo(-w / 2, 0);
  for (const p of hillPts) g.lineTo(p.x, p.y);
  g.lineTo(w / 2, 0);
  g.closePath();
  g.fillPath();
  // shady right side (light icy blue)
  g.fillStyle(thawed ? 0xA8DFC2 : 0xE2EDF6, 0.9);
  g.beginPath();
  g.moveTo(0, -h);
  for (let i = 14; i <= N; i++) g.lineTo(hillPts[i].x, hillPts[i].y);
  g.lineTo(w / 2, 0);
  g.closePath();
  g.fillPath();

  // bright snow cap — a narrow dome, not a flat plateau
  g.fillStyle(0xFFFFFF, 1);
  g.fillEllipse(0, -h + 2, w * 0.3, 14);
  g.fillStyle(0xF4FAFD, 1);
  g.fillEllipse(0, -h + 4, w * 0.18, 9);
  // tiny peak tip
  g.fillStyle(0xFFFFFF, 1);
  g.fillTriangle(0, -h - 4, -4, -h + 2, 4, -h + 2);

  // ball marker on the right slope
  const p = Math.max(0, Math.min(1, d.progress));
  const u = Math.min(1, p * 2);
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, cc = u * u;
  const bx = a * 0 + b * (w / 4) + cc * (w / 2);
  const by = a * (-h) + b * (-h * 1.3) + cc * 0;
  g.fillStyle(0xFFFFFF, 1);
  g.fillCircle(bx, by, 4.5);
  g.lineStyle(1.5, 0x3E92CC, 1);
  g.beginPath();
  g.arc(bx, by, 4.5, 0, Math.PI * 2);
  g.strokePath();

  // cleared sparkle
  if (thawed) {
    g.fillStyle(0xFFE29A, 1);
    g.fillCircle(-w * 0.32, -h * 0.55, 3);
    g.fillCircle(w * 0.28, -h * 0.4, 2);
    g.fillCircle(0, -h - 14, 3);
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
