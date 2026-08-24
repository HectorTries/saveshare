/* ============================================================
   Roll — chase-cam downhill run. You're a snowball picking up
   speed, catching air over ramps, grabbing boost orbs, and
   slamming into the tower — which visibly sheds chunks of ice.
   Lane-steer (keys / hold left or right half of the screen),
   steer into the telegraphed crack before impact. No RNG —
   the variance is all skill.
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
const LANE_SPACING = 110;               // px between lanes at the ball's depth
const DURATION = 4600;                  // ms of roll — longer, builds up
const TELEGRAPH_T = 0.5;                // when the crack appears
const LATE_T = 0.65;                    // entering the crack lane after this = "late commit"
const JUMPS = [
  { t0: 0.26, t1: 0.40, h: 58 },
  { t0: 0.54, t1: 0.68, h: 78 },
];
const BOOSTS = [
  { t: 0.16, lane: -1 },
  { t: 0.40, lane: 1 },
  { t: 0.60, lane: 0 },
];
const TREES = [
  { t: 0.12, side: -1 }, { t: 0.28, side: 1 }, { t: 0.44, side: -1 },
  { t: 0.58, side: 1 }, { t: 0.72, side: -1 },
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

  private lane = 0;                    // float -1..1
  private steer = 0;                   // -1 | 0 | 1
  private critLane = 0;                // -1 | 0 | 1
  private enterT = -1;                 // first t when player was in crit lane
  private t = 0;
  private done = false;
  private hitApplied = false;
  private boosted = 0;                 // boost glow timer (s)
  private treesDone = new Set<number>();

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
  private boostTexts: Phaser.GameObjects.Text[] = [];

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
    this.treesDone.clear();
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

    // opening beat
    const go = this.add.text(W / 2, VP.y + 90, 'HERE WE GO!', {
      fontFamily: '"Baloo 2"', fontSize: '34px', color: '#F4F8FB',
      stroke: '#16283D', strokeThickness: 8,
    }).setOrigin(0.5);
    this.tweens.add({ targets: go, alpha: 0, y: VP.y + 60, duration: 700, delay: 500 });
    this.tweens.add({ targets: go, y: VP.y + 120, duration: 500, yoyo: true, ease: 'Quad.easeOut' });

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
      from: 0, to: 1, duration: DURATION, ease: 'Linear',
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
    // sky band above horizon handled by CSS; slope below
    const grad = this.add.graphics();
    grad.fillStyle(0xEAF4FA, 0.9);
    grad.fillPoints([
      { x: 0, y: H }, { x: W, y: H }, { x: W, y: VP.y + 30 }, { x: 0, y: VP.y + 30 },
    ], true);
    // converging lane guides (3 lanes)
    g.lineStyle(6, 0xFFFFFF, 0.75);
    [-1, 0, 1].forEach((off) => {
      g.beginPath();
      g.moveTo(VP.x + off * 26, VP.y + 26);
      g.lineTo(VP.x + off * LANE_SPACING * 3.4, H);
      g.strokePath();
    });
    // side snowbanks
    g.fillStyle(0xFFFFFF, 0.95);
    g.fillEllipse(60, H - 26, 320, 96);
    g.fillEllipse(W - 60, H - 26, 320, 96);
    this.add.text(VP.x, VP.y - 30, '', { fontFamily: '"Manrope"', fontSize: '12px', color: '#9FB2C4' });
  }

  private drawRamps(): void {
    const g = this.add.graphics();
    g.fillStyle(0xF2F9FC, 1);
    JUMPS.forEach((j) => {
      const y = this.pathY(j.t0);
      const spread = this.spread(j.t0);
      // ramp lip across the road
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
    // eyes — counter-rotate so they stay upright while the ball rolls
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
      showLabels: false, scale: 0.13, // distant at the end of the run way
    });
    this.towerC.setDepth(2);
    // crit crack marker (gold glow, scaled with tower)
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
  /** eased 0..1 progress — starts slow, builds up speed */
  private ease(t: number): number {
    return t * t * (3 - 2 * t); // smoothstep-ish acceleration
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
        return -Math.sin(k * Math.PI) * j.h; // parabolic arc upward
      }
    }
    return 0;
  }

  /* ---------- per-frame ---------- */
  private advance(t: number): void {
    this.t = t;
    const e = this.ease(t);

    // steering: move + ease toward nearest lane when no input
    if (this.steer !== 0) {
      this.lane = Phaser.Math.Clamp(this.lane + this.steer * 3.4 * 0.016, -1, 1);
    } else {
      const target = Math.round(this.lane);
      this.lane = Phaser.Math.Linear(this.lane, target, 0.12);
    }

    // track first entry into the crit lane (for late/early commit)
    const band = Math.round(this.lane);
    if (band === this.critLane && this.enterT < 0 && t > TELEGRAPH_T - 0.05) this.enterT = t;

    // ball travels toward camera + lane
    const bx = VP.x + this.lane * this.spread(t);
    const by = this.pathY(t) + this.jumpOffset(t);
    const inAir = this.jumpOffset(t) < -2;
    const speed = 0.6 + e * 0.9; // rolling speed factor

    const r = 20 + Math.min(Math.max(combo.count - 1, 0), 6) * 3.5;
    this.ball.setPosition(bx, by);
    const scale = Phaser.Math.Linear(0.24, 1.0, e);
    this.ball.setScale(scale);
    this.ballImg.rotation += (0.10 + speed * 0.13) * (inAir ? 1.7 : 1);
    // boost glow
    if (this.boosted > 0) {
      this.boosted -= 0.016;
      this.ballImg.setTint(0xFFE9B0);
    } else {
      this.ballImg.clearTint();
    }
    // shadow stays on the slope; shrinks while airborne
    const shadowY = this.pathY(t) + 10;
    const airK = Math.max(0, 1 - Math.abs(this.jumpOffset(t)) / 90);
    this.shadow.setPosition(bx, shadowY);
    this.shadow.setScale(airK, airK);
    this.shadow.setAlpha(0.35 * airK + 0.05);

    // trail emission grows with speed
    this.trail.setPosition(bx, by + r * 0.7);
    this.trail.frequency = Phaser.Math.Linear(34, 10, e);

    // tower sits at the END of the run way — small on the horizon for most of
    // the run, then looms in the final stretch as you close in (perspective curve)
    const tp = Math.pow(e, 1.8);
    const ts = Phaser.Math.Linear(0.13, 2.1, tp);
    const ty = Phaser.Math.Linear(VP.y + 24, H - 45, tp);
    this.towerC.setScale(ts);
    this.towerC.setPosition(VP.x, ty);

    // crack telegraph
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

    // lane lights: current = bright, crit = gold
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

    // ground flow: lane dashes rushing toward camera
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

    // speed streaks (wind)
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

    // boost orbs on the slope — grab them by being in the lane
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

    // pine trees rushing past at the edges
    TREES.forEach((tr, i) => {
      if (t >= tr.t && !this.treesDone.has(i)) {
        this.treesDone.add(i);
        this.spawnTree(tr.side, tr.t);
      }
    });

    // tiny camera shake as speed builds (re-triggered each frame while fast)
    const shake = e > 0.78 ? Math.min((e - 0.78) * 0.025, 0.012) : 0;
    if (shake > 0) {
      this.cameras.main.shake(120, shake);
    }
  }

  private spawnTree(side: number, atT: number): void {
    const g = this.add.graphics();
    const x0 = VP.x + side * 60;
    const y0 = this.pathY(atT) - 40;
    g.fillStyle(0x33506B, 1);
    g.fillTriangle(-16, 12, 16, 12, 0, -30);
    g.fillTriangle(-12, -2, 12, -2, 0, -38);
    g.fillStyle(0xF4FAFD, 0.9);
    g.fillTriangle(-7, -12, 7, -12, 0, -24);
    const c = this.add.container(x0, y0, [g]);
    c.setDepth(1);
    const targetX = side > 0 ? W + 120 : -120;
    const targetY = H - 60;
    this.tweens.add({
      targets: c,
      x: targetX, y: targetY,
      scale: 2.4,
      duration: 1400,
      ease: 'Quad.easeIn',
      onComplete: () => c.destroy(),
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
    this.boostTexts.push(txt);
    this.tweens.add({ targets: txt, y: by - 120, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
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

    // the actual hit — principal only moves blocks
    const outcome: HitOutcome = applyHit(this.towerIdx, this.chip);
    const comboRes = registerHit(this.towerIdx);
    const interestTotal = outcome.interest * critMult * comboRes.mult;

    // hit-stop + shake + flash
    this.cameras.main.flash(110, 255, 250, 235);
    this.cameras.main.shake(450, 0.03);
    this.time.timeScale = 0.08;
    window.setTimeout(() => { this.time.timeScale = 1; }, 140);
    sfx.thud();
    sfx.crack();
    if (inCrit) sfx.crit();
    if (outcome.milestone) sfx.milestone();
    if (outcome.paidOff) sfx.win();

    const bx = VP.x + band * LANE_SPACING;
    const by = H - 92;

    /* ice chunks shearing off the tower — the "a bit falls off" moment */
    const debrisY = this.towerC.y - 250; // visible lower-mid tower, where the ball hits
    const em = this.add.particles(bx, debrisY, 'chunk', {
      speed: { min: 200, max: 620 },
      angle: { min: -80, max: 10 },
      gravityY: 1150,
      scale: { start: 1.5, end: 0.35 },
      rotate: { min: -720, max: 720 },
      lifespan: { min: 700, max: 1600 },
      quantity: 16,
      tint: [0xDFF3FB, 0xA8D5E5, 0x7FB8D0, 0xFFFFFF],
      emitting: false,
    }).explode(16);
    // frost shell shards
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
    // snow puff
    this.add.particles(bx, by, 'pix', {
      speed: { min: 100, max: 380 },
      angle: { min: 160, max: 200 },
      scale: { start: 1.6, end: 0 },
      lifespan: { min: 300, max: 700 },
      quantity: 22,
      tint: 0xFFFFFF,
      emitting: false,
    }).explode(22);

    // a couple of chunky blocks drop off the tower and bounce
    for (let i = 0; i < 3; i++) {
      const c = this.add.image(bx + (i - 1) * 46, debrisY - 120 - i * 30, 'chunk').setDepth(7);
      c.setScale(1.8 + i * 0.3);
      c.setTint(0xA8D5E5);
      const landY = H - 30 - i * 14;
      this.tweens.add({
        targets: c,
        y: landY,
        angle: 360 + i * 120,
        duration: 420 + i * 160,
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
      this.cameras.main.shake(600, 0.04);
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

    // redraw the looming tower with the new (damaged) state — melt line drops
    window.setTimeout(() => {
      if (!this.scene.isActive()) return;
      this.towerC.destroy();
      this.crack.destroy();
      this.towerC = drawTower(this, VP.x, H - 45, store.debts[this.towerIdx], this.towerIdx, {
        showLabels: false, scale: 2.1,
      });
      this.towerC.setDepth(2);
    }, 320);

    // result readout
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
    window.setTimeout(() => bus.emit('result', stats), 1100);
  }

  private onHitAgain(): void {
    if (!this.hitApplied) return;
    this.scene.restart({ towerIdx: this.towerIdx, chip: this.chip });
  }

  private onToOverview(): void {
    this.scene.start('Overview');
  }
}
