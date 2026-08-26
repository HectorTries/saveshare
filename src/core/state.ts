/* ============================================================
   Downhill — "Snowball" v5. Each debt is ONE hill. The ball
   starts at the top (0% paid) and rolls down to the payoff flag
   (100% = debt cleared). Position down the hill = % of the
   ORIGINAL balance paid, 1:1 and honest — a £250k mortgage and
   a £2k card cross the same hill the same way, £ for £.

   Payments permanently grow the ball (same %-of-original basis
   as distance). A bigger ball rolls faster — speed is a pure
   function of size, light APR friction and debt length. That
   growing speed IS the reward: no combo, no timing minigame.
   No decay, no drift, no streak pressure: the ball simply sits
   at its current size/position until the next payment.
   Interest avoided is computed honestly and shown separately;
   it never inflates distance or size.
   ============================================================ */

export interface Debt {
  name: string;
  balance: number;    // original balance £
  apr: number;        // annual % rate
  months: number;     // months remaining at start (debt length)
  paid: number;       // cumulative principal paid £ (never decreases)
  celebrated: number; // bitmask of milestone flags celebrated (1=25,2=50,4=75)
}

export const MILESTONES = [0.25, 0.5, 0.75];

const STORE_KEY = 'saveshare_hill_v6';
const STATS_KEY = 'saveshare_stats_v4';
const PREFS_KEY = 'saveshare_prefs_v4';

/* ---------- derived math ---------- */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
/** ball position down the hill — % of the ORIGINAL balance paid */
export const pctPaid = (d: Debt): number => clamp01(d.paid / d.balance);
export const principalLeft = (d: Debt): number => Math.max(0, d.balance - d.paid);
/** months naturally shrink as the debt is paid down → paying earlier is worth more */
export const monthsLeft = (d: Debt): number => Math.max(0, Math.round(d.months * (1 - pctPaid(d))));
/** £ of future interest avoided by paying `amount` now (single source of truth —
    drives the interest-avoided readout and the lifetime stat) */
export const interestDestroyed = (d: Debt, amount: number): number =>
  amount * (d.apr / 12 / 100) * monthsLeft(d);
/** total projected future interest on the remaining principal (reference) */
export const interestProjected = (d: Debt): number =>
  principalLeft(d) * (d.apr / 12 / 100) * monthsLeft(d);

/* ---------- ball size — same %-of-original-balance basis as distance ---------- */
export const BALL_MIN = 14;      // px radius, fresh ball
export const BALL_GROWTH = 26;   // px radius added by 100% paid
export const ballRadiusAt = (p: number): number => BALL_MIN + BALL_GROWTH * clamp01(p);
export const ballRadius = (d: Debt): number => ballRadiusAt(pctPaid(d));
/** how many times bigger than a fresh ball the current ball is (speed driver) */
export const ballMult = (d: Debt): number => ballRadius(d) / BALL_MIN;

export function ballLabel(d: Debt): string {
  const p = pctPaid(d);
  if (p < 0.25) return 'SMALL';
  if (p < 0.5) return 'MEDIUM';
  if (p < 0.75) return 'LARGE';
  return 'SNOW GIANT';
}

/* ---------- roll speed — the whole reward mechanic ----------
   Speed is a direct function of current size. Two modifiers:
   • APR friction — very light hill resistance, so high-interest
     debt needs a bit more ball to hit the same speed.
   • Debt length — a mortgage (360mo) crawls at 0.25×, a short
     overdraft (12mo) sprints at 2.5×: movement follows the
     LENGTH of the debt, not just its balance.              */
export const ROLL_BASE = 190;    // px/s: fresh ball, 0% APR, 36mo hill
export const termFactor = (d: Debt): number =>
  Math.max(0.25, Math.min(2.5, 36 / Math.max(d.months, 1)));
export const hillFriction = (d: Debt): number => 1 + (d.apr / 100) * 0.35;
export const rollSpeed = (d: Debt): number =>
  (ROLL_BASE * ballMult(d)) / hillFriction(d) * termFactor(d);

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

/* ---------- payment application ---------- */
export interface PushOutcome {
  amount: number;       // principal actually paid (capped at what's left)
  interest: number;     // £ future interest avoided by this payment
  basePct: number;      // % of the hill covered this payment (1:1 with £)
  milestone: number | null;  // 25|50|75 crossed this payment
  cleared: boolean;
  pctBefore: number;
  pctAfter: number;
}

export function applyPush(idx: number, amount: number): PushOutcome {
  const d = store.debts[idx];
  const cap = Math.min(amount, principalLeft(d));
  const interest = interestDestroyed(d, cap);
  const before = pctPaid(d);
  const basePct = d.balance > 0 ? (cap / d.balance) * 100 : 0;
  // distance = % of original balance paid, 1:1 — honest, no multipliers
  d.paid = Math.min(d.balance, d.paid + cap);
  const after = pctPaid(d);
  const cleared = after >= 1;

  let milestone: number | null = null;
  for (const t of MILESTONES) {
    if (before < t && after >= t) {
      const bit = t === 0.25 ? 1 : t === 0.5 ? 2 : 4;
      if (!(d.celebrated & bit)) { d.celebrated |= bit; milestone = t * 100; }
    }
  }

  stats.interestDestroyed += interest;
  saveStats();
  store.save();

  return { amount: cap, interest, basePct, milestone, cleared, pctBefore: before, pctAfter: after };
}

/* ---------- store ---------- */
function fresh(name: string, balance: number, apr: number, months: number): Debt {
  return { name, balance, apr, months, paid: 0, celebrated: 0 };
}

function normalize(raw: unknown): Debt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Partial<Debt> => !!x && typeof x === 'object')
    .map((x) => {
      const bal = typeof x.balance === 'number' && isFinite(x.balance) ? x.balance : 0;
      return {
        name: typeof x.name === 'string' && x.name ? x.name : 'Debt',
        balance: bal > 0 ? bal : 0,
        apr: typeof x.apr === 'number' && isFinite(x.apr) ? Math.max(0, x.apr) : 19.9,
        months: typeof x.months === 'number' && isFinite(x.months) ? Math.max(1, Math.round(x.months)) : 36,
        paid: typeof x.paid === 'number' && isFinite(x.paid) ? Math.max(0, Math.min(x.paid, bal > 0 ? bal : Infinity)) : 0,
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
    // v6 downhill
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = normalize(JSON.parse(raw));
        if (parsed.length) { this.debts = parsed; return; }
      }
    } catch (e) { /* ignore */ }
    // migrate from v5 summit (progress/terrain/gravity dropped — paid survives)
    try {
      const old = localStorage.getItem('saveshare_summit_v5');
      if (old) {
        const parsed = normalize(JSON.parse(old));
        if (parsed.length) { this.debts = parsed; this.save(); return; }
      }
    } catch (e) { /* ignore */ }
    // migrate from v4 towers (paid → progress)
    try {
      const old = localStorage.getItem('saveshare_debt_towers_v4');
      if (old) {
        const parsed = normalize(
          (JSON.parse(old) as Array<Record<string, unknown>>).map((x) => {
            const balance = typeof x.balance === 'number' ? x.balance : 0;
            const paid = typeof x.paid === 'number' ? x.paid : 0;
            const pct = balance > 0 ? Math.max(0, Math.min(1, paid / balance)) : 0;
            const celebrated = (pct >= 0.25 ? 1 : 0) | (pct >= 0.5 ? 2 : 0) | (pct >= 0.75 ? 4 : 0);
            return { ...x, celebrated };
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
      d.celebrated = 0;
    });
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
