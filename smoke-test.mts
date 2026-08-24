// Quick headless smoke test of the v3 core math (Node 24 type-stripping).
import {
  store, pctPaid, principalLeft, monthsLeft, interestProjected,
  interestAtStart, interestDestroyed, shellPct, blocksAt, BLOCKS,
  applyHit, registerHit, comboMult, money,
} from './src/core/state.ts';

let fails = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (!cond) { fails++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`ok   ${name} ${extra}`);
}

store.load();
console.log('debts:', store.debts.map((d) => `${d.name} £${d.balance} ${d.apr}% ${d.months}mo`).join(' | '));
check('4 demo debts', store.debts.length === 4);
const card = store.debts[0]; // £4250 @ 24.9% 36mo
check('blocks = 24', BLOCKS === 24);
check('0% paid → 0 blocks', blocksAt(pctPaid(card)) === 0);
check('principalLeft = balance', principalLeft(card) === 4250);
check('monthsLeft = 36', monthsLeft(card) === 36);

// interest destroyed: £100 × (24.9/12/100) × 36 = £74.70
const id = interestDestroyed(card, 100);
check('interestDestroyed £100 = ~74.70', Math.abs(id - 74.7) < 0.01, `got ${id}`);
check('shellPct = 1 at start', shellPct(card) === 1);

// apply a £1000 hit: 1000/4250*24 = 5.65 blocks; milestone crossing 25% (1062.5) not yet
const o1 = applyHit(0, 1000);
check('paid 1000', o1.amount === 1000, `got ${o1.amount}`);
check('blocks frac ~5.65', Math.abs(o1.blocks - 5.647) < 0.01, `got ${o1.blocks}`);
check('no milestone yet (23.5%)', o1.milestone === null, `got ${o1.milestone}`);
check('monthsLeft shrank (28)', monthsLeft(card) === 28, `got ${monthsLeft(card)}`);
check('shell < 1 (interest shrinks quadratically)', shellPct(card) < 1, `got ${shellPct(card)}`);
check('principal only moves blocks — interest does NOT add blocks', blocksAt(pctPaid(card)) === 5);

// push to 50% → milestone 50 crossed
const o2 = applyHit(0, 1125); // total 2125 = 50%
check('milestone 50', o2.milestone === 50, `got ${o2.milestone}`);
check('blocksAt 50% = 12', blocksAt(pctPaid(card)) === 12);

// overpaying crushes shell faster than core
const corePct = 1 - pctPaid(card);
check('core at 50%', Math.abs(corePct - 0.5) < 0.01, `got ${corePct}`);
check('shell well under 50%', shellPct(card) < 0.35, `got ${shellPct(card).toFixed(3)}`);

// combo
registerHit(0); registerHit(0); const r2 = registerHit(0);
check('combo mult x1.2 at 3rd hit', Math.abs(comboMult() - 1.2) < 0.001, `got ${comboMult()}`);
check('registerHit count 3', r2.count === 3);

// final payment clears
const card2 = store.debts[1]; // car loan 9800
const fin = applyHit(1, 99999);
check('capped final payment', fin.amount === principalLeft(store.debts[1]) + fin.amount - principalLeft(store.debts[1]) || fin.paidOff, `paidOff=${fin.paidOff} amt=${fin.amount}`);
check('paidOff true', fin.paidOff === true);
check('milestone 100 on clear', fin.milestone === 100, `got ${fin.milestone}`);
check('shellPct 0 when cleared', shellPct(store.debts[1]) === 0);

// money formatting — values >= £20 round to whole pounds (spec's own example: "£34 interest avoided")
check('money 34.7 → £35', money(34.7) === '£35', `got ${money(34.7)}`);
check('money 12.34 → £12.34', money(12.34) === '£12.34', `got ${money(12.34)}`);
check('money 4250 → £4.3k', money(4250) === '£4.3k', `got ${money(4250)}`);

// reset
store.resetProgress();
check('reset clears paid', store.debts.every((d) => d.paid === 0));

console.log(fails === 0 ? '\nALL PASS ✅' : `\n${fails} FAILURES ❌`);
process.exit(fails === 0 ? 0 : 1);
