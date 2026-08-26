/* ---------- generated canvas textures (no asset files) ---------- */
import Phaser from 'phaser';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

export function ensureGameTextures(scene: Phaser.Scene): void {
  const t = scene.textures;
  if (t.exists('snowball')) return;

  /* snowball — radial white with blue rim + craters (128px for crisp scaling) */
  {
    const cv = t.createCanvas('snowball', 128, 128)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(52, 44, 8, 64, 64, 64);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.65, '#F6FBFE');
    g.addColorStop(1, '#BFDFEE');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,205,225,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    // craters
    ctx.fillStyle = 'rgba(170,210,228,0.55)';
    [[44, 52], [88, 80], [60, 96], [28, 84]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(40, 40, 5, 0, Math.PI * 2);
    ctx.fill();
    cv.refresh();
  }

  /* coin — gold disc with shine (knock-off juice) */
  {
    const cv = t.createCanvas('coin', 32, 32)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(11, 10, 2, 16, 16, 16);
    g.addColorStop(0, '#FFF0BC');
    g.addColorStop(0.5, '#F6C45C');
    g.addColorStop(1, '#D6972F');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#B8791C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(184,121,28,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(16, 16, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.ellipse(10, 9, 3.5, 2, -0.6, 0, Math.PI * 2);
    ctx.fill();
    cv.refresh();
  }

  /* pix — 1px white (particles) */
  {
    const cv = t.createCanvas('pix', 8, 8)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 8, 8);
    cv.refresh();
  }
}
