/* ============================================================
   Overview — one persistent tower per debt.
   Tap a tower → "pay it now" preview (DOM) → Roll sequence.
   Strategy toggle (Snowball/Avalanche) = pure guidance, no
   damage or reward multiplier. Blocks = % of original balance.
   ============================================================ */
import Phaser from 'phaser';
import {
  store, principalLeft, pctPaid, money, prefs, setPrefs,
  combo, comboMult, stats, type Strategy,
} from '../core/state';
import { drawTower } from '../core/towerRender';
import { sfx } from '../core/audio';
import { bus } from '../core/bus';

const W = 1280;
const H = 640;
const BASE_Y = 545;
const CHIPS = [15, 50, 100, 250, 500, 1000];

export class OverviewScene extends Phaser.Scene {
  private towers: Phaser.GameObjects.Container[] = [];
  private rings: (Phaser.GameObjects.Container | null)[] = [];
  private chipBtns: Phaser.GameObjects.Container[] = [];
  private stratBtns: Phaser.GameObjects.Container[] = [];
  private pendingIdx = -1;
  private busy = false;

  constructor() { super('Overview'); }

  create(): void {
    this.busy = false;
    this.pendingIdx = -1;
    this.towers = [];
    this.rings = [];
    this.chipBtns = [];
    this.stratBtns = [];
    this.scene.bringToTop();

    bus.on('start', this.onStart, this);
    bus.on('roll-cancel', this.onRollCancel, this);
    bus.on('roll-confirm', this.onRollConfirm, this);

    this.drawTowers();
    this.drawStrategyToggle();
    this.drawChips();
    this.drawComboBadge();
    this.emitHud();
  }

  shutdown(): void {
    bus.off('start', this.onStart, this);
    bus.off('roll-cancel', this.onRollCancel, this);
    bus.off('roll-confirm', this.onRollConfirm, this);
  }

  /* ---------- towers ---------- */
  private drawTowers(): void {
    const debts = store.debts;
    if (!debts.length) return;
    const spacing = Math.min(250, 1080 / Math.max(debts.length, 1));
    const x0 = W / 2 - (spacing * (debts.length - 1)) / 2;

    debts.forEach((d, i) => {
      const x = x0 + i * spacing;
      const ring = this.suggestFor(i) ? 'suggest' : 'none';
      const t = drawTower(this, x, BASE_Y, d, i, { showLabels: true, ring });
      this.towers.push(t);
      this.rings.push(ring ? t : null);

      // tap target (whole tower area)
      const hit = this.add.zone(x, BASE_Y - 165, 220, 360).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.attack(i));
    });

    // cleared check — show hint text if everything's paid off
    const allPaid = debts.every((d) => pctPaid(d) >= 1);
    this.add.text(W / 2, 96, allPaid ? '🎉 Every debt cleared — incredible.' : 'Tap a tower, then roll your payment into it ❄️', {
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

  private attack(i: number): void {
    if (this.busy) return;
    const d = store.debts[i];
    if (!d || pctPaid(d) >= 1) return;
    this.pendingIdx = i;
    sfx.select();
    bus.emit('preview', i);
  }

  /* ---------- strategy toggle (guidance only — no mechanical bonus) ---------- */
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
    this.add.text(W / 2, 66, 'Strategy guide — shows you a path, never changes damage', {
      fontFamily: '"Manrope"', fontSize: '11px', color: '#9FB2C4',
    }).setOrigin(0.5);
  }

  /* ---------- payment amount (the fixed £ per hit) ---------- */
  private drawChips(): void {
    this.add.text(W / 2, H - 62, 'PAYMENT PER HIT', {
      fontFamily: '"JetBrains Mono"', fontSize: '10px', color: '#9FB2C4',
    }).setOrigin(0.5);
    CHIPS.forEach((v, i) => {
      const active = prefs.chip === v;
      const x = W / 2 - 275 + i * 110;
      const bg = this.add.graphics();
      bg.fillStyle(active ? 0x5FC9A8 : 0xFFFFFF, active ? 1 : 0.12);
      bg.fillRoundedRect(-48, -18, 96, 36, 18);
      const label = this.add.text(0, 0, '£' + v, {
        fontFamily: '"Baloo 2"', fontSize: '16px',
        color: active ? '#10241C' : '#F4F8FB',
      }).setOrigin(0.5);
      const c = this.add.container(x, H - 30, [bg, label]);
      c.setSize(96, 36).setInteractive({ useHandCursor: true });
      c.on('pointerdown', () => {
        sfx.select();
        setPrefs(v, prefs.strategy);
        this.scene.restart();
      });
      this.chipBtns.push(c);
    });
  }

  /* ---------- combo + lifetime interest badge ---------- */
  private drawComboBadge(): void {
    const c = combo.count;
    if (c > 1) {
      this.add.text(24, 24, `🔥 Combo ×${comboMult().toFixed(1)}\nstreak on ${store.debts[combo.towerIdx]?.name ?? ''}`, {
        fontFamily: '"JetBrains Mono"', fontSize: '13px', color: '#F2B84B', align: 'left',
      }).setDepth(10);
    }
    this.add.text(W - 24, 24, `💰 ${money(stats.interestDestroyed)} interest avoided\n(lifetime)`, {
      fontFamily: '"JetBrains Mono"', fontSize: '12px', color: '#5FC9A8', align: 'right',
    }).setOrigin(1, 0).setDepth(10);
  }

  /* ---------- bridge ---------- */
  private onStart(): void {
    this.scene.restart();
  }

  private onRollCancel(): void {
    this.busy = false;
    this.pendingIdx = -1;
  }

  private onRollConfirm(): void {
    if (this.pendingIdx < 0) return;
    this.busy = true;
    const idx = this.pendingIdx;
    this.pendingIdx = -1;
    this.scene.start('Roll', { towerIdx: idx, chip: prefs.chip });
  }

  private emitHud(): void {
    const total = store.debts.reduce((a, d) => a + d.balance, 0);
    const paid = store.debts.reduce((a, d) => a + d.paid, 0);
    bus.emit('hud', {
      left: store.debts.reduce((a, d) => a + principalLeft(d), 0),
      pct: total > 0 ? paid / total : 0,
      combo: combo.count,
      mult: comboMult(),
      interest: stats.interestDestroyed,
    });
  }
}
