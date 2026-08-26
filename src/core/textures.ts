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

  /* snowball — radial white with blue rim + craters */
  {
    const cv = t.createCanvas('snowball', 64, 64)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(26, 22, 4, 32, 32, 32);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.7, '#F4FAFD');
    g.addColorStop(1, '#C4E2EF');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,205,225,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(32, 32, 29, 0, Math.PI * 2);
    ctx.stroke();
    // craters
    ctx.fillStyle = 'rgba(170,210,228,0.8)';
    [[22, 26], [44, 40], [30, 48], [14, 42]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(20, 20, 3, 0, Math.PI * 2);
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
