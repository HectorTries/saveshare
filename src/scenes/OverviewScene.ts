/* ============================================================
   Overview — the range. Every debt is one mini-slope in a skyline
   (horizontal on landscape, stacked on portrait). Tap one to roll.
   Strategy toggle is pure guidance (highlight only).
   ============================================================ */
import Phaser from 'phaser';
import {
  store, principalLeft, pctPaid, prefs, setPrefs,
  stats, money, type Strategy,
} from '../core/state';
import { drawMiniHill, setHillSize } from '../core/hillRender';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

export class OverviewScene extends Phaser.Scene {
  private busy = false;
  private stratBtns: Phaser.GameObjects.Container[] = [];
  private W = 1280;
  private H = 640;

  constructor() { super('Overview'); }

  create(): void {
    this.busy = false;
    this.stratBtns = [];
    this.W = this.scale.width;
    this.H = this.scale.height;
    setHillSize(this.W, this.H);
    this.input.enabled = true;
    this.scene.bringToTop();
    bus.on('start', this.onStart, this);

    this.drawSkyline();
    this.drawStrategyToggle();
    this.drawBadges();
    this.emitHud();
    (window as any).__overview = this;
    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    bus.off('start', this.onStart, this);
    this.scale.off('resize', this.onResize, this);
  }

  private onStart(): void { this.scene.restart(); }

  private onResize(): void {
    const w = this.scale.width, h = this.scale.height;
    if (Math.abs(w - this.W) < 2 && Math.abs(h - this.H) < 2) return;
    this.scene.restart();
  }

  private drawSkyline(): void {
    const debts = store.debts;
    if (!debts.length) return;
    const n = debts.length;
    const portrait = this.H > this.W;

    if (portrait) {
      // stacked vertically — one row per debt
      const rowH = 120;
      const startY = this.H * 0.20;
      const w = Math.min(200, this.W * 0.55);
      debts.forEach((d, i) => {
        const y = startY + i * rowH;
        const m = drawMiniHill(this, this.W / 2, y, w, d, i);
        const zone = m.getAt(m.length - 1) as Phaser.GameObjects.Zone;
        zone.on('pointerdown', () => this.play(i));
        if (this.suggestFor(i)) this.drawSuggest(this.W / 2, y - 40, w + 50, 80);
      });
    } else {
      const spacing = Math.min(290, (this.W - 60) / Math.max(n, 1));
      const x0 = this.W / 2 - (spacing * (n - 1)) / 2;
      const baseY = this.H * 0.80;
      const w = Math.min(150, spacing - 30);
      debts.forEach((d, i) => {
        const m = drawMiniHill(this, x0 + i * spacing, baseY, w, d, i);
        const zone = m.getAt(m.length - 1) as Phaser.GameObjects.Zone;
        zone.on('pointerdown', () => this.play(i));
        if (this.suggestFor(i)) this.drawSuggest(x0 + i * spacing, baseY - 150, w + 40, 180);
      });
    }

    const allPaid = debts.every((d) => pctPaid(d) >= 1);
    this.add.text(this.W / 2, 60, allPaid ? '🎉 Every hill cleared — incredible.' : 'Tap a hill to roll ❄️', {
      fontFamily: '"Baloo 2"', fontSize: this.W < 600 ? '14px' : '18px', color: '#F4F8FB',
    }).setOrigin(0.5).setAlpha(0.92);
  }

  private drawSuggest(x: number, y: number, w: number, h: number): void {
    const g = this.add.graphics();
    g.lineStyle(4, 0xF2B84B, 0.9);
    g.strokeRoundedRect(x - w / 2, y, w, h, 18);
    g.lineStyle(2, 0xFFE29A, 0.4);
    g.strokeRoundedRect(x - w / 2 - 4, y - 4, w + 8, h + 8, 20);
    const arrow = this.add.text(x, y - 8, '▼', {
      fontFamily: '"Baloo 2"', fontSize: '18px', color: '#F2B84B',
    }).setOrigin(0.5);
    this.tweens.add({ targets: arrow, y: y - 14, duration: 500, yoyo: true, repeat: -1 });
    arrow.setDepth(5);
  }

  private suggestFor(i: number): boolean {
    const d = store.debts[i];
    if (!d || pctPaid(d) >= 1) return false;
    if (prefs.strategy === 'snowball') {
      const min = Math.min(...store.debts.map((x) => principalLeft(x)));
      return principalLeft(d) === min;
    }
    if (prefs.strategy === 'avalanche') {
      const max = Math.max(...store.debts.map((x) => x.apr));
      return d.apr === max;
    }
    return false;
  }

  private play(i: number): void {
    if (this.busy) return;
    const d = store.debts[i];
    if (!d || pctPaid(d) >= 1) return;
    sfx.select();
    this.scene.start('Hill', { idx: i });
  }

  private drawStrategyToggle(): void {
    const strategies: { key: Strategy; label: string; tip: string }[] = [
      { key: 'none', label: '🎯 Free', tip: 'no suggestion' },
      { key: 'snowball', label: '❄️ Snowball', tip: 'smallest balance' },
      { key: 'avalanche', label: '⛰ Avalanche', tip: 'highest APR' },
    ];
    const span = Math.min(190, (this.W - 40) / 3);
    strategies.forEach((s, i) => {
      const x = this.W / 2 - span + i * span;
      const active = prefs.strategy === s.key;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0xF2B84B : 0xFFFFFF, active ? 1 : 0.1);
      bg.fillRoundedRect(-span / 2 + 8, -16, span - 16, 32, 16);
      const label = this.add.text(0, 0, s.label, {
        fontFamily: '"Baloo 2"', fontSize: this.W < 600 ? '12px' : '14px',
        color: active ? '#16283D' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, 38, [bg, label]);
      c.setSize(span - 16, 32).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        sfx.select();
        setPrefs(prefs.chip, s.key);
        this.scene.restart();
      });
      this.stratBtns.push(c);
    });
  }

  private drawBadges(): void {
    this.add.text(16, this.H - 12, `💸 ${money(stats.interestDestroyed)} interest avoided (lifetime)`, {
      fontFamily: '"JetBrains Mono"', fontSize: '11px', color: '#5FC9A8',
      stroke: '#0F1A2E', strokeThickness: 3,
    }).setOrigin(0, 1).setDepth(10);
  }

  private emitHud(): void {
    const total = store.debts.reduce((a, d) => a + d.balance, 0);
    const paid = store.debts.reduce((a, d) => a + d.paid, 0);
    bus.emit('hud', {
      left: store.debts.reduce((a, d) => a + principalLeft(d), 0),
      pct: total > 0 ? paid / total : 0,
      ball: null,
      interest: stats.interestDestroyed,
    });
  }
}
