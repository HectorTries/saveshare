/* ---------- DOM UI layer (overlays + HUD), talks to GameScene via bridge ---------- */
import { store, fmt, MUTE_KEY } from './core/state';
import { isMuted, setMuted } from './core/audio';
import { bridge } from './bridge';

export interface HudState {
  goal: number;
  pot: number;
  shots: number;
  time: string;
  bar: number;
}

export interface WinStats {
  emoji: string;
  title: string;
  sub: string;
  stars: string;
  rank: string;
  pot: number;
  shots: number;
  time: string;
  interest: number;
}

let goal = 15;
let payDebtIdx = 0;

function $(id: string): HTMLElement { return document.getElementById(id)!; }

/* ---------- overlay helpers ---------- */
export function hideOverlays(): void {
  $('setupOverlay').classList.remove('show');
  $('paymentOverlay').classList.remove('show');
  $('roundOverlay').classList.remove('show');
}

function showSetup(): void {
  hideOverlays();
  $('setupOverlay').classList.add('show');
  renderDebtList();
}

function showPayment(): void {
  hideOverlays();
  // debt picker
  const wrap = $('payDebtWrap');
  let html = '<label style="font-size:12px;color:var(--muted)">Paying toward</label><select id="payDebt" style="width:100%;margin-top:4px">';
  store.debts.forEach((d, i) => {
    const left = Math.max(0, d.amount - (d.paid || 0));
    html += `<option value="${i}">${esc(d.name || ('Debt ' + (i + 1)))} — £${fmt(left)} left</option>`;
  });
  html += '</select>';
  wrap.innerHTML = html;
  $('payDebt').addEventListener('change', (e) => { payDebtIdx = parseInt((e.target as HTMLSelectElement).value, 10); });
  // chips
  const chips = [5, 10, 15, 25, 50, 100];
  const chipWrap = $('payChips');
  chipWrap.innerHTML = '';
  chips.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'chip' + (v === goal ? ' active' : '');
    b.textContent = '£' + v;
    b.onclick = () => {
      goal = v;
      chipWrap.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    };
    chipWrap.appendChild(b);
  });
  (($('customPay')) as HTMLInputElement).value = '';
  $('paymentOverlay').classList.add('show');
}

function startRun(): void {
  const custom = parseInt(($('customPay') as HTMLInputElement).value || '0', 10);
  if (custom > 0) goal = custom;
  const sel = $('payDebt') as HTMLSelectElement | null;
  if (sel) payDebtIdx = parseInt(sel.value, 10);
  goal = Math.max(1, Math.min(10000, goal));
  hideOverlays();
  store.save();
  if (bridge.onStartRun) bridge.onStartRun(goal, payDebtIdx);
}

function editDebts(): void {
  hideOverlays();
  showSetup();
}

/* ---------- HUD ---------- */
export function setHud(h: HudState): void {
  $('hudGoal').textContent = 'Goal: £' + h.goal;
  $('hudPot').innerHTML = 'Pot <b>£' + fmt(h.pot) + '</b>';
  $('hudShots').textContent = 'Shots: ' + h.shots;
  $('hudTime').textContent = h.time;
  ($('hudBar') as HTMLElement).style.width = h.bar + '%';
}

export function setRoundInfo(txt: string): void {
  $('roundInfo').textContent = txt;
}

/* ---------- win screen ---------- */
export function showWin(s: WinStats): void {
  $('roundEmoji').textContent = s.emoji;
  $('roundTitle').textContent = s.title;
  $('roundSub').textContent = s.sub;
  $('winStars').textContent = s.stars;
  $('winRank').textContent = s.rank;
  $('winPot').textContent = '£' + s.pot;
  $('winShots').textContent = String(s.shots);
  $('winTime').textContent = s.time;
  $('winInterest').textContent = '£' + s.interest;
  hideOverlays();
  $('roundOverlay').classList.add('show');
}

/* ---------- debt editor ---------- */
function renderDebtList(): void {
  const el = $('debtList');
  el.innerHTML = '';
  store.debts.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'debt-row';
    const left = Math.max(0, d.amount - (d.paid || 0));
    row.innerHTML = `
      <input class="dname" type="text" placeholder="e.g. Credit Card" value="${esc(d.name)}">
      <input class="damt" type="number" min="1" step="50" placeholder="£ amount" value="${d.amount || ''}">
      <button class="del-btn" title="Remove">✕</button>`;
    (row.querySelector('.dname') as HTMLInputElement).addEventListener('input', (e) => { d.name = (e.target as HTMLInputElement).value; });
    (row.querySelector('.damt') as HTMLInputElement).addEventListener('input', (e) => { d.amount = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0); });
    (row.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => { store.debts.splice(i, 1); renderDebtList(); });
    el.appendChild(row);
    if (d.paid > 0) {
      const paidRow = document.createElement('div');
      paidRow.style.cssText = 'font-size:11px;color:var(--mint-melt);margin:-4px 0 8px 4px';
      paidRow.textContent = `✓ £${fmt(d.paid)} paid so far`;
      el.appendChild(paidRow);
    }
  });
}

function addDebtRow(): void {
  store.debts.push({ name: '', amount: 0, paid: 0, towerX: 0, tw: 0, blocks: [], topY: 0 });
  renderDebtList();
  const rows = document.querySelectorAll('#debtList .dname');
  (rows[rows.length - 1] as HTMLInputElement).focus();
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- wiring ---------- */
export function initUI(): void {
  store.load();
  renderDebtList();

  $('addDebtBtn').addEventListener('click', addDebtRow);
  $('toPaymentBtn').addEventListener('click', () => { hideOverlays(); showPayment(); });
  $('loadDemoBtn').addEventListener('click', () => { store.demo(); renderDebtList(); });
  $('startRunBtn').addEventListener('click', startRun);
  $('backEditBtn').addEventListener('click', editDebts);
  $('againBtn').addEventListener('click', () => { hideOverlays(); showPayment(); });
  $('winEditBtn').addEventListener('click', editDebts);
  $('editBtn').addEventListener('click', editDebts);
  $('resetBtn').addEventListener('click', () => { if (bridge.onReset) bridge.onReset(); });
  $('muteBtn').addEventListener('click', function () {
    setMuted(!isMuted());
    this.textContent = isMuted() ? '🔇' : '🔊';
    try { localStorage.setItem(MUTE_KEY, isMuted() ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  try { if (localStorage.getItem(MUTE_KEY) === '1') { setMuted(true); $('muteBtn').textContent = '🔇'; } } catch (e) { /* ignore */ }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('setupOverlay').classList.contains('show')) return;
      if ($('paymentOverlay').classList.contains('show')) { editDebts(); return; }
      if ($('roundOverlay').classList.contains('show')) { showPayment(); return; }
      showPayment();
    }
    if (e.key === 'r' || e.key === 'R') { if (bridge.onReset) bridge.onReset(); }
  });
}
