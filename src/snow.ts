/* ---------- ambient falling snow (page background) ---------- */
let snowCtx: CanvasRenderingContext2D | null = null;
let sw = 0, sh = 0;
let flakes: { x: number; y: number; r: number; spd: number; drift: number; o: number }[] = [];

export function startSnow(): void {
  const cv = document.getElementById('snowCanvas') as HTMLCanvasElement;
  if (!cv) return;
  snowCtx = cv.getContext('2d');
  resize();
  addEventListener('resize', resize);
  const tick = () => {
    if (!snowCtx) return;
    snowCtx.clearRect(0, 0, sw, sh);
    snowCtx.fillStyle = 'rgba(255,255,255,.9)';
    for (const f of flakes) {
      f.y += f.spd;
      f.x += f.drift;
      if (f.y > sh) { f.y = -4; f.x = Math.random() * sw; }
      snowCtx.globalAlpha = f.o;
      snowCtx.beginPath();
      snowCtx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      snowCtx.fill();
    }
    snowCtx.globalAlpha = 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function resize(): void {
  sw = innerWidth; sh = innerHeight;
  const cv = document.getElementById('snowCanvas') as HTMLCanvasElement;
  if (!cv) return;
  cv.width = sw; cv.height = sh;
  flakes = Array.from({ length: 70 }, () => ({
    x: Math.random() * sw,
    y: Math.random() * -sh,
    r: Math.random() * 2 + 1,
    spd: Math.random() * 0.7 + 0.3,
    drift: Math.random() * 0.5 - 0.25,
    o: Math.random() * 0.5 + 0.3,
  }));
}
