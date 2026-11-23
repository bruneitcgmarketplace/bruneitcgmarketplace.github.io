// Same-origin Home feed generator. Node >=22, no runtime dependencies.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCES = Object.freeze({
  // /topics/ is the archive (last item April 2026); the root renders the current NEWS list.
  news: 'https://asia-en.onepiece-cardgame.com/',
  yuyutei: 'https://yuyu-tei.jp/top/opc',
  releases: 'https://www.onepiece-cardgame.com/products/',
});

function decode(value = '') {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return entities[entity] ?? whole;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}
function text(value = '') { return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'is'));
  return match ? decode(match[2]) : '';
}
function hasClass(tag, name) { return attr(tag, 'class').split(/\s+/).includes(name); }
function safeUrl(value, source, hosts) {
  try {
    const url = new URL(value, source);
    return value && url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
function isoDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function englishDate(value) {
  const match = text(value).match(/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/);
  return match ? isoDate(match[3], ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(match[1]) + 1, match[2]) : null;
}
function classContent(html, tag, className) {
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) {
    if (hasClass(match[0].slice(0, match[0].indexOf('>') + 1), className)) return match[1];
  }
  return '';
}

export const YUYUTEI_DESCRIPTION = 'Latest-expansion cards shown by Yuyutei, in shop display order. Individual card-added dates are not provided.';

// Balance nested divs: do not accidentally include sales/restock sections that follow.
function divById(html, id) {
  const tags = [...html.matchAll(/<\/?div\b[^>]*>/gi)];
  const start = tags.findIndex(match => attr(match[0], 'id') === id);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < tags.length; i++) {
    depth += /^<\//.test(tags[i][0]) ? -1 : 1;
    if (depth === 0) return html.slice(tags[start].index, tags[i].index + tags[i][0].length);
  }
  return '';
}

export function parseYuyuteiCards(html, { limit = 12 } = {}) {
  const section = divById(html, 'newestCardList');
  const items = [];
  const seen = new Set();
  for (const match of section.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const chunk = match[0];
    const url = safeUrl(attr(chunk.slice(0, chunk.indexOf('>') + 1), 'href'), SOURCES.yuyutei, ['yuyu-tei.jp']);
    const img = chunk.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const image = safeUrl(attr(img, 'src'), SOURCES.yuyutei, ['card.yuyu-tei.jp']);
    const alt = text(attr(img, 'alt')).match(/^([A-Z]+\d*-\d+)\s+\S+\s+(.+)$/);
    const title = text(chunk.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '') || alt?.[2];
    if (!url || !/^\/sell\/opc\/card\/[a-z0-9_-]+\/\d+$/.test(new URL(url).pathname) || !image || !alt || !title || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, code: alt[1], image, url, added_at: null });
  }
  if (!items.length) throw new Error('Yuyutei source contained no valid latest-expansion carousel cards');
  return items.slice(0, limit);
}

export function bruneiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Brunei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseUpcomingReleases(html, { today = bruneiDate(), limit = 6 } = {}) {
  const items = [];
  const seen = new Set();
  let datedProducts = 0;
  for (const match of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const chunk = match[0];
    const opening = chunk.slice(0, chunk.indexOf('>') + 1);
    if (!hasClass(opening, 'linkListColBox') || !['boosters', 'decks'].includes(attr(opening, 'data-cat'))) continue;
    const title = text(classContent(chunk, 'h4', 'linkListColTitle'));
    const rawDate = attr(chunk.match(/<time\b[^>]*>/i)?.[0] ?? '', 'datetime');
    const parts = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const release_date = parts ? isoDate(...parts.slice(1)) : null;
    const url = safeUrl(attr(chunk.match(/<a\b[^>]*>/i)?.[0] ?? '', 'href'), SOURCES.releases, ['www.onepiece-cardgame.com']);
    const img = chunk.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const image = safeUrl(attr(img, 'data-src') || attr(img, 'src'), SOURCES.releases, ['www.onepiece-cardgame.com']);
    if (!title || !release_date || !url || seen.has(url)) continue;
    datedProducts++;
    seen.add(url);
    if (release_date < today) continue;
    items.push({ title, url, release_date, ...(image ? { image } : {}), region: 'Japan' });
  }
  if (!datedProducts) throw new Error('Japan source contained no valid dated booster/deck products');
  return items.sort((a, b) => a.release_date.localeCompare(b.release_date)).slice(0, limit);
}

const ITEM_HOSTS = { news: ['asia-en.onepiece-cardgame.com', 'join.carddass.com'], yuyutei: ['yuyu-tei.jp'], releases: ['www.onepiece-cardgame.com'] };
const IMAGE_HOSTS = { news: ['asia-en.onepiece-cardgame.com'], yuyutei: ['card.yuyu-tei.jp'], releases: ['www.onepiece-cardgame.com'] };
function validDate(value) {
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return !!parts && isoDate(...parts.slice(1)) === value;
}
function validSection(key, section) {
  if (!section || section.source !== SOURCES[key] || typeof section.checked_at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(section.checked_at) || !Number.isFinite(Date.parse(section.checked_at)) || !Array.isArray(section.items) || !section.items.length) return false;
  if (key === 'yuyutei' && (typeof section.description !== 'string' || !section.description.trim())) return false;
  return section.items.every(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || typeof item.url !== 'string' || safeUrl(item.url, SOURCES[key], ITEM_HOSTS[key]) !== item.url) return false;
    if (item.image != null && (typeof item.image !== 'string' || safeUrl(item.image, SOURCES[key], IMAGE_HOSTS[key]) !== item.image)) return false;
    if (key === 'news') return validDate(item.published_at);
    if (key === 'releases') return validDate(item.release_date) && item.region === 'Japan';
    return (item.added_at === null || validDate(item.added_at)) && typeof item.image === 'string' && /^\/sell\/opc\/card\/[a-z0-9_-]+\/\d+$/.test(new URL(item.url).pathname);
  });
}
export function mergePreviousFeeds(local = {}, deployed = {}) {
  const merged = {};
  for (const key of Object.keys(SOURCES)) {
    for (const candidate of [local?.[key], deployed?.[key]]) {
      if (validSection(key, candidate) && (!merged[key] || Date.parse(candidate.checked_at) > Date.parse(merged[key].checked_at))) merged[key] = structuredClone(candidate);
    }
  }
  return merged;
}

