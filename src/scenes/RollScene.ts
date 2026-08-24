/* ============================================================
   Roll — short first-person sequence: you ARE the snowball,
   rolling downhill at the tower. Lane-steer (keys / hold left
   or right half of the screen), steer into the telegraphed
   crack before impact. No RNG — the variance is all skill.
   ============================================================ */
import Phaser from 'phaser';
import {
  store, applyHit, registerHit, combo, comboMult, pctPaid, principalLeft,
  interestDestroyed, type HitOutcome,
} from '../core/state';
import { drawTower } from '../core/towerRender';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const VP = { x: 640, y: 268 };          // vanishing point
const LANE_SPACING = 118;               // px between lanes at the ball's depth
const DURATION = 2800;                  // ms of roll
const TELEGRAPH_T = 0.45;               // when the crack appears
const LATE_T = 0.62;                    // entering the crack lane after this = "late commit"

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

  private ball!: Phaser.GameObjects.Container;
  private towerC!: Phaser.GameObjects.Container;
  private crack!: Phaser.GameObjects.Container;
  private laneLights: Phaser.GameObjects.Graphics[] = [];
  private steerHint!: Phaser.GameObjects.Text;
  private streaks!: Phaser.GameObjects.Graphics;
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
    this.critLane = Phaser.Math.Between(-1, 1);
  }

  create(): void {
    const d = store.debts[this.towerIdx];
    if (!d || pctPaid(d) >= 1) { this.scene.start('Overview'); return; }

    // white pixel texture for particles
    if (!this.textures.exists('pix')) {
      const g = this.add.graphics();
      g.fillStyle(0xFFFFFF, 1);
      g.fillRect(0, 0, 8, 8);
      g.generateTexture('pix', 8, 8);
      g.destroy();
    }

    this.drawSlope();
    this.drawBall();
    this.drawTowerAhead();
    this.drawLaneLights();
    this.makeTrail();
    this.steerHint = this.add.text(W / 2, H - 96, '◀  steer into the crack  ▶', {
      fontFamily: '"Baloo 2"', fontSize: '18px', color: '#F4F8FB',
    }).setOrigin(0.5).setAlpha(0);
    this.streaks = this.add.graphics();

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
    bus.on('input-lock', this.onInputLock, this);
    bus.on('input-unlock', this.onInputUnlock, this);

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
    bus.off('input-lock', this.onInputLock, this);
    bus.off('input-unlock', this.onInputUnlock, this);
  }

  /* ---------- scenery ---------- */
  private drawSlope(): void {
    const g = this.add.graphics();
    // sky band above horizon handled by CSS; slope below
    g.fillStyle(0xEAF4FA, 0.9);
    g.fillPoints([
      { x: 0, y: H }, { x: W, y: H }, { x: W, y: VP.y + 40 }, { x: 0, y: VP.y + 40 },
    ], true);
    // converging lane guides
    g.lineStyle(5, 0xFFFFFF, 0.7);
    const bottoms = [-LANE_SPACING * 3.2, 0, LANE_SPACING * 3.2];
    bottoms.forEach((off) => {
      g.beginPath();
      g.moveTo(VP.x + off * 0.14, VP.y + 20);
      g.lineTo(VP.x + off, H);
      g.strokePath();
    });
    // side snowbanks
    g.fillStyle(0xFFFFFF, 0.95);
    g.fillEllipse(70, H - 30, 300, 90);
    g.fillEllipse(W - 70, H - 30, 300, 90);
  }

  private drawBall(): void {
    const d = store.debts[this.towerIdx];
    const comboBonus = Math.min(Math.max(combo.count - 1, 0), 6);
    const r = 20 + comboBonus * 3.5;
    const g = this.add.graphics();
    g.fillStyle(0xFFFFFF, 1);
    g.fillCircle(0, 0, r);
    g.fillStyle(0xCFE8F5, 0.8);
    g.fillCircle(-r * 0.28, -r * 0.3, r * 0.32);
    g.fillCircle(r * 0.3, r * 0.2, r * 0.22);
    g.lineStyle(2.5, 0x9CCFE2, 1);
    g.strokeCircle(0, 0, r);
    // craters
    g.fillStyle(0xB9D9E8, 0.9);
    [[0.25, -0.5], [-0.5, 0.15], [0.5, 0.45], [-0.1, 0.6]].forEach(([cx, cy]) => {
      g.fillCircle(cx * r, cy * r, r * 0.16);
    });
    // eyes — it's you, rolling at your debt
    g.fillStyle(0x16283D, 1);
    g.fillCircle(-r * 0.3, -r * 0.05, r * 0.09);
    g.fillCircle(r * 0.3, -r * 0.05, r * 0.09);
    this.ball = this.add.container(W / 2, H - 84, [g]);
    this.ball.setDepth(5);
  }

  private drawTowerAhead(): void {
    const d = store.debts[this.towerIdx];
    this.towerC = drawTower(this, VP.x, VP.y, d, this.towerIdx, {
      showLabels: false, scale: 0.3,
    });
    this.towerC.setDepth(2);
    // crit crack marker (gold glow, scaled with tower)
    const cg = this.add.graphics();
    const cx = this.critLane * 62;
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
    this.crack = this.add.container(VP.x, VP.y, [cg]);
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
      speed: { min: 30, max: 90 },
      angle: { min: 60, max: 120 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 450,
      frequency: 28,
      quantity: 2,
      tint: 0xFFFFFF,
    });
    this.trail.setDepth(4);
  }

  /* ---------- per-frame ---------- */
  private advance(t: number): void {
    this.t = t;

    // steering: move + ease toward nearest lane when no input
    if (this.steer !== 0) {
      this.lane = Phaser.Math.Clamp(this.lane + this.steer * 3.4 * 0.016, -1, 1);
    } else {
      const target = Math.round(this.lane);
      this.lane = Phaser.Math.Linear(this.lane, target, 0.12);
    }

    // track first entry into the crit lane (for late/early commit)
    const band = Math.round(this.lane);
    if (band === this.critLane && this.enterT < 0 && t > 0.15) this.enterT = t;

    // ball position + rolling rotation + grow with combo
    const r = 20 + Math.min(Math.max(combo.count - 1, 0), 6) * 3.5;
    this.ball.setPosition(W / 2 + this.lane * LANE_SPACING, H - 84);
    this.ball.setScale(r / 20);
    this.ball.rotation += 0.09 + combo.count * 0.012;
    this.trail.setPosition(this.ball.x, this.ball.y + r * 0.8);

    // tower approaches: scale + sink toward the player
    const s = 0.3 + t * 1.35;
    this.towerC.setScale(s);
    this.towerC.setPosition(VP.x, VP.y + t * 120);

    // crack telegraph + lights
    if (t >= TELEGRAPH_T) {
      this.crack.setVisible(true);
      this.crack.setScale(s);
      this.crack.setPosition(VP.x, VP.y + t * 120);
      const pulse = 0.55 + 0.45 * Math.sin(this.time.now * 0.014);
      this.crack.setAlpha(pulse * 0.7 + 0.3);
      this.steerHint.setAlpha(Math.min(1, (t - TELEGRAPH_T) * 6));
      if (t > 0.75) this.steerHint.setAlpha(Math.max(0, 1 - (t - 0.75) * 4));
      // arrow pointing to the crit lane
      const dir = this.critLane - Math.round(this.lane);
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

    // speed streaks
    this.streaks.clear();
    this.streaks.lineStyle(3, 0xFFFFFF, 0.25 + t * 0.2);
    for (let i = 0; i < 8; i++) {
      const sx = ((i * 173 + this.time.now * (0.8 + t * 1.4)) % W);
      const len = 30 + t * 120;
      this.streaks.beginPath();
      this.streaks.moveTo(sx, H - 40 - ((i * 97) % 160));
      this.streaks.lineTo(sx + len, H - 40 - ((i * 97) % 160));
      this.streaks.strokePath();
    }
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
    this.cameras.main.flash(90, 255, 250, 235);
    this.cameras.main.shake(220, 0.02);
    this.time.timeScale = 0.12;
    window.setTimeout(() => { this.time.timeScale = 1; }, 130);
    sfx.thud();
    sfx.crack();
    if (inCrit) sfx.crit();
    if (outcome.milestone) sfx.milestone();
    if (outcome.paidOff) sfx.win();

    // burst particles
    const bx = W / 2 + band * LANE_SPACING;
    const by = H - 120;
    this.add.particles(bx, by, 'pix', {
      speed: { min: 120, max: 420 },
      angle: { min: 180, max: 360 },
      scale: { start: 1.2, end: 0 },
      lifespan: { min: 300, max: 800 },
      quantity: 34,
      tint: [0xA8D5E5, 0xDFF3FB, 0xFFFFFF],
      emitting: false,
    }).explode(34);
    if (outcome.milestone) {
      this.cameras.main.shake(420, 0.03);
      this.add.particles(bx, by, 'pix', {
        speed: { min: 200, max: 560 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.4, end: 0 },
        lifespan: { min: 500, max: 1100 },
        quantity: 60,
        tint: [0xF2B84B, 0xFFE29A, 0xFFFFFF],
        emitting: false,
      }).explode(60);
      // aurora pulse on the CSS layer
      const aurora = document.getElementById('aurora');
      if (aurora) {
        aurora.classList.add('strong');
        window.setTimeout(() => aurora.classList.remove('strong'), 2600);
      }
    }

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
    window.setTimeout(() => bus.emit('result', stats), 950);
  }

  private onHitAgain(): void {
    if (!this.hitApplied) return;
    this.scene.restart({ towerIdx: this.towerIdx, chip: this.chip });
  }

  private onToOverview(): void {
    this.scene.start('Overview');
  }

  private onInputLock(): void {
    this.input.enabled = false;
  }

  private onInputUnlock(): void {
    this.input.enabled = true;
  }
}
