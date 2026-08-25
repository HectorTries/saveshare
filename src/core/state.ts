/* ============================================================
   Summit — "Snowball" v4. Each debt is a mountain: a peak in
   the middle, a right slope down to the payoff flag, a left
   slope down to the spiral pit. The snowball starts at the peak.
   Horizontal position = % of the ORIGINAL balance resolved, not
   raw £ (a £250k mortgage and a £2k card cross the same way).
   Gravity (driven by APR) pulls left; payments push right.

   Two NEW persisted values per debt:
     progress — ball position (0 = peak, 1 = flag, negative = pit)
     terrain  — steepness of each right-slope segment (0.05..1),
                permanently flattened by payments ∝ interest avoided.
   Everything else (balance, APR, months, paid) already existed.
   ============================================================ */

export interface Debt {
  name: string;
  balance: number;    // original balance £
  apr: number;        // annual % rate
  months: number;     // months remaining at start
  paid: number;       // cumulative principal paid £ (never decreases)
  progress: number;   // ball position: 0 = peak, 1 = flag, -PIT = pit floor
  terrain: number[];  // right-slope steepness per segment (SEGMENTS)
  celebrated: number; // bitmask of milestone flags celebrated (1=25,2=50,4=75)
}

export const SEGMENTS = 24;
export const PIT = 0.35;             // deepest negative progress (pit floor)
export const MILESTONES = [0.25, 0.5, 0.75, 1];

const STORE_KEY = 'saveshare_summit_v5';
const STATS_KEY = 'saveshare_stats_v4';
const PREFS_KEY = 'saveshare_prefs_v4';

/* ---------- derived math ---------- */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const pctPaid = (d: Debt): number => clamp01(d.paid / d.balance);
export const principalLeft = (d: Debt): number => Math.max(0, d.balance - d.paid);
/** months naturally shrink as the debt is paid down → paying earlier is worth more */
export const monthsLeft = (d: Debt): number => Math.max(0, Math.round(d.months * (1 - pctPaid(d))));
/** £ of future interest avoided by paying `amount` now (single source of truth —
    drives terrain flattening, the interest-avoided readout and the combo meter) */
export const interestDestroyed = (d: Debt, amount: number): number =>
  amount * (d.apr / 12 / 100) * monthsLeft(d);
/** total projected future interest on the remaining principal (reference for previews) */
export const interestProjected = (d: Debt): number =>
  principalLeft(d) * (d.apr / 12 / 100) * monthsLeft(d);

/** fresh terrain: every segment at full steepness */
export function freshTerrain(): number[] {
  return new Array(SEGMENTS).fill(1);
}

/* ---------- terrain ---------- */
export function segmentAt(progress: number): number {
  return Math.max(0, Math.min(SEGMENTS - 1, Math.floor(progress * SEGMENTS)));
}
export function steepnessAt(d: Debt, progress: number): number {
  const i = segmentAt(Math.max(0, progress));
  return d.terrain[i] ?? 1;
}
/** right-slope drift: % of slope per second. Flatter terrain = less grip. */
export function driftPerSec(d: Debt, progress: number): number {
  if (progress <= 0) {
    // spiral pit side — always full pull, accelerating with depth
    const depth = Math.min(1, -progress / PIT);
    return 0.03 * d.apr * (1 + 0.6 * depth);
  }
  const s = steepnessAt(d, progress);
  return 0.018 * d.apr * (0.25 + 0.75 * s);
}
/** flattened ground gives pushes more carry (the "easier climb" reward) */
export function pushFactor(d: Debt, progress: number): number {
  return 1 + 0.5 * (1 - steepnessAt(d, progress));
}

/* ---------- combo / momentum (session only) ---------- */
export const combo = { debtIdx: -1, count: 0 };
export function comboMult(): number {
  return 1 + 0.1 * Math.min(combo.count - 1, 10);
}
/** well-timed (GOOD/PERFECT) hits build the streak; a sloppy hit resets it */
export function registerHit(idx: number, wellTimed: boolean): { count: number; mult: number } {
  if (wellTimed && combo.debtIdx === idx) combo.count += 1;
  else if (wellTimed) { combo.debtIdx = idx; combo.count = 1; }
  else { combo.debtIdx = -1; combo.count = 0; }
  return { count: combo.count, mult: comboMult() };
}
export function resetCombo(): void { combo.debtIdx = -1; combo.count = 0; }

