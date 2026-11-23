// Yuyutei One Piece (opc) scraper. Zero deps.
const UA = 'Mozilla/5.0 (OPTCG-Inventory personal use)';
export const SETS = [
  ...Array.from({ length: 14 }, (_, i) => 'op' + String(i + 1).padStart(2, '0')),
  ...Array.from({ length: 30 }, (_, i) => 'st' + String(i + 1).padStart(2, '0')),
  'eb01', 'eb02', 'eb03', 'prb01', 'prb02', 'promo',
];

export function parseSet(html, set) {
  const out = [];
  const starts = [...html.matchAll(/class="card-product[^"]*"/g)].map(m => m.index);
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i], starts[i + 1] ?? html.length);
    const id = chunk.match(/\/sell\/opc\/card\/(\w+)\/(\d+)/);
    const alt = chunk.match(/alt="([^"]+)"\s+class="card img-fluid"/);
    const img = chunk.match(/src="(https:\/\/card\.yuyu-tei\.jp[^"]+)"/);
    const price = chunk.match(/<strong[^>]*>\s*([\d,]+)\s*円/);
    const stock = chunk.match(/在庫\s*:\s*(\d+)/);
    if (!id || !alt || !price) continue;
    const parts = alt[1].trim().split(/\s+/);
    const code = parts[0];
    const rarity = parts[1] || '';
    const name = parts.slice(2).join(' ') || code;
    out.push({
      id: `${id[1]}-${id[2]}`, set: id[1], code, rarity, name,
      image: img ? img[1].replace('100_140', '200_280') : null,
      url: `https://yuyu-tei.jp/sell/opc/card/${id[1]}/${id[2]}`,
      price_jpy: parseInt(price[1].replace(/,/g, ''), 10),
      stock: stock ? parseInt(stock[1], 10) : null,
    });
  }
  return out;
}

export async function fetchSet(set) {
  const r = await fetch(`https://yuyu-tei.jp/sell/opc/s/${set}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  return parseSet(await r.text(), set);
}

export async function fetchRates() {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=JPY&symbols=USD,SGD');
    const j = await r.json();
    return j.rates; // SGD ~ BND (pegged 1:1)
  } catch { return null; }
}
