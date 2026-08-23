/* ---------- persistence + debts ---------- */
export interface Debt {
  name: string;
  amount: number;
  paid: number;
  towerX: number;
  tw: number;
  blocks: unknown[];
  topY: number;
}

const STORE_KEY = 'saveshare_debt_towers_v3';

function freshDebt(name: string, amount: number, paid = 0): Debt {
  return { name, amount, paid, towerX: 0, tw: 0, blocks: [], topY: 0 };
}

function normalize(raw: unknown): Debt[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is Partial<Debt> => !!x && typeof x === 'object')
      .map((x) => ({
        paid: 0,
        towerX: 0,
        tw: 0,
        blocks: [],
        topY: 0,
        name: typeof x.name === 'string' ? x.name : 'Debt',
        amount: typeof x.amount === 'number' && isFinite(x.amount) ? x.amount : 0,
      }));
  }
  return [];
}

export const store = {
  debts: [] as Debt[],

  load(): void {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = normalize(JSON.parse(raw));
        if (parsed.length) { this.debts = parsed; return; }
      }
    } catch (e) { /* ignore */ }
    this.debts = [
      freshDebt('Credit Card', 4250),
      freshDebt('Car Loan', 9800),
      freshDebt('Student Loan', 14200),
    ];
  },

  save(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.debts)); } catch (e) { /* ignore */ }
  },

  demo(): void {
    this.debts = [
      freshDebt('Credit Card', 4250),
      freshDebt('Car Loan', 9800),
      freshDebt('Student Loan', 14200),
      freshDebt('Overdraft', 750),
    ];
  },
};

export function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));
}

export const MUTE_KEY = 'saveshare_muted';
