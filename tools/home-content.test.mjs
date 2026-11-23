import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/home-content.js').catch(() => ({}));
test('Home summary shows personal card quantity and distinct live buy-now and auction counts', () => {
  assert.equal(typeof mod.renderHomeStats, 'function', 'Home summary renderer is missing');
  const html = mod.renderHomeStats({signed:true,totalCards:17,listingCount:3,auctionCount:2});
  assert.match(html, /Total card collection/); assert.match(html, /<b>17<\/b>/);
  assert.match(html, /Live listing/); assert.match(html, /<b>3<\/b>/);
  assert.match(html, /Live auction/); assert.match(html, /<b>2<\/b>/);
  assert.doesNotMatch(html, /Your collection|Set completion|Browse by set/);
});
test('signed-out collection and failed counts are not falsely reported as zero', () => {
  const html = mod.renderHomeStats({signed:false,totalCards:0,listingCount:null,auctionCount:null});
  assert.match(html, /Sign in to view your cards/);
  assert.match(html, /Temporarily unavailable/);
  assert.doesNotMatch(html, /<b>0<\/b>/);
});
test('failed personal inventory is shown as unavailable rather than an empty collection', () => {
  const html=mod.renderHomeStats({signed:true,totalCards:null,listingCount:2,auctionCount:1});
  assert.match(html, /Total card collection<\/span><small>Temporarily unavailable/);
});
test('Yuyutei carousel thumbnails use readable card images with the existing HD upgrade', () => {
  const html=mod.renderHomeFeeds({yuyutei:{items:[{title:'Card',url:'https://yuyu-tei.jp/sell/opc/card/op18/10073',image:'https://card.yuyu-tei.jp/opc/100_140/op18/10073.jpg'}]}});
  assert.match(html,/src="https:\/\/card.yuyu-tei.jp\/opc\/250_350\/op18\/10073.jpg"/);
  assert.match(html,/data-hd="https:\/\/card.yuyu-tei.jp\/opc\/front\/op18\/10073.jpg"/);
});
test('Home feeds show official news, dated upcoming Japan releases and source-ordered Yuyutei cards safely', () => {
  assert.equal(typeof mod.renderHomeFeeds,'function','Home feeds renderer is missing');
  const feed = {
    news:{source:'https://asia-en.onepiece-cardgame.com/topics/',checked_at:'2026-11-23T08:00:00Z',items:[{title:'New <cards>',url:'https://asia-en.onepiece-cardgame.com/topics/001.html',published_at:'2026-11-23'},{title:'Unsafe',url:'javascript:alert(1)'},{title:'Official questionnaire',url:'https://join.carddass.com/asia-en/survey/products/detail/734',published_at:'2026-11-20'}]},
    releases:{source:'https://www.onepiece-cardgame.com/products/',checked_at:'2026-11-23T08:00:00Z',items:[{title:'Future set',url:'https://www.onepiece-cardgame.com/products/op19.html',release_date:'2027-01-23',region:'Japan'},{title:'Past set',url:'https://www.onepiece-cardgame.com/products/op17.html',release_date:'2026-08-01',region:'Japan'}]},
    yuyutei:{source:'https://yuyu-tei.jp/top/opc',checked_at:'2026-11-23T08:00:00Z',description:'Newest releases shown by Yuyutei; individual addition dates are not provided.',items:[{title:'New card',code:'OP18-001',url:'https://yuyu-tei.jp/sell/opc/card/op18/1001',image:'https://card.yuyu-tei.jp/opc/250_350/op18/1001.jpg'}]}
  };
  const html=mod.renderHomeFeeds(feed,{now:Date.parse('2026-11-23T09:00:00Z')});
  for(const title of ['Latest news from official','Upcoming releases','Latest cards on Yuyutei']) assert.ok(html.includes(title));
  assert.match(html,/New &lt;cards&gt;/);assert.match(html,/Official questionnaire/);assert.match(html,/Future set/);assert.doesNotMatch(html,/Past set/);
  assert.match(html,/23 Jan 2027/);assert.match(html,/Japan/);assert.match(html,/Last checked/);
  assert.match(html,/OP18-001/);assert.match(html,/individual addition dates are not provided/);
  assert.doesNotMatch(html,/javascript:|>Unsafe</);
});

