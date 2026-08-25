/* ============================================================
   Roll — short wind-up, impact-first. ~1.9s of downhill build-up
   (compresses as your combo grows), then a slow-mo hit cam:
   tower rocks, ball squashes, debris spawns at the impact point
   and scales with blocks actually removed, shockwave rings out.
   Lane-steer into the telegraphed crack for a crit. No RNG.
   ============================================================ */
import Phaser from 'phaser';
import {
  store, applyHit, registerHit, combo, comboMult, pctPaid, principalLeft,
  interestDestroyed, type HitOutcome,
} from '../core/state';
import { drawTower } from '../core/towerRender';
import { ensureGameTextures } from '../core/textures';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const VP = { x: 640, y: 236 };          // vanishing point (horizon)
const LANE_SPACING = 110;
const DURATION_BASE = 1900;             // ms — combo compresses below
const DURATION_MIN = 1000;
const TELEGRAPH_T = 0.5;
const LATE_T = 0.65;
const JUMPS = [{ t0: 0.30, t1: 0.46, h: 56 }];
const BOOSTS = [
  { t: 0.25, lane: -1 },
  { t: 0.42, lane: 1 },
];

export interface RollStats {
  debtIdx: number;
  debtName: string;
  amount: number;
  blocks: number;
  interest: number;
  interestTotal: number;
  crit: 'none' | 'early' | 'late';
  critMult: number;
  comboCount: number;
  comboMult: number;
  milestone: number | null;
  paidOff: boolean;
  left: number;
  pct: number;
}

export class RollScene extends Phaser.Scene {
  private towerIdx = 0;
  private chip = 50;

  private lane = 0;
  private steer = 0;
  private critLane = 0;
  private enterT = -1;
  private t = 0;
  private done = false;
  private hitApplied = false;
  private boosted = 0;
  private duration = DURATION_BASE;

  private ball!: Phaser.GameObjects.Container;
  private ballImg!: Phaser.GameObjects.Image;
  private eyes!: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private towerC!: Phaser.GameObjects.Container;
  private crack!: Phaser.GameObjects.Container;
  private laneLights: Phaser.GameObjects.Graphics[] = [];
  private steerHint!: Phaser.GameObjects.Text;
  private streaks!: Phaser.GameObjects.Graphics;
  private groundFlow!: Phaser.GameObjects.Graphics;
  private ramps!: Phaser.GameObjects.Graphics;
  private boostOrbs!: Phaser.GameObjects.Container;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() { super('Roll'); }

  init(data: { towerIdx: number; chip: number }): void {
    this.towerIdx = data.towerIdx;
    this.chip = data.chip;
    this.lane = 0;
    this.steer = 0;
    this.t = 0;
    this.done = false;
    this.hitApplied = false;
    this.enterT = -1;
    this.boosted = 0;
    // combo compresses the wind-up, but only for a streak on THIS tower
    this.duration = (combo.towerIdx === this.towerIdx)
      ? Math.max(DURATION_MIN, DURATION_BASE - Math.min(combo.count, 6) * 150)
      : DURATION_BASE;
    this.critLane = Phaser.Math.Between(-1, 1);
  }

