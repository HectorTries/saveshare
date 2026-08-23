/* ============================================================
   Snowball • Debt Towers — Target Speedrun
   v2: Vite + TypeScript + Phaser 3 with Matter.js physics
   Log a payment → melt that much off the towers → win.
   ============================================================ */
import Phaser from 'phaser';
import { MATS, BLEED, type MatKey, GROUND_Y, W, H } from '../core/materials';
import { sfx } from '../core/audio';
import { store, fmt } from '../core/state';
import { bridge } from '../bridge';
import { setHud, showWin, hideOverlays, setRoundInfo } from '../ui';

/* ---------- constants (same feel as v1) ---------- */
const SLING = { x: 200, y: GROUND_Y - 52 };
const ANCH1 = { x: 168, y: GROUND_Y - 104 };
const ANCH2 = { x: 232, y: GROUND_Y - 104 };
const MAX_PULL = 170;
const POWER = 0.3;
const MAX_SPEED = 42;          // slightly under 45 so Matter never tunnels a 30px block
const BALL_R = 14;
const GRAV_STEP = 1.0;         // px/step² — matches v1's GRAV=1.0 per frame

interface BlockRec {
  img: Phaser.GameObjects.Image;
  body: MatterJS.BodyType;
  mat: MatKey;
  hp: number;
  maxHp: number;
  value: number;
  debtIdx: number;
  settleT: number;             // frames nearly at rest
  dead: boolean;
}

export class GameScene extends Phaser.Scene {
  private blocks: BlockRec[] = [];
  private blockByBody = new Map<MatterJS.BodyType, BlockRec>();

  private ballBody: MatterJS.BodyType | null = null;
  private ballImg!: Phaser.GameObjects.Image;
  private dragging = false;
  private dragPos: { x: number; y: number } | null = null;
  private stoppedT = 0;
  private launchTime = 0;
  private launched = false;

  private goal = 15;
  private pot = 0;
  private shots = 0;
  private tntHits = 0;
  private payDebtIdx = 0;
  private done = false;
  private timerOn = false;
  private runStart = 0;
  private winSec = 0;

  private bgGfx!: Phaser.GameObjects.Graphics;
  private trajGfx!: Phaser.GameObjects.Graphics;
  private blockGfx!: Phaser.GameObjects.Graphics;
  private slingGfx!: Phaser.GameObjects.Graphics;
  private labelGfx!: Phaser.GameObjects.Graphics;
  private pillText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private payText!: Phaser.GameObjects.Text;
  private debrisTex!: Phaser.GameObjects.Graphics;
  private winT: Phaser.Time.TimerEvent | null = null;
  private removeQueue: MatterJS.BodyType[] = []; // bodies removed after the physics step (never mid-event)
  private destroyQueue: Phaser.GameObjects.Image[] = []; // sprites destroyed in the same safe window

  private rnd: () => number = Math.random;

  constructor() {
    super('Game');
  }

  /* ================= create ================= */
  create(): void {
    // deterministic per-tower randomness (v1 used mulberry32 + name hash)
    this.rnd = Math.random;

    // Matter: accel/step = gravity.y * scale * delta² (delta≈16.666ms) → 0.0036 ≈ v1's GRAV=1.0
    this.matter.world.setGravity(0, 1, 0.0036);

    // static ground + side walls
    this.matter.add.rectangle(W / 2, GROUND_Y + 60, W * 2, 120, { isStatic: true, label: 'ground' });
    this.matter.add.rectangle(-60, H / 2, 120, H * 2, { isStatic: true, label: 'wall' });
    this.matter.add.rectangle(W + 60, H / 2, 120, H * 2, { isStatic: true, label: 'wall' });

    this.generateTextures();

    this.bgGfx = this.add.graphics();
    this.drawBackground();
    this.blockGfx = this.add.graphics();
    this.slingGfx = this.add.graphics();
    this.trajGfx = this.add.graphics();
    this.labelGfx = this.add.graphics();

    this.ballImg = this.add.image(SLING.x, SLING.y, 'snowball').setScale(BALL_R / 16);

    // physics collision events
    this.matter.world.on('collisionstart', (e: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
      this.onCollision(e);
    });

    // input
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.tryGrab(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onDrag(p));
    this.input.on('pointerup', () => this.release());

    // UI bridge
    bridge.onStartRun = (goal, idx) => this.startRun(goal, idx);
    bridge.onEditDebts = () => { /* overlay handled in ui; nothing to reset here */ };
    bridge.onReset = () => this.resetRun();

    // quick play: ?play=1
    if (typeof location !== 'undefined' && location.search.includes('play')) {
      store.demo();
      this.startRun(15, 0);
      hideOverlays();
    }
  }

