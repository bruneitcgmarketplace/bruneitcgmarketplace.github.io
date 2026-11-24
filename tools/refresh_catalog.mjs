// Rebuilds public/catalog.json: Yuyutei card list + prices, English names/colours from optcgapi.com.
// Usage: node tools/refresh_catalog.mjs   (about 2 minutes; polite 1.2 s delay between pages)
import { writeFileSync, readFileSync } from 'node:fs';
import { parseSet } from './yuyutei.mjs';

const UA = 'Mozilla/5.0 (Brunei TCG market catalogue refresh)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const prefixes = [['op', 25], ['eb', 12], ['prb', 6], ['st', 40]];
const SETS = prefixes.flatMap(([p, n]) => Array.from({ length: n }, (_, i) => p + pad(i + 1)));
const SET_NAMES = JSON.parse(readFileSync(new URL('./set_names.json', import.meta.url), 'utf8'));

async function fetchSet(set) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://yuyu-tei.jp/sell/opc/s/${set}`, { headers: { 'User-Agent': UA } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseSet(await r.text(), set);
    } catch (e) { if (a === 2) throw new Error(`${set}: ${e.message}`); await sleep(2000 * (a + 1)); }
  }
}

const cards = []; const failed = []; let streak = 0;
for (const s of SETS) {
  try { const rows = await fetchSet(s); if (rows.length) console.log(s, rows.length); cards.push(...rows); streak = 0; } catch (e) { failed.push(s); console.log('FAILED', e.message); if (++streak >= 3) { console.error('Source is blocking this machine (3 failures in a row); stopping early, catalogue not written.'); process.exit(1); } }
  await sleep(1200);
}
if (failed.length) { console.error('Failed sets, not writing:', failed.join(',')); process.exit(1); }

const en = new Map(), info = new Map();
for (const path of ['allSetCards', 'allSTCards', 'allPromoCards']) {
  try {
    const list = await (await fetch(`https://optcgapi.com/api/${path}/`, { headers: { 'User-Agent': UA } })).json();
    for (const c of list) if (!en.has(c.card_set_id)) { en.set(c.card_set_id, c.card_name); info.set(c.card_set_id, [c.card_color || '', c.card_type || '']); }
  } catch (e) { console.warn('optcgapi', path, e.message); }
}
const clean = (s) => { let t = s; for (;;) { const n = t.replace(/\s*\([^)]*\)\s*$/, ''); if (n === t || !n) return t; t = n; } };
const rows = cards.map((c) => { const num = c.id.split('-').pop(); const [col, typ] = info.get(c.code) || ['', '']; return [num, c.set, c.code, c.name, c.rarity, c.price_jpy || 0, clean(en.get(c.code) || ''), col, typ]; });
const sets = {}; for (const s of new Set(rows.map((r) => r[1]))) sets[s] = SET_NAMES[s] || s.toUpperCase();
writeFileSync(new URL('../public/catalog.json', import.meta.url), JSON.stringify({ updated: new Date().toISOString(), sets, cards: rows }));
console.log('cards', rows.length, 'sets', Object.keys(sets).length, 'no English name', rows.filter((r) => !r[6]).length);
