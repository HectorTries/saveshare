/* ---------- DOM UI layer: debt editor + top HUD.
   The game loop itself (pay → roll → readout) lives entirely in
   the Phaser scenes; DOM only handles setup and the persistent
   top bar. ---------- */
import { store, money, prefs, MUTE_KEY, stats, levelsCleared } from './core/state';
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
    const card = document.createElement('div');
    card.className = 'debt-card';
    card.innerHTML = `
      <div class="debt-head">
        <input class="dname" type="text" placeholder="Debt name (e.g. Credit Card)" value="${esc(d.name)}">
        <button class="del-btn" title="Remove debt">✕</button>
      </div>
      <div class="debt-grid">
        <label class="field"><span>Balance (£)</span><input class="damt" type="number" min="1" step="50" value="${d.balance || ''}"></label>
        <label class="field"><span>APR %</span><input class="dapr" type="number" min="0" max="100" step="0.1" value="${d.apr ?? ''}"></label>
        <label class="field"><span>Term</span><span class="term-wrap"><input class="dmon" type="number" min="1" max="600" step="1" value="${d.months || ''}"><select class="dunit"><option value="months">months</option><option value="years">years</option></select></span></label>
        <label class="field"><span>Monthly (£)</span><input class="dmonth" type="number" min="0" step="5" value="${d.monthly || ''}"></label>
      </div>`;
    const dmon = card.querySelector('.dmon') as HTMLInputElement;
    const dunit = card.querySelector('.dunit') as HTMLSelectElement;
    const dmonth = card.querySelector('.dmonth') as HTMLInputElement;
    (card.querySelector('.dname') as HTMLInputElement).addEventListener('input', (e) => { d.name = (e.target as HTMLInputElement).value; });
    (card.querySelector('.damt') as HTMLInputElement).addEventListener('input', (e) => { d.balance = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0); });
    (card.querySelector('.dapr') as HTMLInputElement).addEventListener('input', (e) => { d.apr = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0); });
    dmon.addEventListener('input', () => { d.months = Math.max(1, Math.round(parseFloat(dmon.value) || 1) * (dunit.value === 'years' ? 12 : 1)); });
    dunit.addEventListener('change', () => {
      // convert the displayed number between units, keep stored months intact
      dmon.value = String(dunit.value === 'years' ? Math.max(1, Math.round(d.months / 12)) : d.months);
    });
    dmonth.addEventListener('input', () => { d.monthly = Math.max(0, parseFloat(dmonth.value) || 0); });
    (card.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => { store.debts.splice(i, 1); renderDebtList(); });
    el.appendChild(card);
    if (d.paid > 0) {
      const paidRow = document.createElement('div');
      paidRow.style.cssText = 'font-size:11px;color:var(--mint-melt);margin:-4px 0 8px 4px';
      paidRow.textContent = `✓ ${money(d.paid)} paid so far (Level ${levelsCleared(d)}/100) — progress you keep`;
      el.appendChild(paidRow);
    }
  });
}

function addDebtRow(): void {
  store.debts.push({ name: '', balance: 0, apr: 19.9, months: 36, monthly: 0, paid: 0, celebrated: 0 });
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
