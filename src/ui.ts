/* ---------- DOM UI layer: debt editor + "pay it now" preview + hit result.
   Talks to scenes via the shared event bus. ---------- */
import {
  store, principalLeft, pctPaid, monthsLeft, interestDestroyed,
  BLOCKS, MILESTONES, money, prefs, MUTE_KEY,
} from './core/state';
import { isMuted, setMuted } from './core/audio';
import { bus } from './core/bus';
import type { RollStats } from './scenes/RollScene';

function $(id: string): HTMLElement { return document.getElementById(id)!; }

/* ---------- overlay helpers ---------- */
export function hideOverlays(): void {
  $('setupOverlay').classList.remove('show');
  $('previewOverlay').classList.remove('show');
  $('resultOverlay').classList.remove('show');
}

function showSetup(): void {
  hideOverlays();
  renderDebtList();
  $('setupOverlay').classList.add('show');
}

/* ---------- debt editor (now with APR + months) ---------- */
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
      paidRow.textContent = `✓ ${money(d.paid)} paid so far (${Math.round(pctPaid(d) * 100)}%) — this is progress you keep`;
      el.appendChild(paidRow);
    }
  });
}

function addDebtRow(): void {
  store.debts.push({ name: '', balance: 0, apr: 19.9, months: 36, paid: 0 });
  renderDebtList();
  const rows = document.querySelectorAll('#debtList .dname');
  (rows[rows.length - 1] as HTMLInputElement).focus();
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- "pay it now" preview (before committing a hit) ---------- */
function showPreview(idx: number): void {
  const d = store.debts[idx];
  if (!d) return;
  const cap = Math.min(prefs.chip, principalLeft(d));
  const blocksFrac = (cap / d.balance) * BLOCKS;
  const interest = interestDestroyed(d, cap);
  const paid = pctPaid(d);
  const nextMilestone = MILESTONES.find((t) => t > paid);
  const hitsToNext = nextMilestone
    ? Math.max(1, Math.ceil((nextMilestone * d.balance - d.paid) / cap))
    : 0;

  $('prevTitle').textContent = `Attack: ${esc(d.name)}`;
  $('prevMeta').innerHTML =
    `<span>${money(principalLeft(d))} left</span> · <span>APR ${d.apr}%</span> · ` +
    `<span>${monthsLeft(d)}mo left</span> · <span>${Math.round(paid * 100)}% cleared</span>`;
  $('prevChip').textContent = `Paying ${money(cap)} this hit`;
  $('prevBlocks').innerHTML = `<b>${blocksFrac.toFixed(2)}</b> blocks of principal removed`;
  $('prevInterest').innerHTML = `avoids <b>${money(interest)}</b> of future interest`;
  $('prevMilestone').textContent = nextMilestone
    ? `Next milestone: ${Math.round(nextMilestone * 100)}% in ~${hitsToNext} hit${hitsToNext > 1 ? 's' : ''}`
    : 'Final payment — this clears the debt 🎉';
  $('prevTip').textContent = 'This payment is worth more now than it will be in 6 months. Steer into the crack during the roll for a bigger interest bonus.';
  hideOverlays();
  $('previewOverlay').classList.add('show');
}

/* ---------- hit result readout ---------- */
function showResult(s: RollStats): void {
  const critTag = s.crit === 'late' ? 'CRIT ×2!' : s.crit === 'early' ? 'Solid ×1.25' : '';
  const comboLine = s.comboCount > 1
    ? `Combo ×${s.comboMult.toFixed(1)} (${s.comboCount}-hit streak)`
    : 'Combo starts now — hit again to build it';

  $('resTitle').textContent = s.paidOff
    ? `${esc(s.debtName)} — PAID OFF! 🎉`
    : `Hit landed on ${esc(s.debtName)}`;
  $('resPrincipal').innerHTML = `${money(s.amount)}<span class="res-sub">principal · ${s.blocks.toFixed(2)} blocks</span>`;
  $('resInterest').innerHTML = `${money(s.interestTotal)}<span class="res-sub">interest avoided</span>`;
  $('resCrit').textContent = critTag;
  $('resCrit').style.display = critTag ? '' : 'none';
  $('resCombo').textContent = comboLine;
  $('resMilestone').textContent = s.milestone
    ? (s.milestone === 100 ? '💸 DEBT CLEARED — no more interest on this one!' : `🏔 ${s.milestone}% MILESTONE — tower cracked!`)
    : '';
  $('resLeft').textContent = s.paidOff ? '0 left' : `${money(s.left)} left · ${Math.round(s.pct * 100)}% cleared`;
  $('resInterestDetail').textContent = s.crit === 'none' && s.comboMult === 1
    ? `${money(s.interest)} base interest avoided`
    : `${money(s.interest)} base × ${s.critMult}${s.crit === 'none' ? '' : ' crit'} × ${s.comboMult.toFixed(1)} combo`;
  hideOverlays();
  $('resultOverlay').classList.add('show');
}

/* ---------- HUD ---------- */
export interface HudState {
  left: number;
  pct: number;
  combo: number;
  mult: number;
  interest: number;
}

export function setHud(h: HudState): void {
  $('hudLeft').innerHTML = 'Left <b>' + money(h.left) + '</b>';
  $('hudCombo').textContent = h.combo > 1 ? `Combo ×${h.mult.toFixed(1)}` : 'Combo —';
  $('hudInterest').textContent = '💸 ' + money(h.interest);
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
    if (confirm('Reset ALL payment progress? Towers return to 0%.')) {
      store.resetProgress();
      hideOverlays();
      bus.emit('start');
    }
  });

  // preview actions
  $('rollBtn').addEventListener('click', () => {
    hideOverlays();
    bus.emit('roll-confirm');
  });
  $('cancelBtn').addEventListener('click', () => {
    hideOverlays();
    bus.emit('roll-cancel');
  });

  // result actions
  $('againBtn').addEventListener('click', () => {
    hideOverlays();
    bus.emit('hit-again');
  });
  $('overviewBtn').addEventListener('click', () => {
    hideOverlays();
    bus.emit('to-overview');
  });
  $('resultEditBtn').addEventListener('click', () => {
    hideOverlays();
    bus.emit('to-overview');
    showSetup();
  });

  $('muteBtn').addEventListener('click', function () {
    setMuted(!isMuted());
    this.textContent = isMuted() ? '🔇' : '🔊';
    try { localStorage.setItem(MUTE_KEY, isMuted() ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  try { if (localStorage.getItem(MUTE_KEY) === '1') { setMuted(true); $('muteBtn').textContent = '🔇'; } } catch (e) { /* ignore */ }

  // scene → UI events
  bus.on('preview', showPreview);
  bus.on('result', showResult);
  bus.on('hud', setHud);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('setupOverlay').classList.contains('show')) return;
      if ($('previewOverlay').classList.contains('show')) {
        hideOverlays();
        bus.emit('roll-cancel');
        return;
      }
      if ($('resultOverlay').classList.contains('show')) {
        hideOverlays();
        bus.emit('to-overview');
        return;
      }
    }
  });

  // boot: show the editor over the overview
  showSetup();
}