/* ---------- lifetime stats ---------- */
export const stats = { interestDestroyed: 0 };
function loadStats(): void {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      stats.interestDestroyed = typeof p.interest === 'number' ? p.interest : 0;
    }
  } catch (e) { /* ignore */ }
}
function saveStats(): void {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
}

/* ---------- prefs (chip + strategy, persisted) ---------- */
export type Strategy = 'none' | 'snowball' | 'avalanche';
export const prefs = { chip: 100, strategy: 'none' as Strategy };
function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.chip === 'number') prefs.chip = p.chip;
      if (p.strategy === 'snowball' || p.strategy === 'avalanche' || p.strategy === 'none') prefs.strategy = p.strategy;
    }
  } catch (e) { /* ignore */ }
}
function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}
export function setPrefs(chip: number, strategy: Strategy): void {
  prefs.chip = chip; prefs.strategy = strategy; savePrefs();
}

/* ---------- push application ---------- */
export interface PushOutcome {
  amount: number;       // principal actually paid (capped)
  interest: number;     // £ future interest avoided by this payment
  basePct: number;      // honest principal push as % of the slope (1:1 with £)
  distPct: number;      // actual distance % (skill × combo × terrain)
  skill: 'PERFECT' | 'GOOD' | 'SLOPPY';
  skillEff: number;
  comboCount: number;
  comboMult: number;
  milestone: number | null;  // 25|50|75 crossed this push
  cleared: boolean;
  pctBefore: number;
  pctAfter: number;
  flattenApplied: number;    // average steepness reduction this push
}

export const FLATTEN_DIV = 0.05;   // interest / (balance × this) → 0..1+
export const FLATTEN_MAX = 0.35;   // max steepness removed per segment per push
export const FLATTEN_SPAN = 6;     // segments ahead of the ball that get flattened

export function applyPush(idx: number, amount: number, skillEff: number): PushOutcome {
  const d = store.debts[idx];
  const cap = Math.min(amount, principalLeft(d));
  const interest = interestDestroyed(d, cap);
  const wellTimed = skillEff >= 1;
  const cres = registerHit(idx, wellTimed);
  const before = pctPaid(d);
  const basePct = (cap / d.balance) * 100;
  const distPct = basePct * skillEff * cres.mult * pushFactor(d, d.progress);

  d.paid = Math.min(d.balance, d.paid + cap);
  const after = pctPaid(d);
  d.progress = Math.max(-PIT, Math.min(1, d.progress + distPct / 100));

  // permanent flattening of the slope ahead, ∝ interest avoided
  const strength = Math.min(FLATTEN_MAX, interest / (d.balance * FLATTEN_DIV));
  let sum = 0;
  const start = segmentAt(Math.max(0, d.progress));
  for (let i = start; i < Math.min(SEGMENTS, start + FLATTEN_SPAN); i++) {
    const beforeS = d.terrain[i];
    d.terrain[i] = Math.max(0.05, d.terrain[i] - strength);
    sum += beforeS - d.terrain[i];
  }

  const crossed = MILESTONES.filter((t) => before < t && after >= t);
  let milestone: number | null = null;
  for (const t of crossed) {
    if (t >= 1) continue;
    const bit = t === 0.25 ? 1 : t === 0.5 ? 2 : 4;
    if (!(d.celebrated & bit)) {
      d.celebrated |= bit;
      milestone = t * 100;
    }
  }
  const cleared = after >= 1;

  stats.interestDestroyed += interest;
  saveStats();
  store.save();

  return {
    amount: cap,
    interest,
    basePct,
    distPct,
    skill: skillEff >= 1.3 ? 'PERFECT' : skillEff >= 1 ? 'GOOD' : 'SLOPPY',
    skillEff,
    comboCount: cres.count,
    comboMult: cres.mult,
    milestone,
    cleared,
    pctBefore: before,
    pctAfter: after,
    flattenApplied: sum / Math.max(1, FLATTEN_SPAN),
  };
}

