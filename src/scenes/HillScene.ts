/* ============================================================
   Hill — the rolling scene. ONE hill per debt: the snowball
   starts at the crest (0% paid) and rolls down the flank to the
   payoff flag (100% = debt cleared). Position = % of the
   original balance paid, 1:1 and honest. Payments permanently
   grow the ball; a bigger ball rolls faster — speed is a pure
   function of size, light APR friction and debt length. That
   growing speed is the whole reward: no combo, no timing
   minigame. The ball simply sits between payments — no decay,
   no drift, no streak pressure.
   ============================================================ */
import Phaser from 'phaser';
import {
  store, applyPush, prefs, setPrefs, pctPaid, principalLeft, monthsLeft,
  money, ballRadius, ballRadiusAt, ballMult, ballLabel, rollSpeed,
} from '../core/state';
import {
  drawHill, pointAt, ballPosAt, FLAG, START, type HillRef,
} from '../core/hillRender';
import { ensureGameTextures } from '../core/textures';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const CHIPS = [15, 50, 100, 250, 500, 1000, 2500, 5000];

export class HillScene extends Phaser.Scene {
  private debtIdx = 0;
  private chip = 100;

  /** public accessor for tests/debug */
  get debt() { return store.debts[this.debtIdx]; }

  private hill!: HillRef;
  private ballC!: Phaser.GameObjects.Container;
  private ballImg!: Phaser.GameObjects.Image;
  private eyes!: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hudInfo!: Phaser.GameObjects.Text;
  private hudBall!: Phaser.GameObjects.Text;
  private chipBtns: Phaser.GameObjects.Container[] = [];
  private payBtn!: Phaser.GameObjects.Container;
  private payLbl!: Phaser.GameObjects.Text;
  private backBtn!: Phaser.GameObjects.Container;
  private hintText!: Phaser.GameObjects.Text;

  private busy = false;   // roll animation running

  constructor() { super('Hill'); }

  init(data: { idx: number }): void {
    this.debtIdx = data.idx;
    this.chip = prefs.chip;
    this.busy = false;
  }

  create(): void {
    const d = store.debts[this.debtIdx];
    if (!d) { this.scene.start('Overview'); return; }
    this.input.enabled = true;
    ensureGameTextures(this);
    (window as any).__hill = this;
    (window as any).__hillMath = { rollSpeed, ballMult, ballRadiusAt, pctPaid, pointAt, ballPosAt };


    this.drawHillAndBall();
    this.drawHud();
    this.drawChips();
    this.drawPayButton();
    this.drawBackButton();
    this.refreshHud();
    this.emitHud();

    // Space = pay (desktop), ESC = back
    this.input.keyboard!.on('keydown-SPACE', () => this.pay());
    this.input.keyboard!.on('keydown-ESC', () => { if (!this.busy) this.toOverview(); });
  }

  shutdown(): void {
    this.input.keyboard!.off('keydown-SPACE');
    this.input.keyboard!.off('keydown-ESC');
  }

  /* ---------- scene drawing ---------- */
  private drawHillAndBall(): void {
    const d = this.debt;
    this.hill = drawHill(this, d);
    this.hill.container.setDepth(0);

    // ball — starts at the crest (base geometry drawn at 14px, scaled to actual size)
    const r = ballRadius(d);
    const pos = pointAt(pctPaid(d));
    this.ballImg = this.add.image(0, 0, 'snowball').setDisplaySize(r * 2.2, r * 2.2);
    this.eyes = this.add.container(0, 0);
    const eyeG = this.add.graphics();
    eyeG.fillStyle(0x16283D, 1);
    eyeG.fillCircle(-14 * 0.3, -14 * 0.05, 14 * 0.09);
    eyeG.fillCircle(14 * 0.3, -14 * 0.05, 14 * 0.09);
    eyeG.fillStyle(0xFFFFFF, 1);
    eyeG.fillCircle(-14 * 0.34, -14 * 0.09, 14 * 0.035);
    eyeG.fillCircle(14 * 0.26, -14 * 0.09, 14 * 0.035);
    this.eyes.add(eyeG);
    this.ballC = this.add.container(pos.x, pos.y, [this.ballImg, this.eyes]);
    this.ballC.setDepth(4);
    this.shadow = this.add.ellipse(0, 0, 14 * 1.8, 14 * 0.45, 0x0B1524, 0.3);
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
    this.setBallAt(pctPaid(d));
  }

  /** set ball visuals for a given progress value (size grows with % paid) */
  private setBallAt(p: number): { x: number; y: number } {
    const r = ballRadiusAt(p);
    const pos = ballPosAt(p, r);
    this.ballC.setPosition(pos.x, pos.y);
    this.ballImg.setDisplaySize(r * 2.2, r * 2.2);
    this.eyes.setScale(r / 14);
    this.shadow.setPosition(pos.x, pos.y + r * 0.85);
    this.shadow.setScale(r / 14, 1);
    return pos;
  }

