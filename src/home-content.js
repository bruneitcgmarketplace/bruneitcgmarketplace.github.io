const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString('en-GB') : '—';
// Brunei time (GMT+8) for a price/refresh stamp. ISO timestamp -> '24 Nov 2026, 14:05 GMT+8'; old date-only value -> date with a note.
export function fmtBrunei(iso) {
  if (!iso) return 'not available';
  const s = String(iso);
  if (!s.includes('T')) return s + ' (time not recorded)';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Brunei', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' GMT+8';
}
export function renderHomeStats({signed,totalCards,listingCount,auctionCount}) {
  return `<div class="stats home-stats">
    <a class="stat" href="#/inventory"><b>${signed ? count(totalCards) : '—'}</b><span>Total card collection</span><small>${signed ? totalCards == null ? 'Temporarily unavailable' : 'Cards in your collection' : 'Sign in to view your cards'}</small></a>
    <a class="stat" href="#/market?type=buy_now"><b>${count(listingCount)}</b><span>Live listing</span><small>${listingCount == null ? 'Temporarily unavailable' : 'Buy-now listings'}</small></a>
    <a class="stat" href="#/market?type=auction"><b>${count(auctionCount)}</b><span>Live auction</span><small>${auctionCount == null ? 'Temporarily unavailable' : 'Open for bidding'}</small></a>
  </div>`;
}

const OFFICIAL = ['onepiece-cardgame.com','join.carddass.com'];
const YUYUTEI = ['yuyu-tei.jp'];
function safeUrl(value, hosts) {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && hosts.some(h=>u.hostname===h || u.hostname.endsWith('.'+h)) ? u.href : ''; } catch { return ''; }
}
const dateOf = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s)) ? s : '';
const fmtDate = (s) => dateOf(s) ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Brunei'}).format(new Date(s+'T00:00:00+08:00')) : '';
function checked(section, now) {
  const t=Date.parse(section?.checked_at);
  if(!Number.isFinite(t)) return 'Updates temporarily unavailable';
  const text=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Brunei'}).format(new Date(t));
  return `Last checked ${esc(text)} BNT${now-t>36*3600e3 ? ' · Update delayed' : ''}`;
}
function items(section, hosts) {
  return (Array.isArray(section?.items) ? section.items : []).filter(i=>i && typeof i.title==='string' && i.title.trim() && safeUrl(i.url,hosts));
}
function photo(i,hosts,cls='news-photo') {
  let url=safeUrl(i.image,hosts);
  const cardImage=cls==='latest-photo' && /^https:\/\/card\.yuyu-tei\.jp\/opc\/(?:\d+_\d+|front)\//.test(url);
  const hd=cardImage ? url.replace(/\/opc\/(?:\d+_\d+|front)\//,'/opc/front/') : '';
  if(cardImage) url=url.replace(/\/opc\/(?:\d+_\d+|front)\//,'/opc/250_350/');
  return url ? `<div class="${cls}"><img src="${esc(url)}" ${hd ? `data-hd="${esc(hd)}"` : ''} alt="${esc(i.title)}" loading="lazy" decoding="async" onerror="this.hidden=true"></div>` : '';
}
function feedHead(title,section,hosts,fallback) {
  const url=safeUrl(section?.source,hosts)||fallback;
  return `<div class="sec-h"><h2>${title}</h2><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">View source ↗</a></div>`;
}
export function renderHomeFeeds(feed={}, {now=Date.now()}={}) {
  const n=feed?.news, y=feed?.yuyutei, r=feed?.releases;
  const news=items(n,OFFICIAL).sort((a,b)=>(dateOf(b.published_at)||'').localeCompare(dateOf(a.published_at)||'')).slice(0,6);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Brunei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const releases=items(r,OFFICIAL).filter(i=>dateOf(i.release_date) && i.release_date>=today).sort((a,b)=>a.release_date.localeCompare(b.release_date)).slice(0,6);
  const cards=items(y,YUYUTEI).slice(0,12);
  return `<section class="home-feed" aria-label="Official news">${feedHead('Latest news from official',n,OFFICIAL,'https://asia-en.onepiece-cardgame.com/')}<p class="feed-meta">${checked(n,now)}</p>
    ${news.length ? `<div class="news-feed">${news.map(i=>`<a class="news-card" href="${esc(safeUrl(i.url,OFFICIAL))}" target="_blank" rel="noopener noreferrer">${photo(i,OFFICIAL)}<div class="news-body">${dateOf(i.published_at) ? `<time datetime="${esc(i.published_at)}">${fmtDate(i.published_at)}</time>` : ''}<h3>${esc(i.title)}</h3><span class="source-tag">ONE PIECE Card Game · Official ↗</span></div></a>`).join('')}</div>` : '<div class="panel muted">Official news is temporarily unavailable. Use View source for the latest updates.</div>'}</section>
    <section class="home-feed" aria-label="Upcoming releases">${feedHead('Upcoming releases',r,OFFICIAL,'https://www.onepiece-cardgame.com/products/')}<p class="feed-meta">Japan · Official release schedule. Dates may change.<br>${checked(r,now)}</p>
    ${releases.length ? `<div class="release-feed">${releases.map(i=>`<a class="release-card" href="${esc(safeUrl(i.url,OFFICIAL))}" target="_blank" rel="noopener noreferrer">${photo(i,OFFICIAL,'release-photo')}<div><time datetime="${esc(i.release_date)}">${fmtDate(i.release_date)}</time><h3>${esc(i.title)}</h3><span class="source-tag">Japan · Official ↗</span></div></a>`).join('')}</div>` : '<div class="panel muted">No confirmed upcoming releases in the current feed. Check the official schedule for announcements.</div>'}</section>
    <section class="home-feed" aria-label="Latest Yuyutei cards">${feedHead('Latest cards on Yuyutei',y,YUYUTEI,'https://yuyu-tei.jp/top/opc')}<p class="feed-meta">${esc(y?.description || 'Latest cards shown by Yuyutei. Individual addition dates are not provided.')}<br>${checked(y,now)}</p>
    ${cards.length ? `<div class="hscroll latest-feed">${cards.map(i=>`<a class="tile latest-card" href="${esc(safeUrl(i.url,YUYUTEI))}" target="_blank" rel="noopener noreferrer">${photo(i,YUYUTEI,'latest-photo')}<div class="t-body">${i.code ? `<b>${esc(i.code)}</b>` : ''}<div class="t-name">${esc(i.title)}</div>${dateOf(i.added_at) ? `<time datetime="${esc(i.added_at)}">${fmtDate(i.added_at)}</time>` : ''}<span class="source-tag">Yuyutei ↗</span></div></a>`).join('')}</div>` : '<div class="panel muted">Yuyutei updates are temporarily unavailable. Use View source to browse the shop.</div>'}</section>`;
}