/* ---------- store ---------- */
function fresh(name: string, balance: number, apr: number, months: number): Debt {
  return {
    name, balance, apr, months, paid: 0, progress: 0,
    terrain: freshTerrain(), celebrated: 0,
  };
}

function normalize(raw: unknown): Debt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Partial<Debt> => !!x && typeof x === 'object')
    .map((x) => {
      const terrain = Array.isArray(x.terrain) && x.terrain.length === SEGMENTS
        ? (x.terrain as number[]).map((v) => (typeof v === 'number' && isFinite(v) ? Math.max(0.05, Math.min(1, v)) : 1))
        : freshTerrain();
      const bal = typeof x.balance === 'number' && isFinite(x.balance) ? x.balance : 0;
      return {
        name: typeof x.name === 'string' && x.name ? x.name : 'Debt',
        balance: bal > 0 ? bal : 0,
        apr: typeof x.apr === 'number' && isFinite(x.apr) ? Math.max(0, x.apr) : 19.9,
        months: typeof x.months === 'number' && isFinite(x.months) ? Math.max(1, Math.round(x.months)) : 36,
        paid: typeof x.paid === 'number' && isFinite(x.paid) ? Math.max(0, Math.min(x.paid, bal > 0 ? bal : Infinity)) : 0,
        progress: typeof x.progress === 'number' && isFinite(x.progress) ? Math.max(-PIT, Math.min(1, x.progress)) : 0,
        terrain,
        celebrated: typeof x.celebrated === 'number' ? (x.celebrated & 7) : 0,
      };
    })
    .filter((d) => d.balance > 0);
}

function demoDebts(): Debt[] {
  return [
    fresh('Credit Card', 4250, 24.9, 36),
    fresh('Car Loan', 9800, 7.9, 48),
    fresh('Student Loan', 14200, 5.5, 120),
    fresh('Overdraft', 750, 19.9, 12),
  ];
}

export const store = {
  debts: [] as Debt[],

  load(): void {
    loadStats();
    loadPrefs();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = normalize(JSON.parse(raw));
        if (parsed.length) { this.debts = parsed; return; }
      }
    } catch (e) { /* ignore */ }
    // migrate from v4 towers (paid → progress; fresh terrain)
    try {
      const old = localStorage.getItem('saveshare_debt_towers_v4');
      if (old) {
        const parsed = normalize(
          (JSON.parse(old) as Array<Record<string, unknown>>).map((x) => {
            const balance = typeof x.balance === 'number' ? x.balance : 0;
            const paid = typeof x.paid === 'number' ? x.paid : 0;
            const pct = balance > 0 ? Math.max(0, Math.min(1, paid / balance)) : 0;
            const celebrated = (pct >= 0.25 ? 1 : 0) | (pct >= 0.5 ? 2 : 0) | (pct >= 0.75 ? 4 : 0);
            return { ...x, progress: pct, terrain: freshTerrain(), celebrated };
          }),
        );
        if (parsed.length) { this.debts = parsed; this.save(); return; }
      }
    } catch (e) { /* ignore */ }
    this.debts = demoDebts();
    this.save();
  },

  save(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.debts)); } catch (e) { /* ignore */ }
  },

  resetProgress(): void {
    this.debts.forEach((d) => {
      d.paid = 0;
      d.progress = 0;
      d.terrain = freshTerrain();
      d.celebrated = 0;
    });
    resetCombo();
    stats.interestDestroyed = 0;
    saveStats();
    this.save();
  },

  demo(): void {
    this.debts = demoDebts();
    this.save();
  },
};

/* ---------- formatting ---------- */
export function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));
}

export function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return '£' + fmt(n);
  if (a < 20) return '£' + (Math.round(n * 100) / 100).toString();
  return '£' + Math.round(n);
}

export const MUTE_KEY = 'saveshare_muted';
