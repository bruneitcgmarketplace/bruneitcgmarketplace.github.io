import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Minimal test-only markup based on the observed official topics structure.
const subject = await import('./refresh_home_feed.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const officialItem = (title, date, href = '/news/example.php') => `<li class="topicDetail"><a href="${href}"><div class="topicThumnail"><img src="/images/example.webp"></div><dl><dt class="topicTit"><span class="js_topicTit">${title}</span></dt><dd class="topicCategory"><object><a href="./?tags=products">PRODUCTS</a></object></dd><dd class="topicDate">${date}</dd></dl></a></li>`;

test('renewed official news index uses latest newsListItem, not recommended items or legacy topics', () => {
  const item = (title, date, href, kind = 'newsListItem') => `<li class="${kind}"><a href="${href}" class="newsListLink"><img src="/placeholder.png" data-src="/onepiececg/news.webp"><time class="newsDate" datetime="${date} 14:03">Displayed date</time><h4 class="newsTitle">${title}</h4></a></li>`;
  const html = item('Recommended, not latest', '2026-11-23', '/recommend.html', 'recommendColBox') + item('Latest', '2026-11-20', '/cardlist/?series=556118') + item('Questionnaire', '2026-11-20', 'https://join.carddass.com/asia-en/survey/products/detail/734');
  assert.deepEqual(subject.parseOfficialNews(html).map(({ title, published_at, image }) => ({ title, published_at, image })), [
    { title: 'Latest', published_at: '2026-11-20', image: 'https://asia-en.onepiece-cardgame.com/onepiececg/news.webp' },
    { title: 'Questionnaire', published_at: '2026-11-20', image: 'https://asia-en.onepiece-cardgame.com/onepiececg/news.webp' },
  ]);
});

test('Yuyutei selects only the bounded latest-expansion carousel in exact source order', () => {
  assert.equal(typeof subject.parseYuyuteiCards, 'function');
  // Minimal test-only fixture. Duplicate detail buttons and surrounding restock cards are deliberate.
  const card = (id, code, name, host = 'yuyu-tei.jp') => `<a href="https://${host}/sell/opc/card/op18/${id}"><img src="https://card.yuyu-tei.jp/opc/100_140/op18/${id}.jpg" alt=" ${code} R ${name} "><p>${name}</p></a><a href="https://${host}/sell/opc/card/op18/${id}">詳細を見る</a>`;
  const html = card('99999', 'RESTOCK-001', 'Restock') + '<h2>最新弾</h2><div id="newestCardList"><div class="carousel-inner"><div class="carousel-item active"><div class="row">' + card('10110', 'OP18-088', 'ソマーズ聖') + card('10073', 'OP18-060', '軍子宮') + card('10000', 'OP18-000', 'Unsafe', 'evil.example') + '</div></div></div><button>Next</button></div>' + card('88888', 'SALE-001', 'Sale');
  assert.deepEqual(subject.parseYuyuteiCards(html), [
    { title: 'ソマーズ聖', code: 'OP18-088', image: 'https://card.yuyu-tei.jp/opc/100_140/op18/10110.jpg', url: 'https://yuyu-tei.jp/sell/opc/card/op18/10110', added_at: null },
    { title: '軍子宮', code: 'OP18-060', image: 'https://card.yuyu-tei.jp/opc/100_140/op18/10073.jpg', url: 'https://yuyu-tei.jp/sell/opc/card/op18/10073', added_at: null },
  ]);
  assert.equal(subject.parseYuyuteiCards(html, { limit: 1 }).length, 1);
  assert.throws(() => subject.parseYuyuteiCards(card('99999', 'RESTOCK-001', 'Restock')), /latest.expansion/i);
  assert.throws(() => subject.parseYuyuteiCards('<div id="newestCardList"></div>'), /latest.expansion/i);
});

test('Japan releases use official booster/deck dates, nearest first, filtered by Brunei calendar date', () => {
  assert.equal(typeof subject.parseUpcomingReleases, 'function');
  const product = (title, date, cat = 'boosters', href = '/products/example.html') => `<li class="linkListColBox" data-cat="${cat}"><a class="linkListColItem" href="${href}"><img src="/placeholder.webp" data-src="/onepiececg/item.webp"><h4 class="linkListColTitle">${title}</h4><p class="linkListColDate"><span>発売日</span><time class="newsDate" datetime="${date}">${date}</time></p></a></li>`;
  const html = [product('Future booster', '2027-01-30', 'boosters', '/products/eb06.html'), product('Today deck', '2026-11-23', 'decks', '/products/st37.html'), product('Released', '2026-11-21'), product('Sleeves', '2026-12-19', 'others'), product('Undated booster', ''), product('Invalid date', '2026-11-31'), product('Unsafe', '2026-12-19', 'decks', 'https://evil.example/deck')].join('');
  assert.equal(subject.bruneiDate(new Date('2026-11-22T16:01:00Z')), '2026-11-23');
  assert.deepEqual(subject.parseUpcomingReleases(html, { today: '2026-11-23' }), [
    { title: 'Today deck', url: 'https://www.onepiece-cardgame.com/products/st37.html', release_date: '2026-11-23', image: 'https://www.onepiece-cardgame.com/onepiececg/item.webp', region: 'Japan' },
    { title: 'Future booster', url: 'https://www.onepiece-cardgame.com/products/eb06.html', release_date: '2027-01-30', image: 'https://www.onepiece-cardgame.com/onepiececg/item.webp', region: 'Japan' },
  ]);
  assert.deepEqual(subject.parseUpcomingReleases(html, { today: '2028-01-01' }), []);
  assert.throws(() => subject.parseUpcomingReleases('<html>Unexpected markup</html>'), /dated.*products/i);
});

test('previous deployed feed merges only newer validated nonempty sections', () => {
  assert.equal(typeof subject.mergePreviousFeeds, 'function');
  const news = { source: subject.SOURCES.news, checked_at: '2026-11-20T00:00:00.000Z', items: [{ title: 'Known news', url: 'https://asia-en.onepiece-cardgame.com/news/example.html', published_at: '2026-11-20' }] };
  const local = { news };
  const newer = { ...news, checked_at: '2026-11-22T00:00:00.000Z' };
  assert.deepEqual(subject.mergePreviousFeeds(local, { news: newer }).news, newer);
  assert.deepEqual(subject.mergePreviousFeeds({ news: newer }, local).news, newer);
  for (const bad of [ { ...newer, source: 'https://evil.example/' }, { ...newer, checked_at: 'not-a-date' }, { ...newer, items: [] }, { ...newer, items: [{ title: 'Attack', url: 'javascript:alert(1)', published_at: '2026-11-20' }] }, { ...newer, items: [{ ...newer.items[0], image: 'https://evil.example/tracker' }] } ]) {
    assert.deepEqual(subject.mergePreviousFeeds(local, { news: bad }).news, news);
  }
});

test('refresh preserves each last-good section and checked_at on network or markup errors', async () => {
  assert.equal(typeof subject.refreshHomeFeed, 'function');
  const previous = {
    news: { source: subject.SOURCES.news, checked_at: '2026-11-20T00:00:00.000Z', items: [{ title: 'Older news', url: 'https://asia-en.onepiece-cardgame.com/news/old.html', published_at: '2026-11-20' }] },
    yuyutei: { source: subject.SOURCES.yuyutei, checked_at: '2026-11-21T00:00:00.000Z', description: subject.YUYUTEI_DESCRIPTION, items: [{ title: '軍子宮', code: 'OP18-060', image: 'https://card.yuyu-tei.jp/opc/100_140/op18/10073.jpg', url: 'https://yuyu-tei.jp/sell/opc/card/op18/10073', added_at: null }] },
  };
  const before = structuredClone(previous);
  const now = new Date('2026-11-23T10:00:00.000Z');
  const fetchText = async url => {
    if (url === subject.SOURCES.news) return officialItem('Fresh news', 'November 23, 2026');
    if (url === subject.SOURCES.yuyutei) throw new Error('Simulated test-only source outage');
    return '<html>Changed markup</html>';
  };
  const { feed, errors } = await subject.refreshHomeFeed({ previous, fetchText, now });
  assert.equal(feed.updated_at, now.toISOString());
  assert.equal(feed.news.checked_at, now.toISOString());
  assert.equal(feed.news.items[0].title, 'Fresh news');
  assert.deepEqual(feed.yuyutei, previous.yuyutei);
  assert.equal(feed.releases, undefined);
  assert.deepEqual(errors.map(error => error.section).sort(), ['releases', 'yuyutei']);
  assert.deepEqual(previous, before);
  const failed = await subject.refreshHomeFeed({ previous, fetchText: async () => { throw new Error('offline'); }, now });
  assert.deepEqual(failed.feed.news, previous.news);
  assert.equal(failed.feed.updated_at, previous.yuyutei.checked_at);
});

test('CLI pipeline reads deployed baseline before outages and writes the verified section atomically', async () => {
  assert.equal(typeof subject.main, 'function');
  const scratch = join(homedir(), '.hermes', 'cache', 'scratch');
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'home-feed-test-'));
  try {
    const output = join(dir, 'public', 'home-feed.json');
    const deployed = { news: { source: subject.SOURCES.news, checked_at: '2026-11-22T00:00:00.000Z', items: [{ title: 'Real-format test-only baseline', url: 'https://asia-en.onepiece-cardgame.com/news/example.html', published_at: '2026-11-20' }] } };
    const baseline = 'https://bruneitcgmarketplace.github.io/home-feed.json';
    const calls = [];
    const result = await subject.main({ output, previousUrl: baseline, fetchText: async url => { calls.push(url); if (url === baseline) return JSON.stringify(deployed); throw new Error('test-only outage'); } });
    const saved = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(calls[0], baseline);
    assert.deepEqual(saved.news, deployed.news);
    assert.equal(saved.updated_at, deployed.news.checked_at);
    assert.equal(result.errors.length, 3);
    // Optional baseline outage must not prevent a first successful deployment.
    await rm(output);
    await subject.main({ output, previousUrl: baseline, fetchText: async url => { if (url === subject.SOURCES.news) return officialItem('New test-only source', 'November 23, 2026'); throw new Error('test-only outage'); } });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).news.items[0].title, 'New test-only source');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an outage retains release provenance without showing releases whose Brunei date has passed', async () => {
  const checked_at = '2026-11-20T00:00:00.000Z';
  const product = (title, release_date) => ({ title, release_date, region: 'Japan', url: `https://www.onepiece-cardgame.com/products/${title}.html` });
  const previous = { releases: { source: subject.SOURCES.releases, checked_at, items: [product('past', '2026-11-21'), product('today', '2026-11-23'), product('future', '2026-12-19')] } };
  const { feed } = await subject.refreshHomeFeed({ previous, now: new Date('2026-11-23T10:00:00Z'), fetchText: async () => { throw new Error('test-only outage'); } });
  assert.deepEqual(feed.releases.items.map(item => item.title), ['today', 'future']);
  assert.equal(feed.releases.checked_at, checked_at);
  assert.equal(previous.releases.items.length, 3);
});

