// unit tests for the tracker decision logic (no browser needed)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/scanner.js', import.meta.url),'utf8');
const a = src.indexOf('// ----- decision logic');
const code = src.slice(a).replaceAll('export const','const').replaceAll('export function','function') + '; return { T, makeTracker };';
const { T, makeTracker } = new Function(code)();
let pass=0, fail=0; const ok=(n,c)=>{c?pass++:fail++; console.log(c?'PASS':'FAIL',n)};
function run(frames, step=100){ let t=0; const adds=[]; const states=[]; const f=makeTracker((c,r)=>adds.push([c,t]),(s)=>states.push(s.kind),()=>t);
  for(const fr of frames){ f(fr); t+=step; } return {adds,states}; }
const good=(code,sim=0.8,margin=0.2)=>({code,ref:code+'-r',sim,margin,top:[]});
const weak=(code)=>({code,ref:code+'-r',sim:0.52,margin:0.02,top:[{code}]});
const empty={code:null,sim:0.2,margin:0,top:[]};
const rep=(x,n)=>Array(n).fill(x);
let r=run([...rep(good('A'),10)]); ok('adds a steady card once', r.adds.length===1 && r.adds[0][0]==='A');
ok('add takes >=250 ms and >=3 frames', r.adds[0][1]>=250);
r=run([...rep(good('A'),10),...rep(empty,8),...rep(good('A'),10)]); ok('same card again after removal adds twice', r.adds.length===2);
r=run([...rep(good('A'),10),...rep(empty,3),...rep(good('A'),10)]); ok('short dropout (300 ms) does not double add', r.adds.length===1);
r=run([...rep(good('A'),10),...rep(good('B'),10)]); ok('swap A to B without gap adds both', r.adds.map(a=>a[0]).join('')==='AB');
r=run([good('A'),weak('A'),good('A'),weak('A'),good('A'),weak('A'),good('A'),good('A')]); ok('weak frames in between do not reset progress', r.adds.length===1);
r=run([...rep(weak('A'),20)]); ok('never confident means no add', r.adds.length===0 && r.states.includes('unsure'));
r=run([good('A'),good('B'),good('A'),good('B'),good('A'),good('B'),good('A'),good('B')]); ok('flip-flopping codes do not add', r.adds.length===0);
r=run([...rep({poor:true},10),...rep(good('A'),8)]); ok('glare frames are ignored then card adds', r.adds.length===1);
r=run([...rep(empty,20)]); ok('empty table adds nothing', r.adds.length===0);
r=run([good('A'),good('A')]); ok('two frames are not enough', r.adds.length===0);
console.log(pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
