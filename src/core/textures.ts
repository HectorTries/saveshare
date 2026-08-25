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
  if (t.exists('iceblock')) return;
  {
    const cv = t.createCanvas('iceblock', 44, 32)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#F4FBFE');
    g.addColorStop(0.35, '#C9E7F3');
    g.addColorStop(1, '#8FC4DA');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, 44, 32, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    roundRect(ctx, 2, 2, 40, 6, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(70,120,150,0.35)';
    roundRect(ctx, 2, 26, 40, 4, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,215,235,0.9)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0.75, 0.75, 42.5, 30.5, 6);
    ctx.stroke();
    // sparkle
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(30, 12, 2, 2);
    cv.refresh();
  }

  /* ice chunk — square-ish shard for debris */
  {
    const cv = t.createCanvas('chunk', 28, 28)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 28);
    g.addColorStop(0, '#E8F6FC');
    g.addColorStop(1, '#9CCFE2');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, 28, 28, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,220,0.9)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0.75, 0.75, 26.5, 26.5, 4);
    ctx.stroke();
    cv.refresh();
  }

  /* frost shard — elongated sliver for shell debris */
  {
    const cv = t.createCanvas('frost', 12, 22)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 22);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(1, '#BFE3F2');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(12, 22);
    ctx.lineTo(6, 18);
    ctx.lineTo(0, 22);
    ctx.closePath();
    ctx.fill();
    cv.refresh();
  }

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

  /* boost orb — glowing pickup */
  {
    const cv = t.createCanvas('orb', 40, 40)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(20, 20, 2, 20, 20, 20);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,226,154,0.95)');
    g.addColorStop(1, 'rgba(242,184,75,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(20, 20, 20, 0, Math.PI * 2);
    ctx.fill();
    cv.refresh();
  }

  /* ring — expanding shockwave on impact */
  {
    const cv = t.createCanvas('ring', 128, 128)!;
    const ctx = cv.getContext() as CanvasRenderingContext2D;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,240,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.stroke();
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
