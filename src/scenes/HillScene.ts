/* ============================================================
   Level Runner — responsive. Each debt = 100 levels. Each LEVEL
   is its own screen: a single downhill slope. Clear it and the
   loop flows into the next level's slope. Layout adapts to the
   game size (portrait or landscape).
   ============================================================ */
import Phaser from 'phaser';
import {
  store, applyPush, prefs, setPrefs, pctPaid, principalLeft, monthsLeft,
  money, ballRadius, ballMult, ballLabel, levelValue, levelProgress,
  levelsCleared, LEVELS, levelLabel,
} from '../core/state';
import { drawHill, ballPosAt, setHillSize, FLAG, type HillRef } from '../core/hillRender';
import { ensureGameTextures } from '../core/textures';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const CHIPS = [15, 50, 100, 250, 500, 1000, 2500, 5000];

export class HillScene extends Phaser.Scene {
  private debtIdx = 0;
  private chip = 100;
  private W = 1280;
  private H = 640;

  get debt() { return store.debts[this.debtIdx]; }

  private hill!: HillRef;
  private ballC!: Phaser.GameObjects.Container;
  private ballImg!: Phaser.GameObjects.Image;
  private eyes!: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hudInfo!: Phaser.GameObjects.Text;
  private hudBall!: Phaser.GameObjects.Text;
  private hudLevel!: Phaser.GameObjects.Text;
  private hudLevelSub!: Phaser.GameObjects.Text;
  private chipBtns: Phaser.GameObjects.Container[] = [];
  private payBtn!: Phaser.GameObjects.Container;
  private payLbl!: Phaser.GameObjects.Text;
  private backBtn!: Phaser.GameObjects.Container;
  private hintText!: Phaser.GameObjects.Text;

  private busy = false;
  private levelSfxPlayed = false;

  constructor() { super('Hill'); }

  init(data: { idx: number }): void {
    this.debtIdx = data.idx;
    this.chip = prefs.chip;
    this.busy = false;
  }

  create(): void {
    const d = store.debts[this.debtIdx];
    if (!d) { this.scene.start('Overview'); return; }
    this.W = this.scale.width;
    this.H = this.scale.height;
    setHillSize(this.W, this.H);
    this.input.enabled = true;
    ensureGameTextures(this);
    (window as any).__hill = this;
    (window as any).__hillMath = {
      levelValue, levelProgress, levelsCleared, LEVELS, pctPaid, ballRadius, ballPosAt,
    };

    this.drawHillAndBall();
    this.drawHud();
    this.drawChips();
    this.drawPayButton();
    this.drawBackButton();
    this.refreshHud();
    this.emitHud();

    this.input.keyboard!.on('keydown-SPACE', () => this.pay());
    this.input.keyboard!.on('keydown-ESC', () => { if (!this.busy) this.toOverview(); });
    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.input.keyboard!.off('keydown-SPACE');
    this.input.keyboard!.off('keydown-ESC');
    this.scale.off('resize', this.onResize, this);
  }

  private onResize(): void {
    const w = this.scale.width, h = this.scale.height;
    if (Math.abs(w - this.W) < 2 && Math.abs(h - this.H) < 2) return;
    this.scene.restart({ idx: this.debtIdx });
  }

  private fracNow(): number {
    const prog = levelProgress(this.debt);
    const lv = Math.floor(prog + 1e-9);
    return Math.max(0, Math.min(1, prog - lv));
  }

  private drawHillAndBall(): void {
    const d = this.debt;
    this.hill = drawHill(this, d);
    this.hill.container.setDepth(0);

    const r = ballRadius(d);
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
    this.ballC = this.add.container(0, 0, [this.ballImg, this.eyes]);
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
    this.setBallAt(this.fracNow());
  }

  private setBallAt(frac: number): { x: number; y: number } {
    const r = ballRadius(this.debt);
    const pos = ballPosAt(frac, r);
    this.ballC.setPosition(pos.x, pos.y);
    this.ballImg.setDisplaySize(r * 2.2, r * 2.2);
    this.eyes.setScale(r / 14);
    this.shadow.setPosition(pos.x, pos.y + r * 0.85);
    this.shadow.setScale(r / 14, 1);
    return pos;
  }

  sync(): void {
    if (this.ballC) this.setBallAt(this.fracNow());
    this.refreshHud();
  }

  private redrawHill(): void {
    if (this.hill) { this.hill.container.destroy(); }
    this.hill = drawHill(this, this.debt);
    this.hill.container.setDepth(0);
    this.setBallAt(this.fracNow());
  }

