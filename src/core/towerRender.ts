/* ---------- shared tower rendering: shell (interest) + core (principal) ----------
   Every tower renders at the same base height. Blocks = % of ORIGINAL balance.
   Core height = remaining principal (melt line drops as you pay).
   Shell height = projected future interest remaining (shrinks quadratically —
   the "overpaying crushes interest" visual hook). Shell colour/texture = APR. */
import Phaser from 'phaser';
import {
  type Debt, pctPaid, principalLeft, shellPct, monthsLeft,
  BLOCKS, blocksRemoved, money,
} from './state';

export interface TowerOpts {
  scale?: number;
  showLabels?: boolean;
  ring?: 'none' | 'selected' | 'suggest';
}

const BASE_H = 330;
const CORE_W = 116;
const SHELL_PAD = 17; // shell wider than core each side

function lerpColor(c1: number, c2: number, t: number): number {
  const a = Phaser.Display.Color.ValueToColor(c1);
  const b = Phaser.Display.Color.ValueToColor(c2);
  const r = Math.round(a.red + (b.red - a.red) * t);
  const g = Math.round(a.green + (b.green - a.green) * t);
  const bl = Math.round(a.blue + (b.blue - a.blue) * t);
  return Phaser.Display.Color.GetColor(r, g, bl);
}

/** deterministic per-debt pseudo-random (crack lines etc.) */
function seeded(idx: number): () => number {
  let s = (idx + 1) * 48271 % 2147483647;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export function drawTower(
  scene: Phaser.Scene,
  x: number,
  baseY: number,
  d: Debt,
  idx: number,
  opts: TowerOpts = {},
): Phaser.GameObjects.Container {
  const s = opts.scale ?? 1;
  const c = scene.add.container(x, baseY);
  const g = scene.add.graphics();
  c.add(g);

  const paid = pctPaid(d);
  const coreH = BASE_H * (1 - paid);
  const shellH = BASE_H * shellPct(d);
  const shellW = CORE_W + SHELL_PAD * 2;
  const blockH = BASE_H / BLOCKS;
  const blocksGone = blocksRemoved(d);
  const rnd = seeded(idx);

  // APR → shell hardness colour (low = pale frost, high = dark rock)
  const aprT = Math.max(0, Math.min(1, d.apr / 30));
  const shellCol = lerpColor(0xCFE8F5, 0x4E5D78, aprT);
  const shellEdge = lerpColor(0xE8F6FC, 0x39465C, aprT);
  const coreCol = 0xA8D5E5;
  const coreEdge = 0x7FB8D0;

  /* ----- shell (drawn first, behind core) ----- */
  if (shellH > 2) {
    g.fillStyle(shellCol, 0.92);
    g.fillRoundedRect(-shellW / 2, -shellH, shellW, shellH, 10);
    // crack texture — denser on high APR (harder shell)
    if (aprT > 0.3) {
      const cracks = Math.round(2 + aprT * 5);
      g.lineStyle(1.5, shellEdge, 0.55);
      for (let i = 0; i < cracks; i++) {
        const cx = -shellW / 2 + rnd() * shellW;
        const top = -shellH + rnd() * shellH * 0.5;
        g.beginPath();
        g.moveTo(cx, top);
        let px = cx;
        for (let k = 0; k < 4; k++) {
          px += (rnd() - 0.5) * 14;
          g.lineTo(px, top + ((k + 1) / 4) * shellH * 0.55);
        }
        g.strokePath();
      }
    }
    g.lineStyle(2, shellEdge, 0.9);
    g.strokeRoundedRect(-shellW / 2, -shellH, shellW, shellH, 10);
  }

  /* ----- core blocks (only principal pays these off) ----- */
  const fullBlocks = Math.floor(coreH / blockH);
  const fracH = coreH - fullBlocks * blockH;
  const visible = Math.max(0, Math.min(BLOCKS - blocksGone, fullBlocks));
  for (let i = 0; i < visible; i++) {
    const y = -(i + 1) * blockH + 1;
    g.fillStyle(lerpColor(0xDFF3FB, 0x9CCFE2, (i % 3) / 3), 1);
    g.fillRoundedRect(-CORE_W / 2 + 3, y, CORE_W - 6, blockH - 2, 4);
  }
  // partial melt block on top (continuous stack — no level seams)
  if (fracH > 2 && visible < BLOCKS) {
    const y = -coreH;
    g.fillStyle(0xDFF3FB, 1);
    g.fillRoundedRect(-CORE_W / 2 + 3, y, CORE_W - 6, fracH, 4);
  }
  // melt line (bright edge at the current paid level)
  if (coreH > 0) {
    g.fillStyle(0x5FC9A8, 0.95);
    g.fillRoundedRect(-CORE_W / 2, -coreH - 2, CORE_W, 4, 2);
    g.fillStyle(0x5FC9A8, 0.25);
    g.fillRoundedRect(-CORE_W / 2 - 4, -coreH - 5, CORE_W + 8, 10, 4);
  }
  g.lineStyle(2, coreEdge, 0.9);
  g.strokeRoundedRect(-CORE_W / 2, -coreH, CORE_W, coreH, 6);

  /* ----- milestone ticks (25/50/75% paid lines) ----- */
  g.lineStyle(2, 0xF2B84B, 0.8);
  [0.25, 0.5, 0.75].forEach((t) => {
    const y = -BASE_H * t;
    g.beginPath();
    g.moveTo(-shellW / 2 - 6, y);
    g.lineTo(shellW / 2 + 6, y);
    g.strokePath();
  });

  /* ----- snow base ----- */
  g.fillStyle(0xFFFFFF, 0.9);
  g.fillEllipse(0, 2, shellW + 46, 16);
  g.fillStyle(0xDCEAF2, 0.6);
  g.fillEllipse(0, 4, shellW + 46, 8);

  /* ----- ring: selected / strategy-suggested ----- */
  if (opts.ring && opts.ring !== 'none') {
    const col = opts.ring === 'suggest' ? 0xF2B84B : 0xFFFFFF;
    const w = opts.ring === 'suggest' ? 3.5 : 2;
    g.lineStyle(w, col, opts.ring === 'suggest' ? 0.95 : 0.75);
    g.strokeRoundedRect(-shellW / 2 - 12, -BASE_H - 10, shellW + 24, BASE_H + 26, 14);
    if (opts.ring === 'suggest') {
      g.fillStyle(0xF2B84B, 1);
      g.fillCircle(0, -BASE_H - 22, 7);
      g.fillStyle(0x16283D, 1);
      g.fillCircle(0, -BASE_H - 22, 3.5);
    }
  }

  /* ----- labels ----- */
  if (opts.showLabels !== false) {
    const t = scene.add.text(0, 18, '', {
      fontFamily: '"Baloo 2"', fontSize: '16px', color: '#F4F8FB',
    }).setOrigin(0.5, 0);
    const paidPct = Math.round(paid * 100);
    const label = paid >= 1
      ? 'PAID OFF 🎉'
      : `${d.name} · ${money(principalLeft(d))} left · ${paidPct}%`;
    t.setText(label);
    c.add(t);

    const sub = scene.add.text(0, 38, '', {
      fontFamily: '"JetBrains Mono"', fontSize: '11px', color: '#9FB2C4',
    }).setOrigin(0.5, 0);
    sub.setText(paid >= 1
      ? 'cleared — no more interest'
      : `APR ${d.apr}% · ${monthsLeft(d)}mo left · ${blocksGone}/${BLOCKS} blocks`);
    c.add(sub);
  }

  c.setScale(s);
  return c;
}
