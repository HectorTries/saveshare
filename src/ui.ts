/* ---------- DOM UI layer: debt editor + top HUD.
   The game loop itself (pay → roll → readout) lives entirely in
   the Phaser scenes; DOM only handles setup and the persistent
   top bar. ---------- */
import { store, pctPaid, money, prefs, MUTE_KEY, stats } from './core/state';
import { isMuted, setMuted } from './core/audio';
import { bus } from './core/bus';

function $(id: string): HTMLElement { return document.getElementById(id)!; }

/* ---------- overlay helpers ---------- */
export function hideOverlays(): void {
  $('setupOverlay').classList.remove('show');
}

function showSetup(): void {
  renderDebtList();
  $('setupOverlay').classList.add('show');
}

/* ---------- debt editor ---------- */
function renderDebtList(): void {
  const el = $('debtList');
  el.innerHTML = '';
  store.debts.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'debt-row';
    row.innerHTML = `
      <input class="dname" type="text" placeholder="e.g. Credit Card" value="${esc(d.name)}" title="Name">
      <input class="damt" type="number" min="1" step="50" placeholder="£" value="${d.balance || ''}" title="Balance £">
      <input class="dapr" type="number" min="0" max="100" step="0.1" placeholder="APR %" value="${d.apr ?? ''}" title="APR %">
      <input class="dmon" type="number" min="1" max="600" step="1" placeholder="months" value="${d.months ?? ''}" title="Months left">
      <button class="del-btn" title="Remove">✕</button>`;
    (row.querySelector('.dname') as HTMLInputElement).addEventListener('input', (e) => { d.name = (e.target as HTMLInputElement).value; });
    (row.querySelector('.damt') as HTMLInputElement).addEventListener('input', (e) => { d.balance = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0); });
    (row.querySelector('.dapr') as HTMLInputElement).addEventListener('input', (e) => { d.apr = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0); });
    (row.querySelector('.dmon') as HTMLInputElement).addEventListener('input', (e) => { d.months = Math.max(1, Math.round(parseFloat((e.target as HTMLInputElement).value) || 1)); });
    (row.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => { store.debts.splice(i, 1); renderDebtList(); });
    el.appendChild(row);
    if (d.paid > 0) {
      const paidRow = document.createElement('div');
      paidRow.style.cssText = 'font-size:11px;color:var(--mint-melt);margin:-4px 0 8px 4px';
      paidRow.textContent = `✓ ${money(d.paid)} paid so far (${Math.round(pctPaid(d) * 100)}% down the hill) — progress you keep`;
      el.appendChild(paidRow);
    }
  });
}

function addDebtRow(): void {
  store.debts.push({ name: '', balance: 0, apr: 19.9, months: 36, paid: 0, celebrated: 0 });
  renderDebtList();
  const rows = document.querySelectorAll('#debtList .dname');
  (rows[rows.length - 1] as HTMLInputElement).focus();
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- HUD ---------- */
export interface HudState {
  left: number;
  pct: number;
  ball: { mult: number; label: string } | null;
  interest: number;
}

export function setHud(h: HudState): void {
  $('hudLeft').innerHTML = 'Left <b>' + money(h.left) + '</b>';
  $('hudBall').textContent = h.ball ? `❄️ ${h.ball.label} ×${h.ball.mult.toFixed(1)}` : '❄️ —';
  $('hudInterest').textContent = '💸 ' + money(stats.interestDestroyed);
  ($('hudBar') as HTMLElement).style.width = Math.round(h.pct * 100) + '%';
}

/* ---------- wiring ---------- */
export function initUI(): void {
  store.load();
  renderDebtList();

  $('addDebtBtn').addEventListener('click', addDebtRow);
  $('loadDemoBtn').addEventListener('click', () => { store.demo(); renderDebtList(); });
  $('startBtn').addEventListener('click', () => {
    store.debts = store.debts.filter((d) => d.balance > 0);
    store.save();
    hideOverlays();
    bus.emit('start');
  });
  $('editBtn').addEventListener('click', showSetup);
  $('resetBtn').addEventListener('click', () => {
    if (confirm('Reset ALL payment progress? Every hill returns to its crest.')) {
      store.resetProgress();
      hideOverlays();
      bus.emit('start');
    }
  });

  $('muteBtn').addEventListener('click', function () {
    setMuted(!isMuted());
    this.textContent = isMuted() ? '🔇' : '🔊';
    try { localStorage.setItem(MUTE_KEY, isMuted() ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  try { if (localStorage.getItem(MUTE_KEY) === '1') { setMuted(true); $('muteBtn').textContent = '🔇'; } } catch (e) { /* ignore */ }

  bus.on('hud', setHud);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('setupOverlay').classList.contains('show')) {
      hideOverlays();
      bus.emit('start');
    }
  });

  // boot: show the editor over the overview
  showSetup();
}
