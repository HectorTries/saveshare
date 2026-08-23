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
import { setHud, showWin, showLevelClear, hideOverlays, setRoundInfo } from '../ui';

/* ---------- constants (same feel as v1) ---------- */
const SLING = { x: 200, y: GROUND_Y - 52 };
const ANCH1 = { x: 168, y: GROUND_Y - 104 };
const ANCH2 = { x: 232, y: GROUND_Y - 104 };
const MAX_PULL = 170;
const POWER = 0.3;
const MAX_SPEED = 42;          // slightly under 45 so Matter never tunnels a 30px block
const BALL_R = 14;
const GRAV_STEP = 1.0;         // px/step² — matches v1's GRAV=1.0 per frame
const GRAB_RADIUS = 160;       // generous grab zone around the sling (finger friendly on mobile)

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
  private level = 0;          // 0..2 → three towers per round
  private levelsCleared = 0;
  private levelCredit = 5;    // goal / 3, credited per level
  private levelDone = false;  // guards double-clear

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
  private ballGo: any = null;   // hidden matter game object holding the flying ball body
  private trail: { x: number; y: number }[] = [];
  private trailGfx!: Phaser.GameObjects.Graphics;

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
    this.trailGfx = this.add.graphics();
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
    bridge.onNextLevel = () => this.nextLevel();

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
        const c = this.textures.createCanvas(key, 128, 128);
        if (c) {
          const ctx = c.getContext();
          // body with vertical gradient + bevel edges
          const g = ctx.createLinearGradient(0, 4, 0, 124);
          g.addColorStop(0, m.edge);
          g.addColorStop(0.35, m.color);
          g.addColorStop(1, m.dark);
          ctx.fillStyle = g;
          roundRectPath(ctx, 4, 4, 120, 120, 12);
          ctx.fill();
          // outer dark border (bevel)
          ctx.strokeStyle = 'rgba(0,0,0,.25)';
          ctx.lineWidth = 3;
          roundRectPath(ctx, 5, 5, 118, 118, 11);
          ctx.stroke();
          // top shine
          ctx.fillStyle = 'rgba(255,255,255,.4)';
          roundRectPath(ctx, 10, 7, 108, 10, 5);
          ctx.fill();
          // bottom shade
          ctx.fillStyle = 'rgba(0,0,0,.14)';
          roundRectPath(ctx, 10, 112, 108, 9, 4);
          ctx.fill();
          // material detail
          if (mat === 'wood') {
            ctx.strokeStyle = 'rgba(80,45,18,.4)';
            ctx.lineWidth = 3;
            for (let i = 0; i < 5; i++) {
              ctx.beginPath();
              ctx.moveTo(14, 96 - i * 18);
              ctx.lineTo(114, 96 - i * 18);
              ctx.stroke();
            }
            ctx.fillStyle = 'rgba(80,45,18,.5)';
            ctx.beginPath(); ctx.ellipse(34, 40, 7, 5, 0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(88, 76, 6, 4, -0.2, 0, Math.PI * 2); ctx.fill();
          } else if (mat === 'stone') {
            ctx.fillStyle = 'rgba(30,45,65,.4)';
            ctx.beginPath(); ctx.ellipse(36, 34, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(88, 86, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(68, 58, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(30,45,65,.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(20, 100); ctx.lineTo(40, 84); ctx.lineTo(52, 90);
            ctx.stroke();
          } else if (mat === 'ice') {
            ctx.fillStyle = 'rgba(255,255,255,.75)';
            ctx.beginPath();
            ctx.moveTo(24, 22); ctx.lineTo(56, 22); ctx.lineTo(40, 46);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.4)';
            ctx.beginPath();
            ctx.moveTo(70, 60); ctx.lineTo(96, 60); ctx.lineTo(82, 82);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(180,220,240,.35)';
            ctx.beginPath(); ctx.arc(96, 34, 12, 0, Math.PI * 2); ctx.fill();
          } else if (mat === 'tnt') {
            // warning stripes top
            ctx.save();
            ctx.beginPath();
            roundRectPath(ctx, 4, 4, 120, 120, 12);
            ctx.clip();
            ctx.fillStyle = 'rgba(255,217,160,.25)';
            for (let i = -2; i < 14; i++) {
              ctx.save();
              ctx.translate(i * 14, 0);
              ctx.rotate(0.6);
              ctx.fillRect(0, 0, 7, 130);
              ctx.restore();
            }
            ctx.restore();
            ctx.fillStyle = '#2B2B33';
            ctx.fillRect(56, 0, 16, 18);
            ctx.strokeStyle = '#FFD9A0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(64, 4); ctx.quadraticCurveTo(88, 12, 82, 34); ctx.stroke();
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 30px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('TNT', 64, 84);
            ctx.fillStyle = 'rgba(255,190,130,.6)';
            ctx.beginPath(); ctx.arc(82, 34, 5, 0, Math.PI * 2); ctx.fill();
          } else if (mat === 'gold') {
            ctx.fillStyle = 'rgba(255,255,255,.65)';
            ctx.beginPath();
            ctx.moveTo(28, 26); ctx.lineTo(58, 26); ctx.lineTo(46, 52);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#7A5400';
            ctx.font = 'bold 52px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('£', 64, 86);
            ctx.fillStyle = 'rgba(255,255,255,.7)';
            ctx.beginPath(); ctx.arc(98, 30, 6, 0, Math.PI * 2); ctx.fill();
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
    this.level = 0;
    this.levelsCleared = 0;
    this.levelCredit = Math.max(1, Math.round(this.goal / 3));
    this.levelDone = false;
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
    setRoundInfo(`Level 1/3 • blow up the TNT • each level pays £${this.levelCredit} of your £${this.goal} target`);
    this.syncHud(true);
  }

  resetRun(): void {
    if (this.done) return;
    this.clearRound();
    this.level = 0;
    this.levelsCleared = 0;
    this.levelCredit = Math.max(1, Math.round(this.goal / 3));
    this.levelDone = false;
    this.pot = 0;
    this.shots = 0;
    this.tntHits = 0;
    this.launched = false;
    this.dragging = false;
    this.dragPos = null;
    this.buildTower();
    this.resetBall();
    this.runStart = performance.now();
    setRoundInfo(`Level 1/3 • blow up the TNT • each level pays £${this.levelCredit} of your £${this.goal} target`);
    this.syncHud(true);
  }

  private clearRound(): void {
    for (const b of this.blocks) {
      if (b.body) this.matter.world.remove(b.body);
      b.img.destroy();
    }
    this.blocks = [];
    this.blockByBody.clear();
    this.removeBallBody();
    this.launched = false;
    this.trail.length = 0;
    if (this.winT) { this.winT.remove(); this.winT = null; }
    this.trajGfx.clear();
  }

  /* ================= tower construction =================
     Three levels per round, each a fresh tower with a TNT bomb as the goal.
     Blocks start STATIC = infinite mass anchors, so towers are rock-stable.
     Only the column above a destroyed block becomes dynamic: it falls and
     lands on the support below, then re-anchors once settled.
     Rubble that settles on the ground gets poofed — no floor camping. */
  private buildTower(): void {
    const debt = store.debts[this.payDebtIdx];
    if (!debt) return;
    const BW = 46, BH = 30, GAP = 2;
    const idx = this.payDebtIdx;
    const add = (x: number, y: number, w: number, h: number, mat: MatKey) => {
      this.addBlock(x + w / 2, y + h / 2, w, h, mat, idx);
    };
    if (this.level === 0) this.buildLevel1(add, BW, BH, GAP);
    else if (this.level === 1) this.buildLevel2(add, BW, BH, GAP);
    else this.buildLevel3(add, BW, BH, GAP);
  }

  /* Level 1 — “The Gate”: bomb buried low behind wood. Easy warm-up. */
  private buildLevel1(add: (x: number, y: number, w: number, h: number, mat: MatKey) => void, BW: number, BH: number, GAP: number): void {
    const x0 = W / 2 - 92;
    const c = [x0, x0 + BW, x0 + BW * 2];
    let y = GROUND_Y - 26;
    c.forEach((x) => add(x, y, BW, 26, 'stone'));                 // foundation
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'wood'));                   // row 0
    y -= GAP + BH;
    add(c[0], y, BW, BH, 'wood'); add(c[1], y, BW, BH, 'tnt'); add(c[2], y, BW, BH, 'wood'); // row 1: bomb core
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'wood'));                   // row 2
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'ice'));                    // row 3
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'ice');                                   // keep
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'gold');                                  // crown
  }

  /* Level 2 — “The Vault”: taller, stone shell, bomb deeper. */
  private buildLevel2(add: (x: number, y: number, w: number, h: number, mat: MatKey) => void, BW: number, BH: number, GAP: number): void {
    const x0 = W / 2 - 92;
    const c = [x0, x0 + BW, x0 + BW * 2];
    let y = GROUND_Y - 26;
    c.forEach((x) => add(x, y, BW, 26, 'stone'));                 // foundation
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'stone'));                  // stone base
    y -= GAP + BH;
    add(c[0], y, BW, BH, 'wood'); add(c[1], y, BW, BH, 'tnt'); add(c[2], y, BW, BH, 'wood'); // bomb
    y -= GAP + BH;
    add(c[0], y, BW, BH, 'stone'); add(c[1], y, BW, BH, 'wood'); add(c[2], y, BW, BH, 'stone'); // armored
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'wood'));                   // row
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'ice'));                    // ice storey
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'ice');                                   // keep
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'gold');                                  // crown
  }

  /* Level 3 — “The Fortress”: tallest, bomb high in a keep, side ice pillars. */
  private buildLevel3(add: (x: number, y: number, w: number, h: number, mat: MatKey) => void, BW: number, BH: number, GAP: number): void {
    const x0 = W / 2 - 92;
    const c = [x0, x0 + BW, x0 + BW * 2];
    let y = GROUND_Y - 26;
    c.forEach((x) => add(x, y, BW, 26, 'stone'));                 // foundation
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'stone'));                  // stone base
    y -= GAP + BH;
    add(c[0], y, BW, BH, 'wood'); add(c[1], y, BW, BH, 'tnt'); add(c[2], y, BW, BH, 'wood'); // bomb
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'stone'));                  // cap above bomb
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'wood'));                   // row
    y -= GAP + BH;
    c.forEach((x) => add(x, y, BW, BH, 'ice'));                    // ice storey
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'ice');                                   // keep
    y -= GAP + BH;
    add(c[1], y, BW, BH, 'gold');                                  // crown
    // side ice pillars
    let py = GROUND_Y - 26;
    add(x0 - BW, py, BW, 26, 'ice');
    add(x0 + BW * 3, py, BW, 26, 'ice');
    py -= GAP + BH;
    add(x0 - BW, py, BW, BH, 'ice');
    add(x0 + BW * 3, py, BW, BH, 'ice');
    py -= GAP + BH;
    add(x0 - BW, py, BW, BH, 'ice');
    add(x0 + BW * 3, py, BW, BH, 'ice');
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

  /* ================= ball =================
     The ready ball is VISUAL ONLY — no physics body exists until launch.
     Dragging a physics body around (v1 approach) fought the solver every
     frame → jittery bands + mobile jank. Now: image follows finger,
     body is created at release with the right velocity. */
  private resetBall(): void {
    this.removeBallBody();
    this.launched = false;
    this.stoppedT = 0;
    this.launchTime = 0;
    this.trail.length = 0;
    this.ballImg.setPosition(SLING.x, SLING.y).setVisible(true);
  }

  private removeBallBody(): void {
    if (this.ballBody) {
      try { this.matter.world.remove(this.ballBody); } catch (e) { /* already gone */ }
      this.ballBody = null;
    }
    this.ballGo = null;
  }

  private launchBall(): void {
    if (!this.dragPos || this.done) return;
    const dx = SLING.x - this.dragPos.x;
    const dy = SLING.y - this.dragPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const spd = Math.min(len * POWER, MAX_SPEED);
    // fresh dynamic circle body — no static juggling, no NaN trap.
    // NOTE: matter.add.circle returns the raw body in Phaser 3.87.
    this.ballBody = this.matter.add.circle(SLING.x, SLING.y, BALL_R, {
      label: 'ball',
      density: 2.2 / (Math.PI * BALL_R * BALL_R), // mass ≈ 2.2 like v1
      friction: 0.3,
      frictionAir: 0.01, // minimal air drag: real flight matches the trajectory preview
      restitution: 0.3,
    }) as unknown as MatterJS.BodyType;
    this.ballGo = null; // visuals handled by our own ballImg
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
    const d = Math.hypot(p.x - SLING.x, p.y - SLING.y);
    if (d < GRAB_RADIUS) {
      this.dragging = true;
      this.dragPos = { x: p.x, y: p.y };
      this.ballImg.setPosition(p.x, p.y);
    }
  }

  private onDrag(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    const dx = p.x - SLING.x, dy = p.y - SLING.y;
    const d = Math.hypot(dx, dy);
    this.dragPos = d > MAX_PULL ? { x: SLING.x + (dx / d) * MAX_PULL, y: SLING.y + (dy / d) * MAX_PULL } : { x: p.x, y: p.y };
    if (this.dragPos.y > H - 16) this.dragPos.y = H - 16;
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
      // the bomb is the level goal: any solid hit detonates it
      const tntHit = rec.mat === 'tnt' && vn > 1.5;

      if (dmg > 0.12 || tntHit) {
        rec.hp -= dmg;
        this.spawnCrack(rec.body.position.x, rec.body.position.y);
        if (rec.hp <= 0 || tntHit) this.destroyBlock(rec, 'hit');
        else {
          sfx.chip();
          this.flashBlock(rec);
        }
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

  private poofBlock(rec: BlockRec): void {
    if (rec.dead) return;
    rec.dead = true;
    const x = rec.img.x, y = rec.img.y;
    this.removeQueue.push(rec.body);
    this.destroyQueue.push(rec.img);
    this.blockByBody.delete(rec.body);
    // small poof puff so it doesn't just vanish
    for (let i = 0; i < 6; i++) {
      this.burst(x, y, {
        count: 1, speed: Math.random() * 2.5 + 0.5, angle: Math.random() * Math.PI * 2,
        color: 0xffffff, size: Math.random() * 3 + 1.5, life: 400, grav: 0.1,
      });
    }
  }

  private flashBlock(rec: BlockRec): void {
    if (rec.dead) return;
    rec.img.setTintFill(0xffffff);
    this.time.delayedCall(70, () => {
      if (!rec.dead) rec.img.clearTint();
    });
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
    if (rec.mat === 'tnt') {
      this.tntHits++;
      this.explode(bx, by);
      this.onTntBlown(); // bomb = the level goal
    }
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

  /* ================= win / level flow ================= */
  /* TNT exploded → level cleared. Credit goal/3 toward the debt.
     After 3 levels → round win (total shots/time across all three). */
  private onTntBlown(): void {
    if (this.done || this.levelDone) return;
    this.levelDone = true;
    this.levelsCleared++;
    const d = store.debts[this.payDebtIdx];
    const credit = this.levelCredit;
    if (d) {
      d.paid = Math.min(d.amount, (d.paid || 0) + credit);
      store.save();
    }
    this.pot += credit;
    this.syncHud(true);
    if (this.levelsCleared >= 3) {
      this.done = true;
      this.winSec = Math.round((performance.now() - this.runStart) / 1000); // freeze total time
      this.winT = this.time.delayedCall(900, () => this.showWin());
    } else {
      this.winT = this.time.delayedCall(800, () => {
        showLevelClear(this.level + 1, credit, d ? d.name : '');
      });
    }
  }

  private nextLevel(): void {
    hideOverlays();
    this.level++;
    this.levelDone = false;
    this.clearRound();
    this.buildTower();
    this.resetBall();
    setRoundInfo(`Level ${this.level + 1}/3 • blow up the TNT • each level pays £${this.levelCredit} of your £${this.goal} target`);
    this.syncHud(true);
  }

  private showWin(): void {
    const sec = this.winSec;
    const timeStr = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const d = store.debts[this.payDebtIdx];
    const dName = d ? esc(d.name || 'this debt') : 'your debt';
    const left = d ? Math.max(0, d.amount - d.paid) : 0;
    let stars: string, rank: string;
    if (this.shots <= 6) { stars = '★★★'; rank = 'SABRE-class Melt!'; }
    else if (this.shots <= 10) { stars = '★★☆'; rank = 'Blizzard Blitz'; }
    else if (this.shots <= 15) { stars = '★☆☆'; rank = 'Snowball Sniper'; }
    else { stars = '★☆☆'; rank = 'Grind it out'; }
    const interest = this.tntHits * 12;
    showWin({
      emoji: this.shots <= 6 ? '🏆' : '💸',
      title: 'All 3 levels cleared!',
      sub: `£${this.goal} paid toward ${dName} across 3 levels — £${fmt(left)} to go.` + (this.tntHits > 0 ? ` 💥 +£${interest} interest saved by blowing up the bombs!` : ''),
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
      level: this.level + 1,
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

    // settle: re-anchor blocks that have come to rest, EXCEPT rubble that
    // landed on the ground — that poofs away so you never shoot floor debris.
    const M: any = (Phaser.Physics.Matter as any).Matter;
    for (const b of this.blocks) {
      if (b.dead) continue;
      const spd = Math.hypot(b.body.velocity.x, b.body.velocity.y);
      if (b.body.isStatic) continue;
      if (spd < 0.18) {
        if (++b.settleT > 25) {
          const bottom = b.img.y + b.img.displayHeight / 2;
          if (bottom >= GROUND_Y - 6) {
            // resting on the ground → poof it away
            if (b.mat === 'tnt') {
              this.destroyBlock(b, 'boom'); // bomb on the floor still blows up the level
            } else {
              this.poofBlock(b);
            }
          } else {
            // resting on the tower → part of the structure now
            M.Body.setStatic(b.body, true);
            this.setVel(b.body, 0, 0);
          }
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

    // ball lifecycle — track the flying body, then reset visual-only ball
    if (this.ballBody && this.launched) {
      const body = this.ballBody;
      const spd = Math.hypot(body.velocity.x, body.velocity.y);
      const px = body.position.x, py = body.position.y;
      const off = py > H + 80 || px < -120 || px > W + 120;
      const timedOut = this.launchTime && performance.now() - this.launchTime > 4000;
      if (spd < 0.5) this.stoppedT++; else this.stoppedT = 0;
      // trail
      this.trail.push({ x: px, y: py });
      if (this.trail.length > 14) this.trail.shift();
      if (off || this.stoppedT > 30 || timedOut) {
        this.removeBallBody();
        this.launched = false;
        this.stoppedT = 0;
        this.launchTime = 0;
        this.trail.length = 0;
        this.ballImg.setPosition(SLING.x, SLING.y).setVisible(true);
      } else {
        this.ballImg.setPosition(px, py);
      }
    }

    // HUD timer
    if (this.timerOn && !this.done) this.syncHud(false);

    this.draw();
  }

  /* ================= drawing ================= */
  private draw(): void {
    this.drawTrail();
    this.drawBlocks();
    this.drawSling();
    this.drawTrajectory();
    this.drawLabels();
    this.drawBall();
  }

  private drawTrail(): void {
    this.trailGfx.clear();
    if (!this.launched || this.trail.length < 2) return;
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const a = (i / this.trail.length) * 0.55;
      const r = 2 + (i / this.trail.length) * 3;
      this.trailGfx.fillStyle(0xffffff, a);
      this.trailGfx.fillCircle(t.x, t.y, r);
    }
  }

  private drawBackground(): void {
    const g = this.bgGfx;
    g.clear();
    // sky
    g.fillGradientStyle(0x232f4a, 0x232f4a, 0x7fa3c4, 0x9cc3da, 1);
    g.fillRect(0, 0, W, GROUND_Y);
    // stars
    g.fillStyle(0xffffff, 0.6);
    for (let i = 0; i < 70; i++) {
      const sx = (i * 137 + 41) % W;
      const sy = (i * 89 + 23) % (GROUND_Y - 160);
      g.fillCircle(sx, sy, i % 7 === 0 ? 2 : 1.2);
    }
    // aurora
    g.fillStyle(0x5fc9a8, 0.12);
    g.fillEllipse(W * 0.42, 60, 640, 90);
    g.fillStyle(0x3e92cc, 0.1);
    g.fillEllipse(W * 0.62, 100, 520, 70);
    // moon with glow
    g.fillStyle(0xffffff, 0.14);
    g.fillCircle(1100, 88, 64);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(1100, 88, 30);
    g.fillStyle(0xe8dcc0, 0.5);
    g.fillCircle(1093, 82, 6);
    g.fillCircle(1108, 95, 4);
    // mountains (back, hazy)
    g.fillStyle(0x647e96, 0.5);
    g.fillPoints([
      new Phaser.Geom.Point(0, GROUND_Y), new Phaser.Geom.Point(120, GROUND_Y - 90),
      new Phaser.Geom.Point(260, GROUND_Y - 40), new Phaser.Geom.Point(420, GROUND_Y - 130),
      new Phaser.Geom.Point(560, GROUND_Y - 60), new Phaser.Geom.Point(720, GROUND_Y - 150),
      new Phaser.Geom.Point(880, GROUND_Y - 70), new Phaser.Geom.Point(1040, GROUND_Y - 110),
      new Phaser.Geom.Point(1200, GROUND_Y - 50), new Phaser.Geom.Point(1280, GROUND_Y - 95),
      new Phaser.Geom.Point(1280, GROUND_Y), new Phaser.Geom.Point(0, GROUND_Y),
    ], true);
    // mountains (front) with snow caps
    g.fillStyle(0x9cb4c6, 0.75);
    g.fillPoints([
      new Phaser.Geom.Point(0, GROUND_Y), new Phaser.Geom.Point(160, GROUND_Y - 45),
      new Phaser.Geom.Point(340, GROUND_Y - 20), new Phaser.Geom.Point(520, GROUND_Y - 55),
      new Phaser.Geom.Point(700, GROUND_Y - 25), new Phaser.Geom.Point(900, GROUND_Y - 60),
      new Phaser.Geom.Point(1100, GROUND_Y - 30), new Phaser.Geom.Point(1280, GROUND_Y - 50),
      new Phaser.Geom.Point(1280, GROUND_Y), new Phaser.Geom.Point(0, GROUND_Y),
    ], true);
    // snow caps on front peaks
    g.fillStyle(0xf4fafc, 0.9);
    g.fillPoints([
      new Phaser.Geom.Point(160, GROUND_Y - 45), new Phaser.Geom.Point(230, GROUND_Y - 38),
      new Phaser.Geom.Point(200, GROUND_Y - 30), new Phaser.Geom.Point(160, GROUND_Y - 33),
    ], true);
    g.fillPoints([
      new Phaser.Geom.Point(520, GROUND_Y - 55), new Phaser.Geom.Point(600, GROUND_Y - 47),
      new Phaser.Geom.Point(565, GROUND_Y - 38), new Phaser.Geom.Point(520, GROUND_Y - 42),
    ], true);
    g.fillPoints([
      new Phaser.Geom.Point(900, GROUND_Y - 60), new Phaser.Geom.Point(980, GROUND_Y - 52),
      new Phaser.Geom.Point(945, GROUND_Y - 42), new Phaser.Geom.Point(900, GROUND_Y - 46),
    ], true);
    // snow ground
    g.fillGradientStyle(0xf6fbfd, 0xf6fbfd, 0xafcbdb, 0x8fb2c8, 1);
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle(0xffffff, 0.95);
    g.fillRect(0, GROUND_Y, W, 5);
    // soft shadow under tower
    g.fillStyle(0x466982, 0.16);
    g.fillEllipse(W / 2, GROUND_Y + 8, 300, 26);
    // snow drifts
    g.fillStyle(0xffffff, 0.25);
    g.fillEllipse(240, GROUND_Y + 34, 260, 22);
    g.fillEllipse(1010, GROUND_Y + 46, 320, 26);
    // sparkles
    g.fillStyle(0xffffff, 0.5);
    for (let i = 0; i < 36; i++) g.fillRect((i * 37 + 13) % W, GROUND_Y + 12 + ((i * 53) % 26), 2, 2);
    // vignette
    g.fillStyle(0x0b1422, 0.12);
    g.fillRect(0, 0, W, 14);
    g.fillRect(0, H - 14, W, 14);
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
    // target point: drag position, flying ball, or rest
    const target = this.dragging && this.dragPos ? this.dragPos
      : this.launched ? { x: this.ballImg.x, y: this.ballImg.y }
      : { x: SLING.x, y: SLING.y };
    const stretch = this.dragging ? Math.min(Math.hypot(target.x - SLING.x, target.y - SLING.y) / MAX_PULL, 1) : 0;

    // ---- wooden frame (behind bands) ----
    // trunk
    g.fillGradientStyle(0x4a3322, 0x7a5436, 0x3f2a1a, 0x2e1e12, 1);
    g.fillRoundedRect(SLING.x - 8, SLING.y - 26, 16, 54, 5);
    // prongs
    g.fillStyle(0x7a5436, 1);
    g.fillRoundedRect(SLING.x - 16, SLING.y - 66, 13, 44, 6);
    g.fillRoundedRect(SLING.x + 3, SLING.y - 66, 13, 44, 6);
    // prong highlights
    g.fillStyle(0x9a7048, 0.6);
    g.fillRoundedRect(SLING.x - 14, SLING.y - 64, 4, 40, 2);
    g.fillRoundedRect(SLING.x + 5, SLING.y - 64, 4, 40, 2);
    // crossbar
    g.fillStyle(0x2e1e12, 1);
    g.fillRoundedRect(SLING.x - 18, SLING.y - 70, 36, 8, 4);
    // trunk grain
    g.lineStyle(1.2, 0x2e1e12, 0.35);
    g.beginPath();
    g.moveTo(SLING.x - 3, SLING.y - 20); g.lineTo(SLING.x - 3, SLING.y + 22);
    g.moveTo(SLING.x + 4, SLING.y - 20); g.lineTo(SLING.x + 4, SLING.y + 22);
    g.strokePath();

    // ---- rubber bands (curved look via segmented lines) ----
    const sag = 4 + stretch * 10;
    const mx = (ANCH1.x + ANCH2.x) / 2;
    const my = (ANCH1.y + ANCH2.y) / 2 + sag;
    g.lineStyle(7, 0x5a3a24, 1);
    g.beginPath();
    g.moveTo(ANCH1.x, ANCH1.y);
    g.lineTo(mx, my);
    g.lineTo(target.x, target.y);
    g.moveTo(ANCH2.x, ANCH2.y);
    g.lineTo(mx, my);
    g.lineTo(target.x, target.y);
    g.strokePath();
    // band highlight
    g.lineStyle(2.5, 0x8a6040, 0.9);
    g.beginPath();
    g.moveTo(ANCH1.x, ANCH1.y);
    g.lineTo(mx, my - 2);
    g.lineTo(target.x, target.y);
    g.moveTo(ANCH2.x, ANCH2.y);
    g.lineTo(mx, my - 2);
    g.lineTo(target.x, target.y);
    g.strokePath();
    // pouch
    if (this.dragging || !this.launched) {
      g.fillStyle(0x3f2a1a, 1);
      g.fillEllipse(target.x, target.y, 20, 12);
      g.fillStyle(0x7a5436, 0.8);
      g.fillEllipse(target.x, target.y, 14, 7);
    }
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
    const w = 26 + txt.length * 9.5;
    this.labelGfx.fillRoundedRect(cx - w / 2, labelY - 18, w, 24, 12);
    if (!this.pillText) {
      this.pillText = this.add.text(cx, labelY, txt, {
        fontFamily: 'JetBrains Mono', fontSize: '14px', fontStyle: 'bold',
        color: d.paid >= d.amount ? '#7FE8C4' : '#FFFFFF',
      }).setOrigin(0.5);
      this.nameText = this.add.text(cx, labelY + 18, '', {
        fontFamily: 'Manrope', fontSize: '12px', fontStyle: '700', color: '#E8F2F8',
      }).setOrigin(0.5);
      this.payText = this.add.text(cx, labelY + 34, '', {
        fontFamily: 'Manrope', fontSize: '10px', fontStyle: '700', color: '#F2B84B',
      }).setOrigin(0.5);
    }
    this.pillText.setPosition(cx, labelY).setText(txt)
      .setColor(d.paid >= d.amount ? '#7FE8C4' : '#FFFFFF');
    this.nameText.setPosition(cx, labelY + 18).setText(d.name.length > 12 ? d.name.slice(0, 11) + '…' : d.name);
    this.payText.setPosition(cx, labelY + 34).setVisible(!this.done).setText('🎯 PAYING THIS');
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
