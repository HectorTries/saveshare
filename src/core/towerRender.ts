/* ---------- shared tower rendering: shell (interest) + core (principal) ----------
   Every tower renders at the same base height. Blocks = % of ORIGINAL balance.
   Core height = remaining principal (melt line drops as you pay).
   Shell height = projected future interest remaining (shrinks quadratically —
   the "overpaying crushes interest" visual hook). Shell colour/texture = APR. */
import Phaser from 'phaser';
import { ensureGameTextures } from './textures';
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

/** deterministic per-debt pseudo-random (crack lines, icicles, sparkles) */
function seeded(idx: number): () => number {
  let s = ((idx + 1) * 48271) % 2147483647;
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
  ensureGameTextures(scene);
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

  /* ----- soft drop shadow ----- */
  g.fillStyle(0x0B1524, 0.38);
  g.fillEllipse(0, 6, shellW + 74, 24);

  /* ----- shell (drawn first, behind core) ----- */
  if (shellH > 2) {
    g.fillStyle(shellCol, 0.95);
    g.fillRoundedRect(-shellW / 2, -shellH, shellW, shellH, 12);
    // cylinder shading (sides)
    g.fillStyle(0x000000, 0.12);
    g.fillRoundedRect(-shellW / 2, -shellH, SHELL_PAD, shellH, 10);
    g.fillRoundedRect(shellW / 2 - SHELL_PAD, -shellH, SHELL_PAD, shellH, 10);
    // top rim highlight
    g.fillStyle(0xFFFFFF, 0.28);
    g.fillRoundedRect(-shellW / 2 + 3, -shellH, shellW - 6, 9, 5);
    // crack texture — denser on high APR (harder shell), with a glow pass
    if (aprT > 0.3) {
      const cracks = Math.round(2 + aprT * 5);
      for (let i = 0; i < cracks; i++) {
        const cx = -shellW / 2 + rnd() * shellW;
        const top = -shellH + rnd() * shellH * 0.5;
        g.lineStyle(3.5, 0xFFFFFF, 0.16);
        g.beginPath();
        g.moveTo(cx, top);
        let px = cx;
        for (let k = 0; k < 4; k++) {
          px += (rnd() - 0.5) * 14;
          g.lineTo(px, top + ((k + 1) / 4) * shellH * 0.55);
        }
        g.strokePath();
        g.lineStyle(1.6, shellEdge, 0.7);
        g.beginPath();
        g.moveTo(cx, top);
        px = cx;
        for (let k = 0; k < 4; k++) {
          px += (rnd() - 0.5) * 14;
          g.lineTo(px, top + ((k + 1) / 4) * shellH * 0.55);
        }
        g.strokePath();
      }
    }
    // icicles hanging from the top edge of a thick shell
    if (shellH > 60) {
      const n = 5 + Math.round(aprT * 4);
      g.fillStyle(0xFFFFFF, 0.55);
      for (let i = 0; i < n; i++) {
        const ix = -shellW / 2 + 10 + rnd() * (shellW - 20);
        const len = 8 + rnd() * 16;
        g.fillTriangle(ix - 3, -shellH, ix + 3, -shellH, ix, -shellH - len);
      }
    }
    g.lineStyle(2, shellEdge, 0.9);
    g.strokeRoundedRect(-shellW / 2, -shellH, shellW, shellH, 12);
  }

  /* ----- core blocks (textured images, only principal pays these off) ----- */
  const blockW = CORE_W - 6;
  const fullBlocks = Math.floor(coreH / blockH);
  const fracH = coreH - fullBlocks * blockH;
  const visible = Math.max(0, Math.min(BLOCKS - blocksGone, fullBlocks));
  for (let i = 0; i < visible; i++) {
    const img = scene.add.image(0, -(i + 0.5) * blockH + 1, 'iceblock');
    img.setDisplaySize(blockW, blockH + 1.5);
    // subtle depth variation between rows
    img.setTint(lerpColor(0xFFFFFF, 0xC9E7F3, (i % 3) / 5));
    c.add(img);
  }
  // partial melt block on top (continuous stack — no level seams)
  if (fracH > 2 && visible < BLOCKS) {
    const img = scene.add.image(0, -coreH + fracH / 2, 'iceblock');
    img.setDisplaySize(blockW, fracH);
    const px = Math.max(3, Math.round((fracH / blockH) * 32));
    img.setCrop(0, 32 - px, 44, px);
    c.add(img);
  }

  /* ----- melt line (bright edge at the current paid level) ----- */
  if (coreH > 0) {
    g.fillStyle(0x5FC9A8, 0.22);
    g.fillRoundedRect(-CORE_W / 2 - 7, -coreH - 7, CORE_W + 14, 16, 7);
    g.fillStyle(0x5FC9A8, 0.95);
    g.fillRoundedRect(-CORE_W / 2, -coreH - 2.5, CORE_W, 5, 2.5);
    // drips under the melt line
    g.fillStyle(0x9CD8E8, 0.85);
    const dripN = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < dripN; i++) {
      const dx = -CORE_W / 2 + 12 + rnd() * (CORE_W - 24);
      const dl = 5 + rnd() * 8;
      g.fillRoundedRect(dx, -coreH + 3, 3.5, dl, 1.8);
    }
  }
  g.lineStyle(2, 0x7FB8D0, 0.9);
  g.strokeRoundedRect(-CORE_W / 2, -coreH, CORE_W, coreH, 6);

  /* ----- milestone markers (25/50/75% paid lines + diamonds) ----- */
  [0.25, 0.5, 0.75].forEach((t) => {
    const y = -BASE_H * t;
    g.lineStyle(2, 0xF2B84B, 0.75);
    g.beginPath();
    g.moveTo(-shellW / 2 - 8, y);
    g.lineTo(shellW / 2 + 8, y);
    g.strokePath();
    // small diamond
    g.fillStyle(0xF2B84B, 1);
    g.fillTriangle(0, y - 5, 5, y, 0, y + 5);
    g.fillTriangle(0, y - 5, -5, y, 0, y + 5);
  });

  /* ----- snow base with sparkles ----- */
  g.fillStyle(0xFFFFFF, 0.95);
  g.fillEllipse(0, 2, shellW + 46, 16);
  g.fillStyle(0xDCEAF2, 0.65);
  g.fillEllipse(0, 4, shellW + 46, 8);
  g.fillStyle(0xFFFFFF, 0.95);
  for (let i = 0; i < 5; i++) {
    const sx = -shellW / 2 - 12 + rnd() * (shellW + 24);
    g.fillCircle(sx, 0 + rnd() * 4, 1.4 + rnd() * 1.4);
  }

  /* ----- ring: selected / strategy-suggested ----- */
  if (opts.ring && opts.ring !== 'none') {
    const col = opts.ring === 'suggest' ? 0xF2B84B : 0xFFFFFF;
    const w = opts.ring === 'suggest' ? 3.5 : 2;
    g.lineStyle(w + 4, col, opts.ring === 'suggest' ? 0.25 : 0.12);
    g.strokeRoundedRect(-shellW / 2 - 14, -BASE_H - 12, shellW + 28, BASE_H + 30, 16);
    g.lineStyle(w, col, opts.ring === 'suggest' ? 0.95 : 0.75);
    g.strokeRoundedRect(-shellW / 2 - 14, -BASE_H - 12, shellW + 28, BASE_H + 30, 16);
    if (opts.ring === 'suggest') {
      g.fillStyle(0xF2B84B, 1);
      g.fillCircle(0, -BASE_H - 26, 7);
      g.fillStyle(0x16283D, 1);
      g.fillCircle(0, -BASE_H - 26, 3.5);
    }
  }

  /* ----- labels ----- */
  if (opts.showLabels !== false) {
    const t = scene.add.text(0, 20, '', {
      fontFamily: '"Baloo 2"', fontSize: '16px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(0.5, 0);
    const paidPct = Math.round(paid * 100);
    const label = paid >= 1
      ? 'PAID OFF 🎉'
      : `${d.name} · ${money(principalLeft(d))} left · ${paidPct}%`;
    t.setText(label);
    c.add(t);

    const sub = scene.add.text(0, 40, '', {
      fontFamily: '"JetBrains Mono"', fontSize: '11px', color: '#B7C7D6',
      stroke: '#0F1A2E', strokeThickness: 3,
    }).setOrigin(0.5, 0);
    sub.setText(paid >= 1
      ? 'cleared — no more interest'
      : `APR ${d.apr}% · ${monthsLeft(d)}mo left · ${blocksGone}/${BLOCKS} blocks`);
    c.add(sub);
  }

  c.setScale(s);
  return c;
}
