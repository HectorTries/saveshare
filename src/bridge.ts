/* ---------- shared bridge: DOM UI <-> GameScene ---------- */
export interface RunCallbacks {
  onStartRun: ((goal: number, payDebtIdx: number) => void) | null;
  onEditDebts: (() => void) | null;
  onReset: (() => void) | null;
}

export const bridge: RunCallbacks = {
  onStartRun: null,
  onEditDebts: null,
  onReset: null,
};
