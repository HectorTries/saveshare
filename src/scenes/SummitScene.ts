/* ============================================================
   Summit — the mountain scene.
   The snowball sits on a 2D mountain: peak → right slope to the
   payoff flag, left slope into the spiral pit. APR drives a
   constant leftward pull; payments push right. Push quality is a
   timing meter (golf-swing style), never chance. Each push shows
   the honest principal £ and the interest avoided separately.
   ============================================================ */
import Phaser from 'phaser';
import {
  store, applyPush, prefs, setPrefs, pctPaid, principalLeft, monthsLeft,
  interestDestroyed, money, driftPerSec, combo, comboMult,
  PIT, type PushOutcome,
} from '../core/state';
import {
  drawMountain, drawSwirl, pointAt, ballRadius, terrainPoints,
  FLAG, PIT as PIT_POS, type MountainRef,
} from '../core/mountainRender';
import { ensureGameTextures } from '../core/textures';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const CHIPS = [15, 50, 100, 250, 500, 1000, 2500];
const METER = { x0: 340, x1: 940, y: 430, perfect: 0.08, good: 0.16 };

interface MeterStop {
  eff: number;
  label: 'PERFECT' | 'GOOD' | 'SLOPPY';
}

export class SummitScene extends Phaser.Scene {
  private debtIdx = 0;
  private chip = 100;

  /** public accessor for tests/debug */
  get debt() { return store.debts[this.debtIdx]; }

  private mountain!: MountainRef;
  private ballC!: Phaser.GameObjects.Container;
  private ballImg!: Phaser.GameObjects.Image;
  private eyes!: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hudInfo!: Phaser.GameObjects.Text;
  private hudCombo!: Phaser.GameObjects.Text;
  private chipBtns: Phaser.GameObjects.Container[] = [];
  private payBtn!: Phaser.GameObjects.Container;
  private payLbl!: Phaser.GameObjects.Text;
  private backBtn!: Phaser.GameObjects.Container;
  private hintText!: Phaser.GameObjects.Text;

  private meterG!: Phaser.GameObjects.Graphics | null;
  private meterMarker = 0.5;
  private meterDir = 1;
  private meterActive = false;
  private meterOpenedAt = 0;
  private meterStopLbl!: Phaser.GameObjects.Text;
  private busy = false;          // push animation running
  private driftAcc = 0;
  private lastSave = 0;

  constructor() { super('Summit'); }

  init(data: { idx: number }): void {
    this.debtIdx = data.idx;
    this.chip = prefs.chip;
    this.meterActive = false;
    this.busy = false;
    this.meterG = null;
  }

  create(): void {
    const d = store.debts[this.debtIdx];
    if (!d) { this.scene.start('Overview'); return; }
    this.input.enabled = true;
    ensureGameTextures(this);
    (window as any).__summit = this;

    this.drawMountainAndBall();
    this.drawHud();
    this.drawChips();
    this.drawPayButton();
    this.drawBackButton();
    this.drawMeterUI();
    this.emitHud();

    // input: Space stops the meter
    this.input.keyboard!.on('keydown-SPACE', () => { if (this.meterActive) this.stopMeter(); });
    this.input.keyboard!.on('keydown-ESC', () => { if (!this.meterActive) this.toOverview(); });
    this.input.on('pointerdown', () => {
      // ignore the very click that opened the meter
      if (this.meterActive && this.time.now - this.meterOpenedAt > 250) this.stopMeter();
    });
  }

  shutdown(): void {
    this.input.keyboard!.off('keydown-SPACE');
    this.input.keyboard!.off('keydown-ESC');
    this.input.off('pointerdown');
  }