test('official dated topics are sorted newest first with safe source URLs and real dates', () => {
  assert.equal(typeof subject.parseOfficialNews, 'function', 'official parser must be exported');
  const html = '<ul class="topicsBox">' + [
    officialItem('Older', 'April 10, 2026', '/news/old.php'),
    officialItem('Luffy &amp; Ace &#x1F600;', 'April 17, 2026', '/news/new.php?a=1&amp;b=2'),
    officialItem('Not a date', 'February 30, 2026'),
    officialItem('Off-site', 'November 23, 2026', 'https://evil.example/news'),
    officialItem('Insecure', 'November 23, 2026', 'http://asia-en.onepiece-cardgame.com/news'),
    officialItem('Missing date', ''),
  ].join('') + '</ul>';
  assert.deepEqual(subject.parseOfficialNews(html), [
    { title: 'Luffy & Ace 😀', url: 'https://asia-en.onepiece-cardgame.com/news/new.php?a=1&b=2', published_at: '2026-04-17', image: 'https://asia-en.onepiece-cardgame.com/images/example.webp' },
    { title: 'Older', url: 'https://asia-en.onepiece-cardgame.com/news/old.php', published_at: '2026-04-10', image: 'https://asia-en.onepiece-cardgame.com/images/example.webp' },
  ]);
  assert.equal(subject.parseOfficialNews(html, { limit: 1 }).length, 1);
  assert.throws(() => subject.parseOfficialNews('<html>Unexpected source markup</html>'), /dated topics/i);
});