  /** public for tests/debug: re-render ball + HUD from current store state */
  sync(): void {
    if (this.ballC) this.setBallAt(pctPaid(this.debt));
    this.refreshHud();
  }

  /** redraw the whole hill (used when a debt clears — flags out, payoff turns green) */
  private redrawHill(): void {
    if (this.hill) {
      this.hill.container.destroy();
      this.hill = drawHill(this, this.debt);
      this.hill.container.setDepth(0);
    }
    this.setBallAt(pctPaid(this.debt));
  }

  private drawHud(): void {
    this.hudInfo = this.add.text(20, 16, '', {
      fontFamily: '"Baloo 2"', fontSize: '16px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 5,
    }).setDepth(10);
    this.hudBall = this.add.text(W - 20, 16, '', {
      fontFamily: '"JetBrains Mono"', fontSize: '13px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(1, 0).setDepth(10);
    this.hintText = this.add.text(W / 2, H - 24, '', {
      fontFamily: '"Manrope"', fontSize: '12px', color: '#9FB2C4',
    }).setOrigin(0.5).setDepth(10);
    this.refreshHud();
  }

  private refreshHud(): void {
    const d = this.debt;
    if (!d) return;
    const pct = Math.round(pctPaid(d) * 100);
    this.hudInfo.setText(
      `${d.name} — ${money(principalLeft(d))} left · APR ${d.apr}% · ${monthsLeft(d)}mo · ${pct}% cleared`,
    );
    this.hudBall.setText(`❄️ ball ${ballLabel(d)} ×${ballMult(d).toFixed(1)}`);
    this.hintText.setText(
      'Each payment grows your ball and rolls it down the hill — bigger ball, faster roll. APR adds a little hill drag.',
    );
  }

  /* ---------- chip selector ---------- */
  private drawChips(): void {
    this.add.text(W / 2, H - 152, 'PAYMENT PER ROLL', {
      fontFamily: '"JetBrains Mono"', fontSize: '10px', color: '#9FB2C4',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
    CHIPS.forEach((v, i) => {
      const active = this.chip === v;
      const x = W / 2 - 343 + i * 98;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0x5FC9A8 : 0x1E3350, active ? 1 : 0.92);
      bg.fillRoundedRect(-44, -17, 88, 34, 17);
      if (!active) {
        bg.lineStyle(1.5, 0xFFFFFF, 0.22);
        bg.strokeRoundedRect(-44, -17, 88, 34, 17);
      }
      const label = this.add.text(0, 0, '£' + v, {
        fontFamily: '"Baloo 2"', fontSize: '15px',
        color: active ? '#10241C' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, H - 108, [bg, label]);
      c.setSize(88, 34).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        if (this.busy) return;
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
    const y = H - 52;
    const g = this.add.graphics();
    g.fillStyle(0x5FC9A8, 1);
    g.fillRoundedRect(-92, -24, 184, 48, 24);
    g.fillStyle(0xFFFFFF, 0.25);
    g.fillRoundedRect(-84, -19, 168, 11, 5.5);
    this.payLbl = this.add.text(0, 0, `PAY £${this.chip} ❄️`, {
      fontFamily: '"Baloo 2"', fontSize: '18px', color: '#10241C', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.payBtn = this.add.container(x, y, [g, this.payLbl]);
    this.payBtn.setSize(184, 48).setInteractive({ useHandCursor: true });
    this.payBtn.on('pointerdown', () => this.pay());
    this.payBtn.setDepth(10);
  }

  private drawBackButton(): void {
    const g = this.add.graphics();
    g.fillStyle(0xFFFFFF, 0.12);
    g.fillRoundedRect(-46, -18, 92, 36, 18);
    const label = this.add.text(0, 0, '❄️ Range', {
      fontFamily: '"Baloo 2"', fontSize: '14px', color: '#F4F8FB',
    }).setOrigin(0.5);
    this.backBtn = this.add.container(64, 42, [g, label]);
    this.backBtn.setSize(92, 36).setInteractive({ useHandCursor: true });
    this.backBtn.on('pointerdown', () => { if (!this.busy) this.toOverview(); });
    this.backBtn.setDepth(10);
  }

  /* ---------- payment ---------- */
  /** public for E2E: pay the selected chip immediately */
  pay(): void {
    const d = this.debt;
    if (!d || this.busy || pctPaid(d) >= 1) return;
    this.busy = true;
    const o = applyPush(this.debtIdx, this.chip);
    if (o.amount <= 0) { this.busy = false; return; }
    sfx.chip();
    sfx.roll();

    // the roll: from old position to new, at a speed set by the
    // ball's (new, bigger) size — bigger ball covers ground quicker.
    const p0 = ballPosAt(o.pctBefore, ballRadiusAt(o.pctBefore));
    const p1 = ballPosAt(o.pctAfter, ballRadiusAt(o.pctAfter));
    const distPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const speed = rollSpeed(d);
    const dur = Phaser.Math.Clamp((distPx / speed) * 1000, 250, 2400);
    this.setBallAt(o.pctBefore);
    this.tweens.addCounter({
      from: 0, to: 1, duration: dur, ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const p = Phaser.Math.Linear(o.pctBefore, o.pctAfter, k);
        const pos = this.setBallAt(p);
        this.trail.emitParticleAt(pos.x, pos.y + ballRadiusAt(p) * 0.4, ballMult(d) > 1.4 ? 3 : 1);
        this.ballImg.rotation += (distPx / Math.max(5, ballRadiusAt(p))) * 0.16 * k;
      },
      onComplete: () => {
        this.busy = false;
        this.afterPush(o);
      },
    });
    this.refreshHud();
  }

  private afterPush(o: import('../core/state').PushOutcome): void {
    this.refreshHud();

    if (!o.cleared) {
      // readout — honest numbers, kept separate. Fixed panel at top-centre,
      // never overlaps the hill or the ball. (On clear the celebration carries it.)
      const lines: { text: string; color: string; size: number }[] = [
        { text: `${money(o.amount)} principal — +${o.basePct.toFixed(2)}% down the hill`, color: '#5FC9A8', size: 16 },
        { text: `💸 ${money(o.interest)} interest avoided`, color: '#5FC9A8', size: 14 },
      ];
      const panelY = 108;
      const panelW = 440;
      const panelH = 18 + lines.length * 26;
      const bg = this.add.graphics();
      bg.fillStyle(0x0F1A2E, 0.78);
      bg.fillRoundedRect(W / 2 - panelW / 2, panelY - 12, panelW, panelH, 14);
      bg.lineStyle(1.5, 0xFFFFFF, 0.14);
      bg.strokeRoundedRect(W / 2 - panelW / 2, panelY - 12, panelW, panelH, 14);
      const group = this.add.container(0, 0, [bg]);
      group.setDepth(9);
      lines.forEach((l, i) => {
        const t = this.add.text(W / 2, panelY + i * 26, l.text, {
          fontFamily: '"Baloo 2"', fontSize: `${l.size}px`, color: l.color,
          stroke: '#0F1A2E', strokeThickness: 4,
        }).setOrigin(0.5, 0).setDepth(10);
        group.add(t);
      });
      this.tweens.add({
        targets: group, alpha: 0, y: -18, duration: 1400, delay: 1800,
        onComplete: () => group.destroy(),
      });
    }

    // milestone / clear celebrations
    if (o.milestone) this.milestoneBeat(o.milestone);
    if (o.cleared) {
      this.redrawHill();   // flags out, payoff flag green
      this.clearCelebration();
    }

    if (o.milestone || o.cleared) {
      this.time.timeScale = 0.35;
      window.setTimeout(() => { this.time.timeScale = 1; }, 550);
    }
    this.emitHud();
  }

  private milestoneBeat(milestone: number): void {
    const pos = pointAt(milestone / 100);
    this.cameras.main.shake(300, 0.012);
    this.cameras.main.flash(90, 255, 226, 154);
    sfx.milestone();
    this.add.particles(pos.x, pos.y - 10, 'pix', {
      speed: { min: 80, max: 320 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      lifespan: { min: 400, max: 900 },
      quantity: 42,
      tint: [0xF2B84B, 0xFFE29A, 0xFFFFFF],
      emitting: false,
    }).explode(42);
    const banner = this.add.text(W / 2, 496, `${milestone}% MILESTONE`, {
      fontFamily: '"Baloo 2"', fontSize: '26px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: banner, scale: 1.15, alpha: 0, duration: 1400, delay: 700, onComplete: () => banner.destroy() });
  }

  private clearCelebration(): void {
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
    this.add.text(W / 2, 180, '💸 DEBT CLEARED — NO MORE INTEREST!', {
      fontFamily: '"Baloo 2"', fontSize: '30px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(12);
    // wall-clock timeout: slow-mo scales game time, so use real time for the return
    window.setTimeout(() => {
      if (this.scene.isActive()) this.toOverview();
    }, 2600);
  }

  private toOverview(): void {
    this.scene.start('Overview');
  }

  private emitHud(): void {
    const d = this.debt;
    const total = store.debts.reduce((a, x) => a + x.balance, 0);
    const paid = store.debts.reduce((a, x) => a + x.paid, 0);
    bus.emit('hud', {
      left: store.debts.reduce((a, x) => a + principalLeft(x), 0),
      pct: total > 0 ? paid / total : 0,
      ball: d ? { mult: ballMult(d), label: ballLabel(d) } : null,
      interest: 0, // handled by stats below
    });
  }
}