  /* ================= textures ================= */
  private generateTextures(): void {
    if (!this.textures.exists('pixel')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
      g.generateTexture('pixel', 4, 4);
      g.destroy();
    }
    if (!this.textures.exists('snowball')) {
      const c = this.textures.createCanvas('snowball', 32, 32);
      if (c) {
        const ctx = c.getContext();
        const grad = ctx.createRadialGradient(12, 12, 3, 16, 16, 15);
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(0.65, '#EAF3F8');
        grad.addColorStop(1, '#AFC7D8');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(16, 16, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath();
        ctx.arc(11, 10, 4.5, 0, Math.PI * 2);
        ctx.fill();
        c.refresh();
      }
    }
    (Object.keys(MATS) as MatKey[]).forEach((mat) => {
      const key = `block-${mat}`;
      if (!this.textures.exists(key)) {
        const m = MATS[mat];
        const c = this.textures.createCanvas(key, 64, 64);
        if (c) {
          const ctx = c.getContext();
          const g = ctx.createLinearGradient(0, 0, 0, 64);
          g.addColorStop(0, m.edge);
          g.addColorStop(0.4, m.color);
          g.addColorStop(1, m.dark);
          ctx.fillStyle = g;
          roundRectPath(ctx, 2, 2, 60, 60, 8);
          ctx.fill();
          // top shine
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          roundRectPath(ctx, 4, 3, 56, 5, 3);
          ctx.fill();
          // material detail
          if (mat === 'wood') {
            ctx.strokeStyle = 'rgba(80,45,18,.35)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
              ctx.beginPath();
              ctx.moveTo(4, 48 - i * 8);
              ctx.lineTo(60, 48 - i * 8);
              ctx.stroke();
            }
          } else if (mat === 'stone') {
            ctx.fillStyle = 'rgba(30,45,65,.35)';
            ctx.beginPath(); ctx.ellipse(20, 18, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(44, 42, 3, 2.4, 0, 0, Math.PI * 2); ctx.fill();
          } else if (mat === 'ice') {
            ctx.fillStyle = 'rgba(255,255,255,.7)';
            ctx.beginPath();
            ctx.moveTo(12, 12); ctx.lineTo(28, 12); ctx.lineTo(19, 24);
            ctx.closePath(); ctx.fill();
          } else if (mat === 'tnt') {
            ctx.fillStyle = '#2B2B33';
            ctx.fillRect(28, 0, 8, 10);
            ctx.strokeStyle = '#FFD9A0';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(32, 2); ctx.quadraticCurveTo(44, 6, 40, 18); ctx.stroke();
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('TNT', 32, 40);
          } else if (mat === 'gold') {
            ctx.fillStyle = 'rgba(255,255,255,.6)';
            ctx.beginPath();
            ctx.moveTo(14, 12); ctx.moveTo(14, 16); ctx.lineTo(30, 16); ctx.lineTo(24, 28);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#7A5400';
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('£', 32, 42);
          }
          c.refresh();
        }
      }
    });
  }

  /* ================= round flow ================= */
  startRun(goal: number, payDebtIdx: number): void {
    this.clearRound();
    this.goal = Math.max(1, Math.min(10000, goal));
    this.payDebtIdx = payDebtIdx;
    this.pot = 0;
    this.shots = 0;
    this.tntHits = 0;
    this.done = false;
    this.timerOn = false;
    this.launched = false;
    this.dragging = false;
    this.dragPos = null;
    this.buildTower();
    this.resetBall();
    this.runStart = performance.now();
    setRoundInfo(`Speedrun • melt £${this.goal} • blocks: ice £3, wood £5, stone £4, TNT £10, crown £10`);
    this.syncHud(true);
  }

  resetRun(): void {
    if (this.done) return;
    this.clearRound();
    this.pot = 0;
    this.shots = 0;
    this.tntHits = 0;
    this.launched = false;
    this.dragging = false;
    this.dragPos = null;
    this.buildTower();
    this.resetBall();
    this.runStart = performance.now();
    this.syncHud(true);
  }

  private clearRound(): void {
    for (const b of this.blocks) {
      if (b.body) this.matter.world.remove(b.body);
      b.img.destroy();
    }
    this.blocks = [];
    this.blockByBody.clear();
    if (this.ballBody) { this.matter.world.remove(this.ballBody); this.ballBody = null; }
    if (this.winT) { this.winT.remove(); this.winT = null; }
    this.trajGfx.clear();
  }

  /* ================= tower construction =================
     Solid 3-column stack. Blocks start STATIC = infinite mass anchors,
     so the tower is rock-stable. Only the column above a destroyed block
     becomes dynamic: it falls and lands on the support below, then
     re-anchors once settled. TNT (high-interest APR) sits in the core. */
  private buildTower(): void {
    const debt = store.debts[this.payDebtIdx];
    if (!debt) return;
    const scale = clamp(Math.pow((debt.amount || 8000) / 8000, 1 / 3), 0.7, 1.55);
    const BW = 46, BH = 30, GAP = 2;
    const x0 = W / 2 - 92;
    const cx = x0 + BW * 3 / 2;
    const colX = [x0, x0 + BW, x0 + BW * 2];
    const idx = this.payDebtIdx;

    const add = (x: number, y: number, w: number, h: number, mat: MatKey) => {
      this.addBlock(x + w / 2, y + h / 2, w, h, mat, idx);
    };

    // Foundation: 3 stone bricks on the ground
    let y = GROUND_Y - 26;
    add(colX[0], y, BW, 26, 'stone');
    add(colX[1], y, BW, 26, 'stone');
    add(colX[2], y, BW, 26, 'stone');

    // Row 0: wood sides, stone centre backbone
    y -= GAP + BH;
    add(colX[0], y, BW, BH, 'wood');
    add(colX[1], y, BW, BH, 'stone');
    add(colX[2], y, BW, BH, 'wood');

    // Row 1: TNT buried in the core — wood in front (stronger than ice), stone below
    y -= GAP + BH;
    add(colX[0], y, BW, BH, 'wood');
    add(colX[1], y, BW, BH, 'tnt');
    add(colX[2], y, BW, BH, 'wood');

    // Row 2: wood tier
    y -= GAP + BH;
    add(colX[0], y, BW, BH, 'wood');
    add(colX[1], y, BW, BH, 'wood');
    add(colX[2], y, BW, BH, 'wood');

    // Row 3: ice upper storey (easy chip)
    y -= GAP + BH;
    add(colX[0], y, BW, BH, 'ice');
    add(colX[1], y, BW, BH, 'ice');
    add(colX[2], y, BW, BH, 'ice');

    // Row 4: extra ice for bigger debts
    if (scale > 1.0) {
      y -= GAP + BH;
      add(colX[0], y, BW, BH, 'ice');
      add(colX[1], y, BW, BH, 'ice');
      add(colX[2], y, BW, BH, 'ice');
    }

    // Raised keep: centre column one extra ice tier
    y -= GAP + BH;
    add(colX[1], y, BW, BH, 'ice');

    // Gold crown on top of the keep
    y -= GAP + BH;
    add(cx - BW / 2, y, BW, BH, 'gold');
  }

  private addBlock(x: number, y: number, w: number, h: number, mat: MatKey, debtIdx: number): BlockRec {
    const m = MATS[mat];
    const img = this.add.image(x, y, `block-${mat}`).setDisplaySize(w, h);
    const go: any = this.matter.add.gameObject(img, {
      shape: { type: 'rectangle', width: w, height: h },
      isStatic: false, // create dynamic, then anchor via setStatic(true) so mass can be restored
      label: mat,
      density: m.density,
      friction: m.friction,
      restitution: m.restitution,
    });
    const body = go.body as MatterJS.BodyType;
    const M: any = (Phaser.Physics.Matter as any).Matter;
    M.Body.setStatic(body, true); // infinite-mass anchor; _original records real mass
    const rec: BlockRec = {
      img, body, mat,
      hp: m.hp, maxHp: m.hp, value: m.value,
      debtIdx, settleT: 0, dead: false,
    };
    this.blocks.push(rec);
    this.blockByBody.set(body, rec);
    return rec;
  }

  /* ================= ball ================= */
  private resetBall(): void {
    if (this.ballBody) {
      this.matter.world.remove(this.ballBody);
      this.ballBody = null;
    }
    this.launched = false;
    this.stoppedT = 0;
    this.ballImg.setPosition(SLING.x, SLING.y).setVisible(true);
  }

  private spawnBall(): void {
    if (this.ballBody) return;
    // fresh image + body every time so we never reuse a removed body
    this.ballImg.destroy();
    this.ballImg = this.add.image(SLING.x, SLING.y, 'snowball').setScale(BALL_R / 16);
    this.ballImg.setVisible(true);
    this.matter.add.gameObject(this.ballImg, {
      shape: { type: 'circle', radius: BALL_R },
      isStatic: false, // create dynamic so setStatic(true) records real mass for later restore
      label: 'ball',
      density: 2.2 / (Math.PI * BALL_R * BALL_R), // mass ≈ 2.2 like v1
      friction: 0.3,
      frictionAir: 0.01, // minimal air drag: real flight matches the trajectory preview
      restitution: 0.3,
    });
    this.ballBody = this.ballImg.body as MatterJS.BodyType;
    const M: any = (Phaser.Physics.Matter as any).Matter;
    M.Body.setStatic(this.ballBody, true); // anchor at sling; _original captures real mass
  }

  private launchBall(): void {
    if (!this.ballBody || !this.dragPos || this.done) return;
    const dx = SLING.x - this.dragPos.x;
    const dy = SLING.y - this.dragPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const spd = Math.min(len * POWER, MAX_SPEED);
    const M: any = (Phaser.Physics.Matter as any).Matter;
    M.Body.setStatic(this.ballBody, false);
    // set velocity directly: Matter's setVelocity divides by body.deltaTime,
    // which is undefined on a body created static → NaN. positionPrev trick avoids it.
    this.setVel(this.ballBody, (dx / len) * spd, (dy / len) * spd);
    this.launched = true;
    this.stoppedT = 0;
    this.launchTime = performance.now();
    this.shots++;
    this.timerOn = true;
    sfx.launch();
    this.syncHud(false);
  }

  /** Direct velocity set that never NaNs (works on bodies that have never stepped). */
  private setVel(body: MatterJS.BodyType, vx: number, vy: number): void {
    body.positionPrev.x = body.position.x - vx;
    body.positionPrev.y = body.position.y - vy;
    body.velocity.x = vx;
    body.velocity.y = vy;
    body.speed = Math.hypot(vx, vy);
  }

  /* ================= input ================= */
  private tryGrab(p: Phaser.Input.Pointer): void {
    if (this.done || this.launched) return;
    if (!this.ballBody) this.spawnBall();
    const d = Math.hypot(p.x - SLING.x, p.y - SLING.y);
    if (d < 90) {
      this.dragging = true;
      this.dragPos = { x: p.x, y: p.y };
    }
  }

  private onDrag(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    const dx = p.x - SLING.x, dy = p.y - SLING.y;
    const d = Math.hypot(dx, dy);
    this.dragPos = d > MAX_PULL ? { x: SLING.x + (dx / d) * MAX_PULL, y: SLING.y + (dy / d) * MAX_PULL } : { x: p.x, y: p.y };
    if (this.dragPos.y > H - 16) this.dragPos.y = H - 16;
    if (this.ballBody) {
      const M: any = (Phaser.Physics.Matter as any).Matter;
      M.Body.setPosition(this.ballBody, this.dragPos);
    }
    this.ballImg.setPosition(this.dragPos.x, this.dragPos.y);
  }

  private release(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.launchBall();
    this.dragPos = null;
  }

  /* ================= collision & damage ================= */
  private onCollision(e: Phaser.Physics.Matter.Events.CollisionStartEvent): void {
    if (this.done) return;
    for (const pair of e.pairs) {
      const { bodyA, bodyB } = pair;
      let ballB: MatterJS.BodyType | null = null;
      let blockB: MatterJS.BodyType | null = null;
      if (bodyA.label === 'ball' && bodyB.label !== 'ball') { ballB = bodyA; blockB = bodyB; }
      else if (bodyB.label === 'ball' && bodyA.label !== 'ball') { ballB = bodyB; blockB = bodyA; }
      if (!ballB || !blockB || !this.ballBody) continue;
      const rec = this.blockByBody.get(blockB);
      if (!rec || rec.dead) continue;

      // impact speed along the collision normal (normal points A→B)
      const n = pair.collision.normal;
      const rvx = blockB.velocity.x - ballB.velocity.x;
      const rvy = blockB.velocity.y - ballB.velocity.y;
      let vn = rvx * n.x + rvy * n.y;
      if (vn < 0) vn = -vn; // approach speed
      const dmg = Math.max(0, vn) * 0.05;

      if (dmg > 0.12) {
        rec.hp -= dmg;
        this.spawnCrack(rec.body.position.x, rec.body.position.y);
        if (rec.hp <= 0) this.destroyBlock(rec, 'hit');
        else sfx.chip();
        this.cameras.main.shake(60, Math.min(0.004 + dmg * 0.0012, 0.02));
      }

      // material eats ball energy — bounce handled by Matter restitution
      const bleed = BLEED[rec.mat] || 0.85;
      const M: any = (Phaser.Physics.Matter as any).Matter;
      M.Body.setVelocity(ballB, {
        x: ballB.velocity.x * bleed,
        y: ballB.velocity.y * bleed,
      });
      if (vn > 1.2) sfx.thud();
    }
  }

  private destroyBlock(rec: BlockRec, cause: 'hit' | 'boom'): void {
    if (rec.dead) return;
    rec.dead = true;
    const bx = rec.img.x, by = rec.img.y;
    this.removeQueue.push(rec.body); // deferred: never remove a body mid-collision-event
    this.destroyQueue.push(rec.img); // deferred: never destroy a sprite mid-event either
    this.blockByBody.delete(rec.body);

    this.pot += rec.value;
    this.floater(bx, by - rec.img.displayHeight / 2, `+£${rec.value}`, rec.mat === 'gold' || rec.mat === 'tnt');
    this.spawnDebris(rec);
    if (rec.mat === 'gold' || rec.mat === 'tnt') sfx.coin();
    if (rec.mat === 'tnt') { this.tntHits++; this.explode(bx, by); }
    sfx.crack();

    // blocks above in the same column lose support: fall and land on the block below
    const M: any = (Phaser.Physics.Matter as any).Matter;
    for (const o of this.blocks) {
      if (o.dead || o === rec) continue;
      if (Math.abs(o.img.x - bx) < 30 && o.img.y < by) {
        M.Body.setStatic(o.body, false);
        this.setVel(o.body, o.body.velocity.x + (Math.random() - 0.5) * 0.5, o.body.velocity.y);
      }
    }
    this.syncHud(true);
    this.checkWin();
  }

  private explode(x: number, y: number): void {
    this.cameras.main.shake(250, 0.035);
    sfx.tnt();
    // fire + flash particles
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * 7 + 2;
      this.burst(x, y, { count: 1, speed: sp, angle: a, color: 0xffb36b, size: Math.random() * 5 + 3, life: Math.random() * 500 + 300, grav: 0.18 });
    }
    const M: any = (Phaser.Physics.Matter as any).Matter;
    const R = 95;
    for (const b of this.blocks) {
      if (b.dead || b.mat === 'tnt') continue; // no chain reactions
      const dx = b.img.x - x, dy = b.img.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R) {
        const f = 8 * (1 - d / R);
        M.Body.setStatic(b.body, false);
        this.setVel(b.body, b.body.velocity.x + (dx / d) * f, b.body.velocity.y + (dy / d) * f - 3);
        b.body.angularVelocity += (Math.random() - 0.5) * 0.8;
        b.hp -= 1;
        if (b.hp <= 0) this.destroyBlock(b, 'boom');
      }
    }
  }

  /* ================= win ================= */
  private checkWin(): void {
    if (this.done) return;
    if (this.pot >= this.goal) {
      this.done = true;
      this.winSec = Math.round((performance.now() - this.runStart) / 1000); // freeze timer at win moment
      const d = store.debts[this.payDebtIdx];
      if (d) {
        d.paid = Math.min(d.amount, (d.paid || 0) + this.goal);
        store.save();
      }
      if (this.winT) this.winT.remove();
      this.winT = this.time.delayedCall(650, () => this.showWin());
    }
  }

  private showWin(): void {
    const sec = this.winSec;
    const timeStr = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const d = store.debts[this.payDebtIdx];
    const dName = d ? esc(d.name || 'this debt') : 'your debt';
    const left = d ? Math.max(0, d.amount - d.paid) : 0;
    let stars: string, rank: string;
    if (this.shots <= 2) { stars = '★★★'; rank = 'SABRE-class Melt!'; }
    else if (this.shots <= 5) { stars = '★★☆'; rank = 'Blizzard Blitz'; }
    else if (this.shots <= 9) { stars = '★☆☆'; rank = 'Snowball Sniper'; }
    else { stars = '★☆☆'; rank = 'Grind it out'; }
    const interest = this.tntHits * 12;
    showWin({
      emoji: this.shots <= 1 ? '🏆' : '💸',
      title: 'Payment logged!',
      sub: `£${this.goal} paid toward ${dName} — £${fmt(left)} to go.` + (this.tntHits > 0 ? ` 💥 +£${interest} interest saved by melting the high-interest blocks first!` : ''),
      stars, rank,
      pot: Math.min(this.pot, this.goal), shots: this.shots, time: timeStr, interest,
    });
    sfx.win();
    for (let i = 0; i < 5; i++) {
      this.burst(W / 2 + (Math.random() - 0.5) * 300, GROUND_Y - 200, {
        count: 10, speed: Math.random() * 6 + 3, angle: -Math.PI / 2 + (Math.random() - 0.5) * 1.2,
        color: [0x5fc9a8, 0xf2b84b, 0x3e92cc, 0xff6b4a, 0xffffff][i % 5], size: Math.random() * 5 + 3, life: 1000, grav: 0.22,
      });
    }
    this.cameras.main.shake(200, 0.012);
  }

  /* ================= HUD ================= */
  private syncHud(forceBar: boolean): void {
    setHud({
      goal: this.goal,
      pot: Math.min(this.pot, this.goal),
      shots: this.shots,
      time: this.timerOn ? this.timeStr() : '00:00',
      bar: clamp(this.pot / this.goal * 100, 0, 100),
    });
  }

  private timeStr(): string {
    const sec = Math.floor((performance.now() - this.runStart) / 1000);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ================= effects ================= */
  private burst(x: number, y: number, o: { count: number; speed: number; angle: number; color: number | number[]; size: number; life: number; grav: number }): void {
    const e = this.add.particles(x, y, 'pixel', {
      speed: { min: o.speed * 0.4, max: o.speed },
      angle: { min: o.angle - 0.35, max: o.angle + 0.35 },
      lifespan: o.life,
      scale: { start: o.size / 4, end: 0 },
      tint: o.color,
      gravityY: o.grav * 60 * 60,
      emitting: false,
    });
    e.explode(o.count);
    this.time.delayedCall(o.life + 300, () => e.destroy());
  }

  private spawnDebris(rec: BlockRec): void {
    const m = MATS[rec.mat];
    const n = rec.mat === 'tnt' ? 0 : Math.min(14, Math.round((rec.img.displayWidth * rec.img.displayHeight) / 90));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.burst(rec.img.x, rec.img.y, {
        count: 1, speed: Math.random() * 4 + 1, angle: a,
        color: hex(m.color), size: Math.random() * 4 + 2, life: Math.random() * 700 + 300, grav: 0.22,
      });
    }
    if (rec.mat === 'ice') {
      for (let i = 0; i < 8; i++) {
        this.burst(rec.img.x, rec.img.y, {
          count: 1, speed: Math.random() * 6, angle: Math.random() * Math.PI * 2,
          color: 0xe8f6fc, size: Math.random() * 3 + 1.5, life: 600, grav: 0.15,
        });
      }
    }
  }

  private spawnCrack(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      this.burst(x, y, {
        count: 1, speed: 1.5, angle: Math.random() * Math.PI * 2,
        color: 0xffffff, size: 1.5, life: 300, grav: 0,
      });
    }
  }

  private floater(x: number, y: number, text: string, big: boolean): void {
    const t = this.add.text(x, y, text, {
      fontFamily: big ? 'Baloo 2' : 'Manrope',
      fontSize: big ? '26px' : '16px',
      fontStyle: '800',
      color: big ? '#F2B84B' : '#5FC9A8',
      stroke: '#0F1A2E',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(100);
    this.tweens.add({
      targets: t, y: y - 40, alpha: 0, duration: 900, ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }

  /* ================= update loop ================= */
  update(): void {
    // drain deferred removals AFTER the physics step (safe point)
    if (this.removeQueue.length || this.destroyQueue.length) {
      for (const b of this.removeQueue) {
        try { this.matter.world.remove(b); } catch (e) { /* body already gone */ }
      }
      this.removeQueue.length = 0;
      for (const img of this.destroyQueue) { try { img.destroy(); } catch (e) { /* already gone */ } }
      this.destroyQueue.length = 0;
    }

    // settle: re-anchor blocks that have come to rest (only disturbed columns fall)
    const M: any = (Phaser.Physics.Matter as any).Matter;
    for (const b of this.blocks) {
      if (b.dead) continue;
      const spd = Math.hypot(b.body.velocity.x, b.body.velocity.y);
      if (b.body.isStatic) continue;
      if (spd < 0.18) {
        if (++b.settleT > 25) {
          M.Body.setStatic(b.body, true);
          this.setVel(b.body, 0, 0);
          b.settleT = 0;
        }
      } else b.settleT = 0;
      // fell off the world → clean up silently (deferred)
      if (b.img.y > H + 200) {
        this.removeQueue.push(b.body);
        this.destroyQueue.push(b.img);
        this.blockByBody.delete(b.body);
        b.dead = true;
      }
    }

    // ball lifecycle
    if (this.ballBody && this.launched) {
      const v = this.ballBody.velocity;
      const spd = Math.hypot(v.x, v.y);
      const off = this.ballImg.y > H + 80 || this.ballImg.x < -120 || this.ballImg.x > W + 120;
      // remove once nearly stopped, offscreen, or after 4s of flight (keeps reload snappy)
      const timedOut = this.launchTime && performance.now() - this.launchTime > 4000;
      if (spd < 0.5) this.stoppedT++; else this.stoppedT = 0;
      if (off || this.stoppedT > 30 || timedOut) {
        try { this.matter.world.remove(this.ballBody); } catch (e) { /* already gone */ }
        this.ballBody = null;
        this.launched = false;
        this.stoppedT = 0;
        this.launchTime = 0;
        this.spawnBall();
        this.ballImg.setPosition(SLING.x, SLING.y);
      }
    }

    // HUD timer
    if (this.timerOn && !this.done) this.syncHud(false);

    this.draw();
  }

  /* ================= drawing ================= */
  private draw(): void {
    this.drawBlocks();
    this.drawSling();
    this.drawTrajectory();
    this.drawLabels();
    this.drawBall();
  }

  private drawBackground(): void {
    const g = this.bgGfx;
    g.clear();
    // sky
    g.fillGradientStyle(0x2b3d57, 0x2b3d57, 0xa9c5d9, 0xa9c5d9, 1);
    g.fillRect(0, 0, W, GROUND_Y);
    // moon
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(1100, 88, 30);
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(1100, 88, 46);
    // mountains (back)
    g.fillStyle(0x647e96, 0.55);
    g.fillPoints([
      new Phaser.Geom.Point(0, GROUND_Y), new Phaser.Geom.Point(120, GROUND_Y - 90),
      new Phaser.Geom.Point(260, GROUND_Y - 40), new Phaser.Geom.Point(420, GROUND_Y - 130),
      new Phaser.Geom.Point(560, GROUND_Y - 60), new Phaser.Geom.Point(720, GROUND_Y - 150),
      new Phaser.Geom.Point(880, GROUND_Y - 70), new Phaser.Geom.Point(1040, GROUND_Y - 110),
      new Phaser.Geom.Point(1200, GROUND_Y - 50), new Phaser.Geom.Point(1280, GROUND_Y - 95),
      new Phaser.Geom.Point(1280, GROUND_Y), new Phaser.Geom.Point(0, GROUND_Y),
    ], true);
    // mountains (front)
    g.fillStyle(0x9cb4c6, 0.7);
    g.fillPoints([
      new Phaser.Geom.Point(0, GROUND_Y), new Phaser.Geom.Point(160, GROUND_Y - 45),
      new Phaser.Geom.Point(340, GROUND_Y - 20), new Phaser.Geom.Point(520, GROUND_Y - 55),
      new Phaser.Geom.Point(700, GROUND_Y - 25), new Phaser.Geom.Point(900, GROUND_Y - 60),
      new Phaser.Geom.Point(1100, GROUND_Y - 30), new Phaser.Geom.Point(1280, GROUND_Y - 50),
      new Phaser.Geom.Point(1280, GROUND_Y), new Phaser.Geom.Point(0, GROUND_Y),
    ], true);
    // snow ground
    g.fillGradientStyle(0xf6fbfd, 0xf6fbfd, 0xafcbdb, 0xafcbdb, 1);
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(0, GROUND_Y, W, 5);
    // soft shadow under tower
    g.fillStyle(0x466982, 0.16);
    g.fillEllipse(W / 2, GROUND_Y + 8, 280, 26);
    // sparkles
    g.fillStyle(0xffffff, 0.5);
    for (let i = 0; i < 36; i++) g.fillRect((i * 37 + 13) % W, GROUND_Y + 12 + ((i * 53) % 26), 2, 2);
  }

  private drawBlocks(): void {
    this.blockGfx.clear();
    for (const b of this.blocks) {
      if (b.dead) continue;
      // images are auto-synced to Matter bodies each step → use their transforms
      const x = b.img.x, y = b.img.y, angle = b.body.angle;
      this.blockGfx.save();
      this.blockGfx.translateCanvas(x, y);
      this.blockGfx.rotateCanvas(angle);
      const w = b.img.displayWidth, h = b.img.displayHeight;
      // damage cracks
      if (b.hp < b.maxHp) {
        this.blockGfx.lineStyle(1.6, 0x000000, 0.5);
        this.blockGfx.beginPath();
        this.blockGfx.moveTo(-w / 4, -h / 4);
        this.blockGfx.lineTo(0, 0);
        this.blockGfx.lineTo(w / 4, h / 4);
        this.blockGfx.moveTo(w / 5, -h / 5);
        this.blockGfx.lineTo(w / 5 + 5, h / 5 - 4);
        this.blockGfx.strokePath();
      }
      this.blockGfx.restore();
    }
  }

  private drawSling(): void {
    const g = this.slingGfx;
    g.clear();
    const woodGrad = g.fillGradientStyle(0x4a3322, 0x7a5436, 0x3f2a1a, 0x4a3322, 1);
    // prongs
    g.fillStyle(0x7a5436, 1);
    g.fillRoundedRect(SLING.x - 13, SLING.y - 64, 13, 72, 6);
    g.fillRoundedRect(SLING.x + 1, SLING.y - 64, 13, 72, 6);
    g.fillStyle(0x2e1e12, 1);
    g.fillRoundedRect(SLING.x - 15, SLING.y - 68, 44, 10, 5);
    // bands
    const target = this.dragging && this.dragPos ? this.dragPos
      : this.launched ? { x: SLING.x, y: SLING.y }
      : { x: this.ballImg.x, y: this.ballImg.y };
    g.lineStyle(6, 0x6b4a2e, 1);
    g.beginPath();
    g.moveTo(ANCH1.x, ANCH1.y); g.lineTo(target.x, target.y);
    g.moveTo(ANCH2.x, ANCH2.y); g.lineTo(target.x, target.y);
    g.strokePath();
    g.lineStyle(2.4, 0x4a3322, 1);
    g.beginPath();
    g.moveTo(ANCH1.x, ANCH1.y); g.lineTo(target.x, target.y);
    g.moveTo(ANCH2.x, ANCH2.y); g.lineTo(target.x, target.y);
    g.strokePath();
  }

  private drawTrajectory(): void {
    this.trajGfx.clear();
    if (!this.dragging || !this.dragPos) return;
    const dx = SLING.x - this.dragPos.x, dy = SLING.y - this.dragPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const spd = Math.min(len * POWER, MAX_SPEED);
    let vx = (dx / len) * spd, vy = (dy / len) * spd;
    let x = SLING.x, y = SLING.y;
    const drag = 0.99; // ≈ ball frictionAir 0.01 per step, keeps preview honest
    for (let i = 0; i < 60; i++) {
      x += vx; y += vy; vy += GRAV_STEP;
      vx *= drag; vy *= drag;
      if (y > GROUND_Y - 2) break;
      const a = 1 - i / 60;
      this.trajGfx.fillStyle(0xffffff, a * 0.75);
      this.trajGfx.fillCircle(x, y, i % 3 === 0 ? 4 : 2.4);
    }
  }

  private drawLabels(): void {
    this.labelGfx.clear();
    const d = store.debts[this.payDebtIdx];
    if (!d) return;
    const cx = W / 2;
    const alive = this.blocks.filter((b) => !b.dead);
    const topY = alive.length ? Math.min(...alive.map((b) => b.img.y - b.img.displayHeight / 2)) : GROUND_Y - 240;
    const labelY = Math.max(GROUND_Y - 240, topY - 40);
    const left = Math.max(0, d.amount - (d.paid || 0));
    const txt = d.paid >= d.amount ? 'PAID ✓' : `£${fmt(left)} left`;
    this.labelGfx.fillStyle(d.paid >= d.amount ? 0x5fc9a8 : 0x16283d, d.paid >= d.amount ? 0.22 : 0.72);
    const w = 24 + txt.length * 9;
    this.labelGfx.fillRoundedRect(cx - w / 2, labelY - 18, w, 24, 12);
    if (!this.pillText) {
      this.pillText = this.add.text(cx, labelY, txt, {
        fontFamily: 'JetBrains Mono', fontSize: '14px', fontStyle: 'bold',
        color: d.paid >= d.amount ? '#7FE8C4' : '#FFFFFF',
      }).setOrigin(0.5);
      this.nameText = this.add.text(cx, labelY + 16, '', {
        fontFamily: 'Manrope', fontSize: '12px', fontStyle: '700', color: '#E8F2F8',
      }).setOrigin(0.5);
      this.payText = this.add.text(cx, labelY + 30, '', {
        fontFamily: 'Manrope', fontSize: '10px', fontStyle: '700', color: '#F2B84B',
      }).setOrigin(0.5);
    }
    this.pillText.setPosition(cx, labelY).setText(txt)
      .setColor(d.paid >= d.amount ? '#7FE8C4' : '#FFFFFF');
    this.nameText.setPosition(cx, labelY + 16).setText(d.name.length > 12 ? d.name.slice(0, 11) + '…' : d.name);
    this.payText.setPosition(cx, labelY + 30).setVisible(!this.done).setText('🎯 PAYING THIS');
  }

  private drawBall(): void {
    if (!this.launched && !this.dragging) {
      this.ballImg.setPosition(SLING.x, SLING.y);
    }
    // img handles itself; depth set in create
  }
}

/* ---------- helpers ---------- */
function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function hex(css: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(css);
  return m ? parseInt(m[1], 16) : 0xffffff;
}
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