  private levelText(cleared: number): string {
    if (pctPaid(this.debt) >= 1 && cleared >= LEVELS) return 'DEBT CLEARED 🎉';
    return `LEVEL ${Math.min(cleared + 1, LEVELS)} / ${LEVELS}`;
  }

  private drawHud(): void {
    const topY = 14;
    const small = this.W < 600;
    this.hudInfo = this.add.text(16, topY, '', {
      fontFamily: '"Baloo 2"', fontSize: small ? '14px' : '16px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 5,
    }).setDepth(10);
    this.hudBall = this.add.text(this.W - 16, topY, '', {
      fontFamily: '"JetBrains Mono"', fontSize: small ? '11px' : '13px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(1, 0).setDepth(10);
    this.hudLevel = this.add.text(this.W / 2, topY, '', {
      fontFamily: '"Baloo 2"', fontSize: small ? '24px' : '30px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(10);
    this.hudLevelSub = this.add.text(this.W / 2, topY + (small ? 34 : 44), '', {
      fontFamily: '"JetBrains Mono"', fontSize: small ? '10px' : '12px', color: '#B7C7D6',
      stroke: '#0F1A2E', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(10);
    this.hintText = this.add.text(this.W / 2, this.H - 26, '', {
      fontFamily: '"Manrope"', fontSize: '12px', color: '#9FB2C4',
    }).setOrigin(0.5).setDepth(10);
    this.refreshHud();
  }

  private refreshHud(): void {
    const d = this.debt;
    if (!d) return;
    const lv = levelsCleared(d);
    this.hudInfo.setText(d.name);
    this.hudBall.setText(`❄️ ${ballLabel(d)} ×${ballMult(d).toFixed(1)}`);
    this.hudLevel.setText(this.levelText(lv));
    this.hudLevelSub.setText(
      `${levelLabel(d)}/level · APR ${d.apr}% · ${money(principalLeft(d))} left · ${lv}/100 done`,
    );
    this.hintText.setText('Every level is 1% of the debt — roll the slope, clear it, next screen.');
  }

  private drawChips(): void {
    const d = this.debt;
    this.add.text(this.W / 2, this.H - 154, 'PAYMENT PER ROLL', {
      fontFamily: '"JetBrains Mono"', fontSize: '10px', color: '#9FB2C4',
      stroke: '#0F1A2E', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
    if (d && d.monthly > 0) {
      this.add.text(this.W / 2, this.H - 138, `your monthly ≈ £${d.monthly} — pay any amount`, {
        fontFamily: '"Manrope"', fontSize: '11px', color: '#B7C7D6',
      }).setOrigin(0.5).setDepth(10);
    }
    const chips = CHIPS;
    const n = chips.length;
    const spacing = Math.min(98, (this.W - 40) / n);
    const cw = Math.min(88, spacing - 8);
    chips.forEach((v, i) => {
      const active = this.chip === v;
      const x = this.W / 2 - (n - 1) * spacing / 2 + i * spacing;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0x5FC9A8 : 0x1E3350, active ? 1 : 0.92);
      bg.fillRoundedRect(-cw / 2, -17, cw, 34, 17);
      if (!active) {
        bg.lineStyle(1.5, 0xFFFFFF, 0.22);
        bg.strokeRoundedRect(-cw / 2, -17, cw, 34, 17);
      }
      const label = this.add.text(0, 0, '£' + v, {
        fontFamily: '"Baloo 2"', fontSize: cw < 60 ? '13px' : '15px',
        color: active ? '#10241C' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, this.H - 108, [bg, label]);
      c.setSize(cw, 34).setInteractive({ useHandCursor: true });
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

  private drawPayButton(): void {
    const x = this.W / 2, y = this.H - 52;
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

  pay(): void {
    const d = this.debt;
    if (!d || this.busy || pctPaid(d) >= 1) return;
    this.busy = true;
    const o = applyPush(this.debtIdx, this.chip);
    if (o.amount <= 0) { this.busy = false; return; }
    sfx.chip();
    sfx.roll();

    const before = o.pctBefore * LEVELS;
    const after = o.pctAfter * LEVELS;
    const dist = after - before;
    const dur = Phaser.Math.Clamp(dist * 820, 500, 7000);

    let lastLevel = o.levelsBefore;
    let sfxPlayed = false;

    this.tweens.addCounter({
      from: before, to: after, duration: dur, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const prog = tw.getValue() ?? before;
        const lv = Math.floor(prog + 1e-9);
        const frac = prog - lv;
        const pos = this.setBallAt(frac);
        this.trail.emitParticleAt(pos.x, pos.y + ballRadius(d) * 0.4, 1);
        this.ballImg.rotation += 0.16;
        if (lv > lastLevel) {
          for (let L = lastLevel + 1; L <= lv; L++) this.levelBeat(L);
          lastLevel = lv;
          if (!sfxPlayed) { sfxPlayed = true; sfx.level(o.levelsCrossed); }
        }
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
      const lines: { text: string; color: string; size: number }[] = [
        { text: `${money(o.amount)} principal — ${o.levelsCrossed > 0 ? `+${o.levelsCrossed} level${o.levelsCrossed === 1 ? '' : 's'}` : 'partial level'}`, color: '#5FC9A8', size: 16 },
        { text: `💸 ${money(o.interest)} interest avoided`, color: '#5FC9A8', size: 14 },
      ];
      const panelY = 100;
      const panelW = Math.min(460, this.W - 40);
      const panelH = 18 + lines.length * 26;
      const bg = this.add.graphics();
      bg.fillStyle(0x0F1A2E, 0.78);
      bg.fillRoundedRect(this.W / 2 - panelW / 2, panelY - 12, panelW, panelH, 14);
      bg.lineStyle(1.5, 0xFFFFFF, 0.14);
      bg.strokeRoundedRect(this.W / 2 - panelW / 2, panelY - 12, panelW, panelH, 14);
      const group = this.add.container(0, 0, [bg]);
      group.setDepth(9);
      lines.forEach((l, i) => {
        const t = this.add.text(this.W / 2, panelY + i * 26, l.text, {
          fontFamily: '"Baloo 2"', fontSize: `${l.size}px`, color: l.color,
          stroke: '#0F1A2E', strokeThickness: 4,
        }).setOrigin(0.5, 0).setDepth(10);
        group.add(t);
      });
      this.tweens.add({
        targets: group, alpha: 0, y: -18, duration: 1300, delay: 1700,
        onComplete: () => group.destroy(),
      });
    }

    if (o.cleared) {
      this.redrawHill();
      this.clearCelebration();
    }
    this.emitHud();
  }

  private levelBeat(clearedLevel: number): void {
    this.hudLevel.setText(this.levelText(clearedLevel));
    this.hudLevel.setScale(1.18);
    this.tweens.add({ targets: this.hudLevel, scale: 1, duration: 160, ease: 'Back.easeOut' });

    const t = this.add.text(this.W / 2, this.H * 0.30, `LEVEL ${clearedLevel}`, {
      fontFamily: '"Baloo 2"', fontSize: '30px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: this.H * 0.30 - 28, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });

    if (clearedLevel % 25 === 0 && clearedLevel < LEVELS) this.milestoneBeat(clearedLevel);
  }

  private milestoneBeat(level: number): void {
    this.cameras.main.shake(300, 0.012);
    this.cameras.main.flash(90, 255, 226, 154);
    sfx.milestone();
    this.add.particles(this.W / 2, this.H * 0.4, 'pix', {
      speed: { min: 80, max: 320 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      lifespan: { min: 400, max: 900 },
      quantity: 40,
      tint: [0xF2B84B, 0xFFE29A, 0xFFFFFF],
      emitting: false,
    }).explode(40);
    const banner = this.add.text(this.W / 2, this.H * 0.42, `${level}% MILESTONE`, {
      fontFamily: '"Baloo 2"', fontSize: '24px', color: '#F2B84B',
      stroke: '#0F1A2E', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: banner, scale: 1.15, alpha: 0, duration: 1300, delay: 500, onComplete: () => banner.destroy() });
  }

  private clearCelebration(): void {
    this.cameras.main.shake(600, 0.02);
    sfx.win();
    const aurora = document.getElementById('aurora');
    if (aurora) { aurora.classList.add('strong'); window.setTimeout(() => aurora.classList.remove('strong'), 2600); }
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
    this.add.text(this.W / 2, 170, '💸 DEBT CLEARED — NO MORE INTEREST!', {
      fontFamily: '"Baloo 2"', fontSize: this.W < 600 ? '22px' : '30px', color: '#F4F8FB',
      stroke: '#0F1A2E', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(12);
    window.setTimeout(() => { if (this.scene.isActive()) this.toOverview(); }, 2600);
  }

  update(_time: number, delta: number): void {
    const d = this.debt;
    if (!d || !this.ballImg) return;
    if (!this.busy) {
      this.ballImg.rotation += (0.9 + ballMult(d) * 0.45) * (delta / 1000);
    }
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
      interest: 0,
    });
  }
}
