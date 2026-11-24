import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderHomeStats,renderHomeFeeds,fmtBrunei} from '../src/home-content.js';
const source=readFileSync(new URL('../src/views/home.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'').replace(/import\.meta\.env\.BASE_URL/g,"'/'");
test('Home removes old sections and uses exact counts with expired auctions excluded',async()=>{
  const queries=[];
  const sb={from(){const q={filters:[],opts:{}};queries.push(q);const chain={select(fields,opts={}){q.opts=opts;return chain;},eq(k,v){q.filters.push([k,v]);return chain;},gt(k,v){q.filters.push([k,'gt',v]);return chain;},order(){return chain;},limit(){return chain;},or(){return chain;},in(){return chain;},then(resolve,reject){const type=q.filters.find(f=>f[0]==='type')?.[1];return Promise.resolve({data:[],error:null,count:type==='auction'?2:1501}).then(resolve,reject);}};return chain;}};
  const cat={sets:[],updated:'2026-11-23T10:17:00.000Z'};const state={user:{id:'unit-test'},cat,inv:new Map([['op01-1001',17]]),fx:.01};
  const app={innerHTML:'',isConnected:true,querySelectorAll:()=>[],querySelector:()=>null};
  const ctx={sb,state,loadCatalog:async()=>cat,loadInv:async()=>state.inv,invStats:()=>({count:17,unique:1,value:1,rows:[],bySet:new Map(),owned:new Map()}),rpc:async()=>0,bindLogin:()=>{},setCard:()=>'',esc:String,bnd:String,bndShort:String,isMember:()=>true,tile:()=>'',groupBuyNow:(r)=>r,primeMeta:async()=>{},renderHomeStats,renderHomeFeeds,fmtBrunei,fetch:async()=>({ok:true,json:async()=>({})}),setTimeout:()=>0,Date,AbortSignal,console};
  const run=vm.runInNewContext(source+'\nviewHome',ctx);await run(app);
  assert.doesNotMatch(app.innerHTML,/Your collection|Set completion|Browse by set/);
  for(const text of ['Total card collection','Live listing','Live auction','Latest news from official','Latest cards on Yuyutei','Upcoming releases'])assert.ok(app.innerHTML.includes(text),text);
  assert.match(app.innerHTML,/<b>1,501<\/b>/);assert.match(app.innerHTML,/<b>17<\/b>/);assert.match(app.innerHTML,/last refreshed: <b>23 Nov 2026, 18:17 GMT\+8<\/b>/);assert.equal(fmtBrunei('2026-11-23'),'2026-11-23 (time not recorded)');
  assert.equal(queries.filter(q=>q.opts.head&&q.opts.count==='exact').length,2);
  assert.ok(queries.filter(q=>q.filters.some(f=>f[0]==='type'&&f[1]==='auction')).every(q=>q.filters.some(f=>f[0]==='ends_at'&&f[1]==='gt')));
});