  create(): void {
    const d = store.debts[this.towerIdx];
    if (!d || pctPaid(d) >= 1) { this.scene.start('Overview'); return; }
    this.input.enabled = true;
    ensureGameTextures(this);

    this.drawSlope();
    this.drawRamps();
    this.drawBall();
    this.drawTowerAhead();
    this.drawLaneLights();
    this.makeTrail();
    this.steerHint = this.add.text(W / 2, H - 96, '◀  steer into the crack  ▶', {
      fontFamily: '"Baloo 2"', fontSize: '18px', color: '#F4F8FB',
    }).setOrigin(0.5).setAlpha(0);
    this.streaks = this.add.graphics();
    this.groundFlow = this.add.graphics();
    this.boostOrbs = this.add.container(0, 0);

    const go = this.add.text(W / 2, VP.y + 90, combo.count > 1 ? `STREAK ×${combo.count}!` : 'HERE WE GO!', {
      fontFamily: '"Baloo 2"', fontSize: '30px', color: combo.count > 1 ? '#F2B84B' : '#F4F8FB',
      stroke: '#16283D', strokeThickness: 8,
    }).setOrigin(0.5);
    this.tweens.add({ targets: go, alpha: 0, y: VP.y + 60, duration: 500, delay: 350 });
    this.tweens.add({ targets: go, y: VP.y + 120, duration: 400, yoyo: true, ease: 'Quad.easeOut' });

    // input
    const keys = this.input.keyboard!.addKeys('LEFT,RIGHT,A,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown-LEFT', () => { this.steer = -1; });
    this.input.keyboard!.on('keydown-A', () => { this.steer = -1; });
    this.input.keyboard!.on('keydown-RIGHT', () => { this.steer = 1; });
    this.input.keyboard!.on('keydown-D', () => { this.steer = 1; });
    this.input.keyboard!.on('keyup-LEFT', () => { if (this.steer === -1) this.steer = 0; });
    this.input.keyboard!.on('keyup-A', () => { if (this.steer === -1) this.steer = 0; });
    this.input.keyboard!.on('keyup-RIGHT', () => { if (this.steer === 1) this.steer = 0; });
    this.input.keyboard!.on('keyup-D', () => { if (this.steer === 1) this.steer = 0; });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.steer = p.x < W / 2 ? -1 : 1; });
    this.input.on('pointerup', () => { this.steer = 0; });

    bus.on('hit-again', this.onHitAgain, this);
    bus.on('to-overview', this.onToOverview, this);

    sfx.roll();
    this.tweens.addCounter({
      from: 0, to: 1, duration: this.duration, ease: 'Linear',
      onUpdate: (tw) => this.advance(tw.getValue() ?? 0),
      onComplete: () => this.impact(),
    });
  }

  shutdown(): void {
    bus.off('hit-again', this.onHitAgain, this);
    bus.off('to-overview', this.onToOverview, this);
  }

  /* ---------- scenery ---------- */
  private drawSlope(): void {
    const g = this.add.graphics();
    g.fillStyle(0xEAF4FA, 0.9);
    g.fillPoints([
      { x: 0, y: H }, { x: W, y: H }, { x: W, y: VP.y + 30 }, { x: 0, y: VP.y + 30 },
    ], true);
    g.lineStyle(6, 0xFFFFFF, 0.75);
    [-1, 0, 1].forEach((off) => {
      g.beginPath();
      g.moveTo(VP.x + off * 26, VP.y + 26);
      g.lineTo(VP.x + off * LANE_SPACING * 3.4, H);
      g.strokePath();
    });
    g.fillStyle(0xFFFFFF, 0.95);
    g.fillEllipse(60, H - 26, 320, 96);
    g.fillEllipse(W - 60, H - 26, 320, 96);
  }

  private drawRamps(): void {
    const g = this.add.graphics();
    g.fillStyle(0xF2F9FC, 1);
    JUMPS.forEach((j) => {
      const y = this.pathY(j.t0);
      const spread = this.spread(j.t0);
      g.fillTriangle(VP.x - spread * 3.1, y + 26, VP.x + spread * 3.1, y + 26, VP.x, y - 12);
      g.lineStyle(3, 0xC9DEE9, 0.9);
      g.beginPath();
      g.moveTo(VP.x - spread * 3.1, y + 26);
      g.lineTo(VP.x + spread * 3.1, y + 26);
      g.strokePath();
    });
    this.ramps = g;
  }

  private drawBall(): void {
    const r = 20 + Math.min(Math.max(combo.count - 1, 0), 6) * 3.5;
    this.ballImg = this.add.image(0, 0, 'snowball').setDisplaySize(r * 2.4, r * 2.4);
    this.eyes = this.add.container(0, 0);
    const eyeG = this.add.graphics();
    eyeG.fillStyle(0x16283D, 1);
    eyeG.fillCircle(-r * 0.32, -r * 0.06, r * 0.1);
    eyeG.fillCircle(r * 0.32, -r * 0.06, r * 0.1);
    eyeG.fillStyle(0xFFFFFF, 1);
    eyeG.fillCircle(-r * 0.36, -r * 0.1, r * 0.04);
    eyeG.fillCircle(r * 0.28, -r * 0.1, r * 0.04);
    this.eyes.add(eyeG);
    this.ball = this.add.container(W / 2, H - 90, [this.ballImg, this.eyes]);
    this.ball.setDepth(5);
    this.shadow = this.add.ellipse(W / 2, H - 74, 60, 16, 0x0B1524, 0.35);
    this.shadow.setDepth(4);
  }

  private drawTowerAhead(): void {
    const d = store.debts[this.towerIdx];
    this.towerC = drawTower(this, VP.x, VP.y + 24, d, this.towerIdx, {
      showLabels: false, scale: 0.13,
    });
    this.towerC.setDepth(2);
    const cg = this.add.graphics();
    const cx = this.critLane * 60;
    const cy = -150;
    cg.fillStyle(0xF2B84B, 0.35);
    cg.fillCircle(cx, cy, 26);
    cg.lineStyle(3, 0xF2B84B, 1);
    cg.beginPath();
    cg.moveTo(cx - 12, cy - 14);
    cg.lineTo(cx - 4, cy);
    cg.lineTo(cx - 11, cy + 8);
    cg.lineTo(cx - 2, cy + 18);
    cg.strokePath();
    cg.lineStyle(2, 0xFFE29A, 0.9);
    cg.beginPath();
    cg.moveTo(cx + 10, cy - 8);
    cg.lineTo(cx + 2, cy + 4);
    cg.lineTo(cx + 9, cy + 12);
    cg.strokePath();
    this.crack = this.add.container(VP.x, VP.y + 24, [cg]);
    this.crack.setDepth(3);
    this.crack.setVisible(false);
  }

  private drawLaneLights(): void {
    [-1, 0, 1].forEach((lane) => {
      const g = this.add.graphics();
      const x = W / 2 + lane * LANE_SPACING;
      g.fillStyle(0x16283D, 0.55);
      g.fillRoundedRect(x - 30, H - 58, 60, 22, 11);
      g.fillStyle(0xFFFFFF, 0.25);
      g.fillCircle(x, H - 47, 6);
      this.laneLights.push(g);
    });
  }

  private makeTrail(): void {
    this.trail = this.add.particles(0, 0, 'pix', {
      speed: { min: 40, max: 130 },
      angle: { min: 70, max: 110 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.75, end: 0 },
      lifespan: 480,
      frequency: 24,
      quantity: 2,
      tint: 0xFFFFFF,
    });
    this.trail.setDepth(4);
  }

  /* ---------- easing helpers ---------- */
  private ease(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private pathY(t: number): number {
    return Phaser.Math.Linear(VP.y + 34, H - 92, this.ease(t));
  }

  private spread(t: number): number {
    return Phaser.Math.Linear(16, LANE_SPACING, this.ease(t));
  }

  private jumpOffset(t: number): number {
    for (const j of JUMPS) {
      if (t >= j.t0 && t <= j.t1) {
        const k = (t - j.t0) / (j.t1 - j.t0);
        return -Math.sin(k * Math.PI) * j.h;
      }
    }
    return 0;
  }

  /* ---------- per-frame ---------- */
  private advance(t: number): void {
    this.t = t;
    const e = this.ease(t);

    if (this.steer !== 0) {
      this.lane = Phaser.Math.Clamp(this.lane + this.steer * 3.4 * 0.016, -1, 1);
    } else {
      const target = Math.round(this.lane);
      this.lane = Phaser.Math.Linear(this.lane, target, 0.12);
    }

    const band = Math.round(this.lane);
    if (band === this.critLane && this.enterT < 0 && t > TELEGRAPH_T - 0.05) this.enterT = t;

    const bx = VP.x + this.lane * this.spread(t);
    const by = this.pathY(t) + this.jumpOffset(t);
    const inAir = this.jumpOffset(t) < -2;
    const speed = 0.6 + e * 0.9;

    const r = 20 + Math.min(Math.max(combo.count - 1, 0), 6) * 3.5;
    this.ball.setPosition(bx, by);
    const scale = Phaser.Math.Linear(0.24, 1.0, e);
    this.ball.setScale(scale);
    this.ballImg.rotation += (0.10 + speed * 0.13) * (inAir ? 1.7 : 1);
    if (this.boosted > 0) {
      this.boosted -= 0.016;
      this.ballImg.setTint(0xFFE9B0);
    } else {
      this.ballImg.clearTint();
    }
    const shadowY = this.pathY(t) + 10;
    const airK = Math.max(0, 1 - Math.abs(this.jumpOffset(t)) / 90);
    this.shadow.setPosition(bx, shadowY);
    this.shadow.setScale(airK, airK);
    this.shadow.setAlpha(0.35 * airK + 0.05);

    this.trail.setPosition(bx, by + r * 0.7);
    this.trail.frequency = Phaser.Math.Linear(34, 10, e);

    // tower at the END of the run way — small on the horizon, looms at the end
    const tp = Math.pow(e, 1.8);
    const ts = Phaser.Math.Linear(0.13, 2.1, tp);
    const ty = Phaser.Math.Linear(VP.y + 24, H - 45, tp);
    this.towerC.setScale(ts);
    this.towerC.setPosition(VP.x, ty);

    if (t >= TELEGRAPH_T) {
      this.crack.setVisible(true);
      this.crack.setScale(ts);
      this.crack.setPosition(VP.x, ty);
      const pulse = 0.55 + 0.45 * Math.sin(this.time.now * 0.014);
      this.crack.setAlpha(pulse * 0.7 + 0.3);
      this.steerHint.setAlpha(Math.min(1, (t - TELEGRAPH_T) * 6));
      if (t > 0.82) this.steerHint.setAlpha(Math.max(0, 1 - (t - 0.82) * 5));
      const dir = this.critLane - band;
      if (dir !== 0) {
        this.steerHint.setText(dir > 0 ? 'steer  ▶' : '◀  steer').setColor('#F2B84B');
      } else {
        this.steerHint.setText('lock it in!').setColor('#5FC9A8');
      }
    }

    this.laneLights.forEach((g, i) => {
      g.clear();
      const lane = i - 1;
      const x = W / 2 + lane * LANE_SPACING;
      const isCrit = lane === this.critLane;
      const isCur = lane === band && t >= TELEGRAPH_T;
      g.fillStyle(0x16283D, 0.55);
      g.fillRoundedRect(x - 30, H - 58, 60, 22, 11);
      if (isCrit && t >= TELEGRAPH_T) {
        g.fillStyle(0xF2B84B, 0.5 + 0.5 * Math.sin(this.time.now * 0.014));
      } else if (isCur) {
        g.fillStyle(0x5FC9A8, 0.9);
      } else {
        g.fillStyle(0xFFFFFF, 0.25);
      }
      g.fillCircle(x, H - 47, 6);
    });

    // ground flow + speed streaks
    this.groundFlow.clear();
    this.groundFlow.lineStyle(5, 0xFFFFFF, 0.3 + e * 0.35);
    [-1, 0, 1].forEach((off) => {
      for (let k = 0; k < 5; k++) {
        const p = (t * (3 + e * 4) + k / 5) % 1;
        const y = Phaser.Math.Linear(VP.y + 26, H, p);
        const x = Phaser.Math.Linear(VP.x + off * 26, VP.x + off * LANE_SPACING * 3.4, p);
        this.groundFlow.beginPath();
        this.groundFlow.moveTo(x, y);
        this.groundFlow.lineTo(x, y + 14 + e * 26);
        this.groundFlow.strokePath();
      }
    });

    this.streaks.clear();
    this.streaks.lineStyle(3, 0xFFFFFF, 0.15 + e * 0.35);
    const n = Math.round(6 + e * 10);
    for (let i = 0; i < n; i++) {
      const sy = ((i * 149 + this.time.now * (0.9 + e * 2.2)) % H);
      const sx = (i * 263 + this.time.now * (40 + e * 260)) % (W + 400) - 200;
      const len = 30 + e * 170;
      this.streaks.beginPath();
      this.streaks.moveTo(sx, sy);
      this.streaks.lineTo(sx + len, sy);
      this.streaks.strokePath();
    }

    // boost orbs
    this.boostOrbs.removeAll(true);
    BOOSTS.forEach((b, i) => {
      const orbT = b.t;
      const ahead = orbT > t && orbT - t < 0.30;
      const passed = t >= orbT && !this.boostOrbs.getData('col' + i);
      if (passed) {
        if (band === b.lane) {
          this.boostOrbs.setData('col' + i, true);
          this.collectBoost(bx, by);
        }
        return;
      }
      if (ahead || (t >= orbT - 0.06 && t < orbT)) {
        const ox = VP.x + b.lane * this.spread(orbT);
        const oy = this.pathY(orbT) - 30;
        const orb = this.add.image(ox, oy, 'orb').setScale(0.8 + Math.sin(this.time.now * 0.01) * 0.15);
        orb.setDepth(6);
        this.boostOrbs.add(orb);
        this.boostOrbs.setData('col' + i, false);
      }
    });
  }

  private collectBoost(bx: number, by: number): void {
    this.boosted = 0.5;
    sfx.boost();
    this.cameras.main.flash(60, 255, 226, 154);
    const txt = this.add.text(bx, by - 60, '+BOOST!', {
      fontFamily: '"Baloo 2"', fontSize: '22px', color: '#F2B84B',
      stroke: '#16283D', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(8);
    this.tweens.add({ targets: txt, y: by - 120, alpha: 0, duration: 600, onComplete: () => txt.destroy() });
    this.add.particles(bx, by - 20, 'orb', {
      speed: { min: 40, max: 140 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      lifespan: 500,
      quantity: 12,
      emitting: false,
    }).explode(12);
  }

  /* ---------- impact ---------- */
  private impact(): void {
    if (this.done) return;
    this.done = true;
    this.steer = 0;
    this.trail.stop();

    const d = store.debts[this.towerIdx];
    const band = Math.round(this.lane);
    const inCrit = band === this.critLane;
    const late = this.enterT >= LATE_T;
    const crit: RollStats['crit'] = !inCrit ? 'none' : (late ? 'late' : 'early');
    const critMult = inCrit ? (late ? 2 : 1.25) : 1;

    const outcome: HitOutcome = applyHit(this.towerIdx, this.chip);
    const comboRes = registerHit(this.towerIdx);
    const interestTotal = outcome.interest * critMult * comboRes.mult;

    const bx = VP.x + band * LANE_SPACING;
    const by = H - 92;

    /* ---- slow-mo hit cam: you SEE the impact ---- */
    const slowMo = outcome.milestone ? 0.25 : 0.38;
    this.time.timeScale = slowMo;
    window.setTimeout(() => { this.time.timeScale = 1; }, outcome.milestone ? 750 : 550);
    this.cameras.main.flash(110, 255, 250, 235);
    this.cameras.main.shake(outcome.milestone ? 700 : 450, outcome.milestone ? 0.035 : 0.028);
    sfx.thud();
    sfx.crack();
    if (inCrit) sfx.crit();
    if (outcome.milestone) sfx.milestone();
    if (outcome.paidOff) sfx.win();

    /* ---- tower rocks on impact (settles back) ---- */
    this.tweens.add({
      targets: this.towerC,
      rotation: (band === -1 ? 0.05 : band === 1 ? -0.05 : 0.03) * (outcome.milestone ? 1.6 : 1),
      x: this.towerC.x + band * 4,
      duration: 110,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    /* ---- ball squashes then rebounds ---- */
    this.tweens.add({
      targets: this.ball,
      scaleX: 1.35, scaleY: 0.6,
      duration: 90, yoyo: true, ease: 'Quad.easeOut',
    });
    this.tweens.add({
      targets: this.ball,
      y: by - 34,
      duration: 160, yoyo: true, ease: 'Quad.easeOut',
    });

    /* ---- shockwave ring ---- */
    const ring = this.add.image(bx, by, 'ring').setDepth(6).setScale(0.4).setAlpha(0.9);
    this.tweens.add({
      targets: ring,
      scale: 3.2, alpha: 0,
      duration: 550,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    /* ---- debris at the impact point — scales with blocks actually removed ---- */
    const debrisY = this.towerC.y - 250;
    const chunkCount = Phaser.Math.Clamp(Math.ceil(outcome.blocks * 3.5), 5, 24);
    this.add.particles(bx, debrisY, 'chunk', {
      speed: { min: 200, max: 620 },
      angle: { min: -85, max: 15 },
      gravityY: 1150,
      scale: { start: 1.5, end: 0.35 },
      rotate: { min: -720, max: 720 },
      lifespan: { min: 700, max: 1600 },
      quantity: chunkCount,
      tint: [0xDFF3FB, 0xA8D5E5, 0x7FB8D0, 0xFFFFFF],
      emitting: false,
    }).explode(chunkCount);
    this.add.particles(bx, debrisY - 20, 'frost', {
      speed: { min: 150, max: 480 },
      angle: { min: -90, max: 20 },
      gravityY: 900,
      scale: { start: 1.2, end: 0.3 },
      rotate: { min: -540, max: 540 },
      lifespan: { min: 500, max: 1200 },
      quantity: 12,
      tint: [0xFFFFFF, 0xCFE8F5, 0x8FA9C0],
      emitting: false,
    }).explode(12);
    this.add.particles(bx, by, 'pix', {
      speed: { min: 100, max: 380 },
      angle: { min: 160, max: 200 },
      scale: { start: 1.6, end: 0 },
      lifespan: { min: 300, max: 700 },
      quantity: 22,
      tint: 0xFFFFFF,
      emitting: false,
    }).explode(22);

    // a couple of chunky blocks drop off and bounce (slow-mo makes this readable)
    for (let i = 0; i < 3; i++) {
      const c = this.add.image(bx + (i - 1) * 46, debrisY - 120 - i * 30, 'chunk').setDepth(7);
      c.setScale(1.8 + i * 0.3);
      c.setTint(0xA8D5E5);
      const landY = H - 30 - i * 14;
      this.tweens.add({
        targets: c,
        y: landY,
        angle: 360 + i * 120,
        duration: 520 + i * 160,
        ease: 'Quad.easeIn',
        onComplete: () => {
          sfx.land();
          this.tweens.add({
            targets: c, y: landY - 18, duration: 120, yoyo: true,
            onComplete: () => this.tweens.add({ targets: c, alpha: 0, duration: 400, onComplete: () => c.destroy() }),
          });
        },
      });
    }

    // milestone shatter
    if (outcome.milestone) {
      this.add.particles(bx, debrisY, 'pix', {
        speed: { min: 200, max: 620 },
        angle: { min: 0, max: 360 },
        gravityY: 500,
        scale: { start: 1.6, end: 0 },
        lifespan: { min: 500, max: 1200 },
        quantity: 64,
        tint: [0xF2B84B, 0xFFE29A, 0xFFFFFF],
        emitting: false,
      }).explode(64);
      const aurora = document.getElementById('aurora');
      if (aurora) {
        aurora.classList.add('strong');
        window.setTimeout(() => aurora.classList.remove('strong'), 2600);
      }
    }

    // redraw the looming tower with the damaged state — melt line drops
    window.setTimeout(() => {
      if (!this.scene.isActive()) return;
      this.towerC.destroy();
      this.crack.destroy();
      this.towerC = drawTower(this, VP.x, H - 45, store.debts[this.towerIdx], this.towerIdx, {
        showLabels: false, scale: 2.1,
      });
      this.towerC.setDepth(2);
    }, 340);

    const stats: RollStats = {
      debtIdx: this.towerIdx,
      debtName: d.name,
      amount: outcome.amount,
      blocks: outcome.blocks,
      interest: outcome.interest,
      interestTotal,
      crit,
      critMult,
      comboCount: comboRes.count,
      comboMult: comboRes.mult,
      milestone: outcome.milestone,
      paidOff: outcome.paidOff,
      left: principalLeft(d),
      pct: pctPaid(d),
    };
    this.hitApplied = true;
    window.setTimeout(() => bus.emit('result', stats), 1050);
  }

  private onHitAgain(): void {
    if (!this.hitApplied) return;
    this.scene.restart({ towerIdx: this.towerIdx, chip: this.chip });
  }

  private onToOverview(): void {
    this.scene.start('Overview');
  }
}
