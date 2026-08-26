/* ============================================================
   Overview — the range. Every debt is one white hill in a
   skyline; the ball marker sits at its current position on each
   flank. Tap a hill to roll it. Strategy toggle is pure
   guidance (highlight only, no mechanical bonus).
   ============================================================ */
import Phaser from 'phaser';
import {
  store, principalLeft, pctPaid, prefs, setPrefs,
  stats, money, type Strategy,
} from '../core/state';
import { drawMiniHill } from '../core/hillRender';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const BASE_Y = 505;

export class OverviewScene extends Phaser.Scene {
  private busy = false;
  private stratBtns: Phaser.GameObjects.Container[] = [];

  constructor() { super('Overview'); }

  create(): void {
    this.busy = false;
    this.stratBtns = [];
    this.input.enabled = true;
    this.scene.bringToTop();
    bus.on('start', this.onStart, this);

    this.drawSkyline();
    this.drawStrategyToggle();
    this.drawBadges();
    this.emitHud();
    (window as any).__overview = this;
  }

  shutdown(): void {
    bus.off('start', this.onStart, this);
  }

  private onStart(): void {
    this.scene.restart();
  }

  /* ---------- skyline ---------- */
  private drawSkyline(): void {
    const debts = store.debts;
    if (!debts.length) return;
    const spacing = Math.min(290, 1050 / Math.max(debts.length, 1));
    const x0 = W / 2 - (spacing * (debts.length - 1)) / 2;

    debts.forEach((d, i) => {
      const m = drawMiniHill(this, x0 + i * spacing, BASE_Y, 150, d, i);
      const zone = m.getAt(m.length - 1) as Phaser.GameObjects.Zone;
      zone.on('pointerdown', () => this.play(i));
      if (this.suggestFor(i)) {
        const g = this.add.graphics();
        g.lineStyle(4, 0xF2B84B, 0.9);
        g.strokeRoundedRect(x0 + i * spacing - 78, BASE_Y - 175, 156, 200, 18);
        g.lineStyle(2, 0xFFE29A, 0.4);
        g.strokeRoundedRect(x0 + i * spacing - 82, BASE_Y - 179, 164, 208, 20);
        const arrow = this.add.text(x0 + i * spacing, BASE_Y - 190, '▼', {
          fontFamily: '"Baloo 2"', fontSize: '18px', color: '#F2B84B',
        }).setOrigin(0.5);
        this.tweens.add({ targets: arrow, y: BASE_Y - 196, duration: 500, yoyo: true, repeat: -1 });
        arrow.setDepth(5);
      }
    });

    const allPaid = debts.every((d) => pctPaid(d) >= 1);
    this.add.text(W / 2, 92, allPaid ? '🎉 Every hill cleared — incredible.' : 'Tap a hill, roll your payment down it ❄️', {
      fontFamily: '"Baloo 2"', fontSize: '20px', color: '#F4F8FB',
    }).setOrigin(0.5).setAlpha(0.92);
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

  /* ---------- strategy toggle (guidance only) ---------- */
  private drawStrategyToggle(): void {
    const strategies: { key: Strategy; label: string; tip: string }[] = [
      { key: 'none', label: '🎯 Free choice', tip: 'no suggestion' },
      { key: 'snowball', label: '❄️ Snowball', tip: 'smallest balance' },
      { key: 'avalanche', label: '⛰ Avalanche', tip: 'highest APR' },
    ];
    strategies.forEach((s, i) => {
      const x = W / 2 - 190 + i * 190;
      const active = prefs.strategy === s.key;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0xF2B84B : 0xFFFFFF, active ? 1 : 0.1);
      bg.fillRoundedRect(-85, -16, 170, 32, 16);
      const label = this.add.text(0, 0, s.label, {
        fontFamily: '"Baloo 2"', fontSize: '14px',
        color: active ? '#16283D' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, 38, [bg, label]);
      c.setSize(170, 32).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        sfx.select();
        setPrefs(prefs.chip, s.key);
        this.scene.restart();
      });
      this.stratBtns.push(c);
    });
    this.add.text(W / 2, 64, 'Strategy guide — shows you a path, never changes the roll', {
      fontFamily: '"Manrope"', fontSize: '11px', color: '#9FB2C4',
    }).setOrigin(0.5);
  }

  /* ---------- badges ---------- */
  private drawBadges(): void {
    this.add.text(W - 24, 24, `💸 ${money(stats.interestDestroyed)} interest avoided\n(lifetime)`, {
      fontFamily: '"JetBrains Mono"', fontSize: '12px', color: '#5FC9A8', align: 'right',
    }).setOrigin(1, 0).setDepth(10);
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
