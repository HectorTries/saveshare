/* ---------- audio (synth, no assets) ---------- */
let AC: AudioContext | null = null;
let muted = false;

export function initAudio(): void {
  if (AC) return;
  try { AC = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch (e) { /* noop */ }
}

export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void { muted = m; }

function beep(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
  if (!AC || muted) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}

function noiseBurst(dur: number, vol: number, freq: number): void {
  if (!AC || muted) return;
  const t = AC.currentTime;
  const n = Math.floor(AC.sampleRate * dur);
  const buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(AC.destination); src.start(t);
}

export const sfx = {
  launch(): void { noiseBurst(0.18, 0.18, 900); beep(300, 0.15, 'sawtooth', 0.06, 140); },
  thud(): void { noiseBurst(0.08, 0.22, 300); beep(90, 0.1, 'sine', 0.2, 50); },
  crack(): void { noiseBurst(0.05, 0.3, 2400); },
  chip(): void { beep(520 + Math.random() * 300, 0.07, 'triangle', 0.14); },
  coin(): void { beep(880, 0.09, 'square', 0.1); setTimeout(() => beep(1320, 0.12, 'square', 0.1), 70); },
  boom(): void { beep(120, 0.5, 'sine', 0.35, 38); noiseBurst(0.4, 0.4, 220); },
  paid(): void { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.18), i * 90)); },
  win(): void { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.16), i * 110)); },
  tnt(): void { beep(200, 0.3, 'sawtooth', 0.12, 60); noiseBurst(0.25, 0.3, 300); },
  select(): void { beep(660, 0.08, 'triangle', 0.12); },
  crit(): void { beep(1200, 0.12, 'square', 0.12); setTimeout(() => beep(1800, 0.15, 'square', 0.1), 80); },
  milestone(): void { this.boom(); [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'triangle', 0.2), i * 90)); },
  roll(): void { noiseBurst(0.5, 0.05, 700); },
  whoosh(): void { noiseBurst(0.3, 0.12, 500); },
};