export async function refreshHomeFeed({ previous = {}, deployed = {}, fetchText, now = new Date(), evidenceDir } = {}) {
  const feed = mergePreviousFeeds(previous, deployed);
  const errors = [];
  const parsers = { news: parseOfficialNews, yuyutei: parseYuyuteiCards, releases: html => parseUpcomingReleases(html, { today: bruneiDate(now) }) };
  await Promise.all(Object.entries(SOURCES).map(async ([section, source]) => {
    try {
      const html = await fetchText(source);
      if (evidenceDir) {
        await mkdir(evidenceDir, { recursive: true });
        await writeFile(resolve(evidenceDir, `${section}.html`), html, 'utf8');
      }
      const items = parsers[section](html);
      feed[section] = { source, checked_at: now.toISOString(), items, ...(section === 'yuyutei' ? { description: YUYUTEI_DESCRIPTION } : {}) };
    } catch (error) { errors.push({ section, message: error.message }); }
  }));
  // Retain source/check provenance on failure, but never label a past release upcoming.
  if (feed.releases) feed.releases.items = feed.releases.items.filter(item => item.release_date >= bruneiDate(now)).sort((a, b) => a.release_date.localeCompare(b.release_date)).slice(0, 6);
  // Timestamp means freshest successful section, never the time of a failed attempt.
  const checked = Object.values(feed).map(section => section.checked_at).sort((a, b) => Date.parse(b) - Date.parse(a));
  if (checked.length) feed.updated_at = checked[0];
  return { feed, errors };
}

export function parseOfficialNews(html, { limit = 6 } = {}) {
  const items = [];
  const seen = new Set();
  for (const match of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const chunk = match[0];
    const opening = chunk.slice(0, chunk.indexOf('>') + 1);
    const renewed = hasClass(opening, 'newsListItem');
    if (!renewed && !hasClass(opening, 'topicDetail')) continue;
    const title = renewed ? text(classContent(chunk, 'h4', 'newsTitle') || classContent(chunk, 'h3', 'newsTitle')) : text(classContent(chunk, 'span', 'js_topicTit'));
    const rawDate = attr(chunk.match(/<time\b[^>]*>/i)?.[0] ?? '', 'datetime').slice(0, 10);
    const dateParts = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const published_at = renewed ? (dateParts ? isoDate(...dateParts.slice(1)) : null) : englishDate(classContent(chunk, 'dd', 'topicDate'));
    const url = safeUrl(attr(chunk.match(/<a\b[^>]*>/i)?.[0] ?? '', 'href'), SOURCES.news, ['asia-en.onepiece-cardgame.com', 'join.carddass.com']);
    const img = chunk.match(/<img\b[^>]*>/i)?.[0] ?? '';
    const image = safeUrl(attr(img, 'data-src') || attr(img, 'src'), SOURCES.news, ['asia-en.onepiece-cardgame.com']);
    if (!title || !published_at || !url || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, url, published_at, ...(image ? { image } : {}) });
  }
  items.sort((a, b) => b.published_at.localeCompare(a.published_at));
  if (!items.length) throw new Error('Official source contained no valid dated topics');
  return items.slice(0, limit);
}

export async function main({
  output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/home-feed.json'),
  previousUrl = process.env.HOME_FEED_PREVIOUS_URL,
  fetchText = fetchSource,
  evidenceDir = process.env.HOME_FEED_EVIDENCE_DIR,
  now = new Date(),
} = {}) {
  let previous = {};
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let deployed = {};
  let baselineWarning;
  if (previousUrl) {
    try {
      const url = new URL(previousUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Previous feed URL must be HTTPS without credentials');
      deployed = JSON.parse(await fetchText(url.href));
    } catch (error) { baselineWarning = `Deployed baseline unavailable: ${error.message}`; }
  }
  const result = await refreshHomeFeed({ previous, deployed, fetchText, evidenceDir, now });
  if (!result.feed.updated_at) throw new Error(`No live source or valid last-good feed available: ${result.errors.map(error => `${error.section}: ${error.message}`).join('; ')}`);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(result.feed, null, 2) + '\n', 'utf8');
  await rename(temporary, output);
  if (evidenceDir) await writeFile(resolve(evidenceDir, 'extraction.json'), JSON.stringify({ attempted_at: now.toISOString(), ...result }, null, 2) + '\n', 'utf8');
  return { ...result, output, baselineWarning };
}

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (BruneiTCG source feed refresh)', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const body = await response.text();
  if (!body.trim() || body.length > 4_000_000) throw new Error(`Empty or oversized source response from ${url}`);
  return body;
}

// Importing the parsers has no network or filesystem side effects.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(({ feed, errors, output, baselineWarning }) => {
    if (baselineWarning) console.warn(baselineWarning);
    for (const error of errors) console.warn(`${error.section}: ${error.message}; keeping last-good section when available`);
    console.log(JSON.stringify({ output, updated_at: feed.updated_at, counts: Object.fromEntries(Object.keys(SOURCES).map(key => [key, feed[key]?.items.length ?? 0])), errors }, null, 2));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