  /* ---------- scene drawing ---------- */
  private drawMountainAndBall(): void {
    const d = store.debts[this.debtIdx];
    // mountain (redrawn wholesale on terrain change)
    this.mountain = drawMountain(this, d);
    this.mountain.container.setDepth(0);

    // ball
    const r = ballRadius(d);
    const pos = pointAt(d, d.progress);
    this.ballImg = this.add.image(0, 0, 'snowball').setDisplaySize(r * 2.2, r * 2.2);
    this.eyes = this.add.container(0, 0);
    const eyeG = this.add.graphics();
    eyeG.fillStyle(0x16283D, 1);
    eyeG.fillCircle(-r * 0.3, -r * 0.05, r * 0.09);
    eyeG.fillCircle(r * 0.3, -r * 0.05, r * 0.09);
    eyeG.fillStyle(0xFFFFFF, 1);
    eyeG.fillCircle(-r * 0.34, -r * 0.09, r * 0.035);
    eyeG.fillCircle(r * 0.26, -r * 0.09, r * 0.035);
    this.eyes.add(eyeG);
    this.ballC = this.add.container(pos.x, pos.y, [this.ballImg, this.eyes]);
    this.ballC.setDepth(4);
    this.shadow = this.add.ellipse(pos.x, pos.y + r * 0.9, r * 1.8, r * 0.45, 0x0B1524, 0.3);
    this.shadow.setDepth(3);
    this.trail = this.add.particles(0, 0, 'pix', {
      speed: { min: 20, max: 70 },
      angle: { min: -160, max: -20 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 450,
      frequency: -1,
      tint: 0xFFFFFF,
    });
    this.trail.setDepth(4);
  }

  private drawHud(): void {
    this.hudInfo = this.add.text(20, 16, '', {
      fontFamily: '"Baloo 2"', fontSize: '16px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 5,
    }).setDepth(10);
    this.hudCombo = this.add.text(W - 20, 16, '', {
      fontFamily: '"JetBrains Mono"', fontSize: '13px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(1, 0).setDepth(10);
    this.hintText = this.add.text(W / 2, H - 24, '', {
      fontFamily: '"Manrope"', fontSize: '12px', color: '#9FB2C4',
    }).setOrigin(0.5).setDepth(10);
    this.refreshHud();
  }

  private refreshHud(): void {
    const d = store.debts[this.debtIdx];
    if (!d) return;
    const pct = Math.round(pctPaid(d) * 100);
    const at = Math.round(d.progress * 100);
    this.hudInfo.setText(
      `${d.name} — ${money(principalLeft(d))} left · APR ${d.apr}% · ${monthsLeft(d)}mo · ${pct}% cleared`,
    );
    const c = combo.count;
    this.hudCombo.setText(c > 1 && combo.debtIdx === this.debtIdx
      ? `COMBO ×${comboMult().toFixed(1)} (${c})`
      : `ball at ${at}% of the slope`);
    this.hintText.setText(
      d.progress < 0 ? 'You slipped toward the spiral — push to climb back!' : 'Pay a chip, time the marker in the gold, ride the slope down.',
    );
  }

  /* ---------- chip selector ---------- */
  private drawChips(): void {
    this.add.text(W / 2, H - 118, 'PAYMENT PER PUSH', {
      fontFamily: '"JetBrains Mono"', fontSize: '10px', color: '#9FB2C4',
    }).setOrigin(0.5).setDepth(10);
    CHIPS.forEach((v, i) => {
      const active = this.chip === v;
      const x = W / 2 - 295 + i * 98;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0x5FC9A8 : 0xFFFFFF, active ? 1 : 0.12);
      bg.fillRoundedRect(-44, -17, 88, 34, 17);
      const label = this.add.text(0, 0, '£' + v, {
        fontFamily: '"Baloo 2"', fontSize: '15px',
        color: active ? '#10241C' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, H - 88, [bg, label]);
      c.setSize(88, 34).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        if (this.meterActive || this.busy) return;
        this.chip = v;
        setPrefs(v, prefs.strategy);
        this.scene.restart({ idx: this.debtIdx });
      });
      this.chipBtns.push(c);
      c.setDepth(10);
    });
  }

  /* ---------- pay button ---------- */
  private drawPayButton(): void {
    const x = W / 2;
    const y = H - 60;
    const g = this.add.graphics();
    g.fillStyle(0x5FC9A8, 1);
    g.fillRoundedRect(-92, -26, 184, 52, 26);
    g.fillStyle(0xFFFFFF, 0.25);
    g.fillRoundedRect(-84, -20, 168, 12, 6);
    this.payLbl = this.add.text(0, 0, `PAY £${this.chip} ❄️`, {
      fontFamily: '"Baloo 2"', fontSize: '19px', color: '#10241C', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.payBtn = this.add.container(x, y, [g, this.payLbl]);
    this.payBtn.setSize(184, 52).setInteractive({ useHandCursor: true });
    this.payBtn.on('pointerdown', () => { if (!this.meterActive && !this.busy) this.openMeter(); });
    this.payBtn.setDepth(10);
  }

  private drawBackButton(): void {
    const g = this.add.graphics();
    g.fillStyle(0xFFFFFF, 0.12);
    g.fillRoundedRect(-46, -18, 92, 36, 18);
    const label = this.add.text(0, 0, '🏔 Range', {
      fontFamily: '"Baloo 2"', fontSize: '14px', color: '#F4F8FB',
    }).setOrigin(0.5);
    this.backBtn = this.add.container(64, 42, [g, label]);
    this.backBtn.setSize(92, 36).setInteractive({ useHandCursor: true });
    this.backBtn.on('pointerdown', () => { if (!this.meterActive && !this.busy) this.toOverview(); });
    this.backBtn.setDepth(10);
  }

  /* ---------- timing meter ---------- */
  private drawMeterUI(): void {
    this.meterStopLbl = this.add.text(W / 2, METER.y - 44, 'TIMING — stop in the gold!', {
      fontFamily: '"Baloo 2"', fontSize: '17px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(10);
    this.meterStopLbl.setVisible(false);
  }

  private openMeter(): void {
    this.meterActive = true;
    this.meterOpenedAt = this.time.now;
    this.meterMarker = 0.15;
    this.meterDir = 1;
    this.payBtn.setAlpha(0.45);
    this.meterStopLbl.setVisible(true);
    sfx.select();
    this.drawMeter();
  }

  private drawMeter(): void {
    if (this.meterG) this.meterG.destroy();
    const g = this.add.graphics();
    const { x0, x1, y, perfect, good } = METER;
    const bw = x1 - x0;
    // track
    g.fillStyle(0x16283D, 0.75);
    g.fillRoundedRect(x0 - 8, y - 16, bw + 16, 32, 16);
    // good zone (amber)
    g.fillStyle(0xF2B84B, 0.28);
    g.fillRoundedRect(x0 + bw * (0.5 - good), y - 12, bw * good * 2, 24, 12);
    // perfect zone (gold)
    g.fillStyle(0xF2B84B, 0.75);
    g.fillRoundedRect(x0 + bw * (0.5 - perfect), y - 12, bw * perfect * 2, 24, 12);
    // centre tick
    g.fillStyle(0xFFE29A, 1);
    g.fillRect(x0 + bw * 0.5 - 1, y - 12, 2, 24);
    // marker
    const mx = x0 + bw * this.meterMarker;
    g.fillStyle(0xFFFFFF, 1);
    g.fillRoundedRect(mx - 4, y - 20, 8, 40, 4);
    g.lineStyle(2, 0x3E92CC, 1);
    g.strokeRoundedRect(mx - 4, y - 20, 8, 40, 4);
    this.meterG = g;
    this.meterG.setDepth(11);
  }

  private meterUpdate(dt: number): void {
    if (!this.meterActive) return;
    const speed = 0.55 + Math.min(combo.count, 6) * 0.035; // combo makes it a touch faster
    this.meterMarker += this.meterDir * speed * (dt / 1000);
    if (this.meterMarker > 0.88) { this.meterMarker = 0.88; this.meterDir = -1; }
    if (this.meterMarker < 0.12) { this.meterMarker = 0.12; this.meterDir = 1; }
    this.drawMeter();
  }

  /** public for E2E: stop the meter at an explicit marker position */
  stopMeterAt(v: number): MeterStop | null {
    if (!this.meterActive) return null;
    this.meterMarker = v;
    return this.stopMeter();
  }

  private stopMeter(): MeterStop | null {
    if (!this.meterActive) return null;
    this.meterActive = false;
    this.payBtn.setAlpha(1);
    const { perfect, good } = METER;
    const off = Math.abs(this.meterMarker - 0.5);
    const eff = off <= perfect ? 1.3 : off <= good ? 1.0 : 0.6;
    const label: MeterStop['label'] = off <= perfect ? 'PERFECT' : off <= good ? 'GOOD' : 'SLOPPY';
    this.meterStopLbl.setVisible(false);
    if (this.meterG) { this.meterG.destroy(); this.meterG = null; }
    this.executePush(eff, label);
    return { eff, label };
  }

  /* ---------- push ---------- */
  private executePush(eff: number, label: MeterStop['label']): void {
    const d = store.debts[this.debtIdx];
    if (!d || pctPaid(d) >= 1) return;
    this.busy = true;
    const outcome: PushOutcome = applyPush(this.debtIdx, this.chip, eff);
    if (outcome.amount <= 0) { this.busy = false; return; }

    if (label === 'PERFECT') sfx.crit();
    else if (label === 'GOOD') sfx.chip();
    else sfx.thud();

    // ball animation — roll right along the slope
    const fromP = Math.max(-PIT, d.progress - outcome.distPct / 100);
    const toP = d.progress;
    const p0 = pointAt(d, fromP);
    const p1 = pointAt(d, toP);
    const distPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const r = ballRadius(d);
    this.ballC.setPosition(p0.x, p0.y);
    this.shadow.setPosition(p0.x, p0.y + r * 0.9);
    this.tweens.addCounter({
      from: 0, to: 1, duration: 420, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const p = Phaser.Math.Linear(fromP, toP, k);
        const pos = pointAt(d, p);
        this.ballC.setPosition(pos.x, pos.y);
        this.shadow.setPosition(pos.x, pos.y + r * 0.9);
        this.trail.emitParticleAt(pos.x, pos.y + r * 0.4, 2);
        this.ballImg.rotation += (distPx / r) * 0.16 * k;
      },
      onComplete: () => {
        this.busy = false;
        this.afterPush(outcome, p1, label);
      },
    });
  }

  private afterPush(o: PushOutcome, at: { x: number; y: number }, label: MeterStop['label']): void {
    const d = store.debts[this.debtIdx];
    this.redrawMountain();
    this.refreshHud();

    // readout — honest numbers, kept separate. Stacked ABOVE the ball so the slope
    // never gets buried in text; left-aligned to the screen for readability.
    const lines: { text: string; color: string; size: number }[] = [
      { text: `${label} — ${money(o.amount)} principal · +${o.basePct.toFixed(2)}%`, color: label === 'PERFECT' ? '#F2B84B' : label === 'GOOD' ? '#5FC9A8' : '#B7C7D6', size: 16 },
      { text: `💸 ${money(o.interest)} interest avoided`, color: '#5FC9A8', size: 14 },
    ];
    if (o.comboCount > 1) lines.push({ text: `COMBO ×${o.comboMult.toFixed(1)}`, color: '#F2B84B', size: 13 });
    if (o.flattenApplied > 0.01) lines.push({ text: 'slope flattened ahead', color: '#BFE3F2', size: 12 });
    const anchorX = Math.max(170, Math.min(W - 170, at.x));
    const startY = Math.max(96, at.y - 90 - lines.length * 20);
    lines.forEach((l, i) => {
      const t = this.add.text(anchorX, startY + i * 24, l.text, {
        fontFamily: '"Baloo 2"', fontSize: `${l.size}px`, color: l.color,
        stroke: '#0F1A2E', strokeThickness: 4,
      }).setOrigin(0.5, 0).setDepth(9);
      this.tweens.add({
        targets: t, y: t.y - 34, alpha: 0, duration: 1500, delay: 1100,
        onComplete: () => t.destroy(),
      });
    });

    // milestone / clear celebrations
    if (o.milestone) this.milestoneBeat(o.milestone, d.progress);
    if (o.cleared) this.clearCelebration();

    if (o.milestone || o.cleared) {
      this.time.timeScale = 0.35;
      window.setTimeout(() => { this.time.timeScale = 1; }, 550);
    }
    this.emitHud();
  }

  private milestoneBeat(milestone: number, atP: number): void {
    const d = store.debts[this.debtIdx];
    const pos = pointAt(d, atP);
    const pt = terrainPoints(d);
    const mi = Math.floor((milestone / 100) * (pt.length - 1));
    const flagPos = pt[Math.min(pt.length - 1, mi)] ?? pos;
    this.cameras.main.shake(300, 0.012);
    this.cameras.main.flash(90, 255, 226, 154);
    sfx.milestone();
    this.add.particles(flagPos.x, flagPos.y - 10, 'pix', {
      speed: { min: 80, max: 320 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      lifespan: { min: 400, max: 900 },
      quantity: 42,
      tint: [0xF2B84B, 0xFFE29A, 0xFFFFFF],
      emitting: false,
    }).explode(42);
    // banner at the bottom of the screen — above the chips, never near the ball readouts
    const banner = this.add.text(W / 2, 496, `${milestone}% MILESTONE`, {
      fontFamily: '"Baloo 2"', fontSize: '26px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: banner, scale: 1.15, alpha: 0, duration: 1400, delay: 700, onComplete: () => banner.destroy() });
  }

  private clearCelebration(): void {
    const d = store.debts[this.debtIdx];
    this.cameras.main.shake(600, 0.02);
    sfx.win();
    const aurora = document.getElementById('aurora');
    if (aurora) {
      aurora.classList.add('strong');
      window.setTimeout(() => aurora.classList.remove('strong'), 2600);
    }
    this.add.particles(FLAG.x, FLAG.y - 20, 'pix', {
      speed: { min: 120, max: 460 },
      angle: { min: -100, max: 80 },
      gravityY: 600,
      scale: { start: 1.6, end: 0 },
      lifespan: { min: 600, max: 1400 },
      quantity: 90,
      tint: [0x5FC9A8, 0xF2B84B, 0xFFFFFF, 0xFFE29A],
      emitting: false,
    }).explode(90);
    this.add.text(W / 2, 150, '💸 DEBT CLEARED — NO MORE INTEREST!', {
      fontFamily: '"Baloo 2"', fontSize: '30px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(12);
    this.time.delayedCall(2600, () => {
      if (this.scene.isActive()) this.toOverview();
    });
  }

  private redrawMountain(): void {
    const d = store.debts[this.debtIdx];
    if (this.mountain) {
      this.mountain.container.destroy();
      this.mountain = drawMountain(this, d);
      this.mountain.container.setDepth(0);
    }
    // ball resized as the snowball grows
    const r = ballRadius(d);
    this.ballImg.setDisplaySize(r * 2.2, r * 2.2);
    const pos = pointAt(d, d.progress);
    this.ballC.setPosition(pos.x, pos.y);
    this.shadow.setPosition(pos.x, pos.y + r * 0.9);
  }

  /* ---------- per-frame ---------- */
  update(_time: number, delta: number): void {
    const d = store.debts[this.debtIdx];
    if (!d) return;
    if (this.meterActive) this.meterUpdate(delta);
    if (!this.busy) this.applyDrift(delta);
    // swirl animation
    if (this.mountain) drawSwirl(this.mountain.swirl, PIT_POS.x, PIT_POS.y + 14, this.time.now / 900);
    // ball follows the slope (unless a push tween is driving it)
    if (!this.busy) {
      const pos = pointAt(d, d.progress);
      this.ballC.setPosition(pos.x, pos.y);
      this.shadow.setPosition(pos.x, pos.y + ballRadius(d) * 0.9);
    }
  }

  private applyDrift(dt: number): void {
    const d = store.debts[this.debtIdx];
    if (!d) return;
    const before = d.progress;
    d.progress = Math.max(-PIT, d.progress - (driftPerSec(d, d.progress) / 100) * (dt / 1000));
    const now = this.time.now;
    if (d.progress !== before) {
      if (now - this.lastSave > 1000) { this.lastSave = now; store.save(); }
    }
    if (d.progress <= -PIT && before > -PIT) sfx.land();
  }

  private toOverview(): void {
    this.scene.start('Overview');
  }

  private emitHud(): void {
    const total = store.debts.reduce((a, x) => a + x.balance, 0);
    const paid = store.debts.reduce((a, x) => a + x.paid, 0);
    bus.emit('hud', {
      left: store.debts.reduce((a, x) => a + principalLeft(x), 0),
      pct: total > 0 ? paid / total : 0,
      combo: combo.count,
      mult: comboMult(),
      interest: 0, // handled by stats below
    });
  }
}

/* re-export for the debug/E2E hook */
export type { MeterStop };
