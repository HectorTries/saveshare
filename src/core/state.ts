/* ---------- persistence + debt model (v3 redesign) ----------
   One persistent tower per debt. Blocks are % of the ORIGINAL balance,
   not £. Shell = projected future interest, core = remaining principal.
   Principal paid is the only thing that removes blocks. */
export interface Debt {
  name: string;
  balance: number;   // original balance £
  apr: number;       // annual % rate
  months: number;    // months remaining at start
  paid: number;      // cumulative principal paid £
}

export const BLOCKS = 24;
export const MILESTONES = [0.25, 0.5, 0.75, 1];

const STORE_KEY = 'saveshare_debt_towers_v4';
const STATS_KEY = 'saveshare_stats_v4';
const PREFS_KEY = 'saveshare_prefs_v4';

/* ---------- derived math ---------- */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const pctPaid = (d: Debt): number => clamp01(d.paid / d.balance);
export const principalLeft = (d: Debt): number => Math.max(0, d.balance - d.paid);
/** months naturally shrink as the debt is paid down → paying earlier is worth more */
export const monthsLeft = (d: Debt): number => Math.max(0, Math.round(d.months * (1 - pctPaid(d))));
/** total projected future interest on the REMAINING principal (drives shell volume) */
export const interestProjected = (d: Debt): number => principalLeft(d) * (d.apr / 12 / 100) * monthsLeft(d);
/** interest that would have been owed at the start (drives shell 0→1 reference) */
export const interestAtStart = (d: Debt): number => d.balance * (d.apr / 12 / 100) * d.months;
/** £ of future interest avoided by paying `amount` now */
export const interestDestroyed = (d: Debt, amount: number): number => amount * (d.apr / 12 / 100) * monthsLeft(d);
/** shell volume 0..1 — shrinks quadratically vs the core (overpaying crushes interest) */
export const shellPct = (d: Debt): number => {
  const base = interestAtStart(d);
  return base > 0 ? clamp01(interestProjected(d) / base) : 0;
};
export const blocksAt = (pct: number): number => Math.floor(clamp01(pct) * BLOCKS);
export const blocksRemoved = (d: Debt): number => blocksAt(pctPaid(d));

/* ---------- combo / momentum (session only) ---------- */
export const combo = { towerIdx: -1, count: 0 };
export function comboMult(): number {
  return 1 + 0.1 * Math.min(combo.count - 1, 10);
}
export function registerHit(idx: number): { count: number; mult: number } {
  if (combo.towerIdx === idx) combo.count += 1;
  else { combo.towerIdx = idx; combo.count = 1; }
  return { count: combo.count, mult: comboMult() };
}
export function resetCombo(): void { combo.towerIdx = -1; combo.count = 0; }

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
export const prefs = { chip: 50, strategy: 'none' as Strategy };
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

/* ---------- hit application ---------- */
export interface HitOutcome {
  amount: number;        // principal actually paid (capped)
  blocks: number;        // fractional blocks removed
  interest: number;      // £ interest avoided by this payment
  milestone: number | null; // 25|50|75|100 crossed this hit
  paidOff: boolean;
  pctBefore: number;
  pctAfter: number;
}

export function applyHit(idx: number, amount: number): HitOutcome {
  const d = store.debts[idx];
  const cap = Math.min(amount, principalLeft(d));
  const interest = interestDestroyed(d, cap);
  const before = pctPaid(d);
  d.paid = Math.min(d.balance, d.paid + cap);
  const after = pctPaid(d);
  const crossed = MILESTONES.filter((t) => before < t && after >= t);
  const milestone = crossed.length ? crossed[crossed.length - 1] * 100 : null;
  stats.interestDestroyed += interest;
  saveStats();
  store.save();
  return {
    amount: cap,
    blocks: (after - before) * BLOCKS,
    interest,
    milestone,
    paidOff: after >= 1,
    pctBefore: before,
    pctAfter: after,
  };
}

/* ---------- store ---------- */
function fresh(name: string, balance: number, apr: number, months: number, paid = 0): Debt {
  return { name, balance, apr, months, paid };
}

function normalize(raw: unknown): Debt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Partial<Debt> => !!x && typeof x === 'object')
    .map((x) => ({
      name: typeof x.name === 'string' && x.name ? x.name : 'Debt',
      balance: typeof x.balance === 'number' && isFinite(x.balance) && x.balance > 0 ? x.balance : 0,
      apr: typeof x.apr === 'number' && isFinite(x.apr) ? Math.max(0, x.apr) : 19.9,
      months: typeof x.months === 'number' && isFinite(x.months) ? Math.max(1, Math.round(x.months)) : 36,
      paid: typeof x.paid === 'number' && isFinite(x.paid) ? Math.max(0, x.paid) : 0,
    }))
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
    // migrate from v3 (name/amount/paid only → default apr/months)
    try {
      const old = localStorage.getItem('saveshare_debt_towers_v3');
      if (old) {
        const parsed = normalize(
          (JSON.parse(old) as Array<Record<string, unknown>>).map((x) => ({
            name: x.name, balance: x.amount, apr: 19.9, months: 36, paid: x.paid,
          })),
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
    this.debts.forEach((d) => { d.paid = 0; });
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
