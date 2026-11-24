// "Mark as sold" dialog with the optional agreed sale price.
import { sheet, esc, bnd } from './lib.js';
import { listPrice, fmtDelta } from './receipt.js';

// Resolves {price} (null = sold at the listing price) or null if cancelled.
export function soldSheet(l) {
  return new Promise((res) => {
    const lp = listPrice(l), bn = l.type === 'buy_now';
    const s = sheet(`<h2>Mark this card as sold?</h2>
      <p>Confirm you have met the buyer and been paid. This completes the deal and takes one copy off your inventory if you track it.</p>
      ${bn ? `<label for="sp-in">Agreed sale price in BND (optional)</label>
        <input id="sp-in" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="${esc(lp.toFixed(2))}">
        <p class="muted" id="sp-note">Leave it empty if you sold at the listing price (${bnd(lp)}). Fill it in only if the price changed after negotiation.</p>
        <div class="notice err" id="sp-err" style="display:none"></div>` : ''}
      <div class="row tight"><button class="btn ok" id="sp-ok">Sold</button><button class="btn sec" id="sp-no">Cancel</button></div>`, { onClose: () => res(null) });
    const inp = s.el.querySelector('#sp-in'), note = s.el.querySelector('#sp-note'), err = s.el.querySelector('#sp-err');
    const parse = () => { const v = (inp?.value || '').trim(); if (v === '') return { empty: true }; const n = Math.round(Number(v) * 100) / 100; return n > 0 && n <= 99999999 ? { n } : { bad: true }; };
    if (inp) inp.oninput = () => {
      err.style.display = 'none'; const p = parse();
      if (p.empty) note.textContent = `Leave it empty if you sold at the listing price (${bnd(lp)}). Fill it in only if the price changed after negotiation.`;
      else if (p.bad) note.textContent = 'Enter an amount above 0.';
      else { const d = Math.round((p.n - lp) * 100) / 100; note.textContent = d === 0 ? `Same as the listing price (${bnd(lp)}).` : `Agreed ${bnd(p.n)}: ${fmtDelta({ delta: d, pct: lp ? (d / lp) * 100 : 0 })} from listing price ${bnd(lp)}.`; }
    };
    s.el.querySelector('#sp-ok').onclick = () => {
      const p = bn ? parse() : { empty: true };
      if (p.bad) { err.textContent = 'Enter an agreed price above 0, or leave it empty to use the listing price.'; err.style.display = ''; return; }
      res({ price: p.empty ? null : p.n }); s.close();
    };
    s.el.querySelector('#sp-no').onclick = () => s.close();
  });
}
