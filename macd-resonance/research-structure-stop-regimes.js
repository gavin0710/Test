#!/usr/bin/env node
"use strict";
// Read-only empirical stop-regime comparison. Does not edit the production trade engine.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const dir=__dirname;
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1],cut=source.indexOf('byId("refresh").onclick=load;');
const context=vm.createContext({window:{},document:{},console});
vm.runInContext(source.slice(0,cut)+';this.api={calculate,resample,resampleHourly};',context,{timeout:6000});
const {calculate,resample,resampleHourly}=context.api;
const rd=n=>JSON.parse(fs.readFileSync(path.join(dir,'data',n),'utf8'));
const latest=rd('latest.json'),hd=rd('history-101.json'),hw=rd('history-102.json'),hi=rd('history-15.json');
const idx=['上证指数','深证成指','创业板指','科创50'];
const periods=[['15','15分钟'],['60','60分钟'],['90','90分钟'],['120','120分钟'],['D','日线'],['W','周线']];
const schemes=['originActive','latestActive','originPersistent','latestPersistent','ratchetPersistent','ATR3'];
const merge=(...arrs)=>{const d=new Map();for(const xs of arrs)for(const b of xs||[])if(b?.t&&Number.isFinite(b.c))d.set(b.t,b);return [...d.values()].sort((a,b)=>a.t.localeCompare(b.t))};
const round=n=>Number.isFinite(n)?+n.toFixed(3):null;
function atr14(bars){
 let out=[],prev=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],tr=prev===null?b.h-b.l:Math.max(b.h-b.l,Math.abs(b.h-prev),Math.abs(b.l-prev));
  out[i]=i===0?tr:(out[i-1]*13+tr)/14;prev=b.c;
 }
 return out;
}
function model(v,scheme){
 const bars=v.bars,n=bars.length,eps=1e-9,atr=atr14(bars);
 const eventBuckets=Array.from({length:n},()=>({buys:[],sells:[],failures:[]}));
 for(const e of v.events){
  if(!eventBuckets[e.i])continue;
  if(e.type==='buy')eventBuckets[e.i].buys.push(e);
  if(['sell','secondSell','thirdSell','laterSell'].includes(e.type))eventBuckets[e.i].sells.push(e);
  if(e.type==='structureFailure'&&e.side==='bottom')eventBuckets[e.i].failures.push(e);
 }
 const cycs=new Map(v.cycles.filter(c=>c.side==="bottom").map(c=>[c.firstI,c]));
 let pos=null,tradeList=[],newBuyWhileHeld=0,activeEndUnprotected=0,unprotectedBars=0,holdingBars=0,expiredStopCount=0,stopMismatch=0;
 for(let i=0;i<n;i++){
  const E=eventBuckets[i];
  let exited=false;
  if(pos&&i>pos.entryI){
   const own=cycs.get(pos.firstI),latest=cycs.get(pos.latestFirstI);
   const currentActive=latest&&(!latest.closed||!Number.isInteger(latest.endedAt)||latest.endedAt>=i);
   holdingBars++;
   if(own?.closed&&own.endedAt<i)unprotectedBars++;
   const stopReasons=[];
   if(scheme==='originActive'&&E.failures.some(e=>e.firstI===pos.firstI))stopReasons.push('originFailure');
   if(scheme==='latestActive'&&E.failures.some(e=>e.firstI===pos.latestFirstI))stopReasons.push('latestFailure');
   if(scheme==='originPersistent'&&v.dif[i]<pos.initialRef-eps)stopReasons.push('originDIF');
   if(scheme==='latestPersistent'&&v.dif[i]<pos.latestRef-eps)stopReasons.push('latestDIF');
   if(scheme==='ratchetPersistent'&&v.dif[i]<pos.highRef-eps)stopReasons.push('ratchetDIF');
   if(scheme==='ATR3'&&bars[i].c<=pos.atrStop-eps)stopReasons.push('ATR3trailing');
   const cause=stopReasons[0]||(E.sells.length?'topSell':null);
   if(cause){
    const closeI=i,fillI=i+1<n?i+1:null,fill=fillI!==null?bars[fillI].o:null;
    const ret=fill&&pos.fillEntry?100*(fill/pos.fillEntry-1):null;
    tradeList.push({entryI:pos.entryI,entryT:bars[pos.entryI].t,exitI:closeI,exitT:bars[closeI].t,
      entryPrice:bars[pos.entryI].c,exitPrice:bars[closeI].c,openEntry:pos.fillEntry,openExit:fill,
      fillReturn:ret,closeReturn:100*(bars[closeI].c/bars[pos.entryI].c-1),
      cause,firstI:pos.firstI,latestFirstI:pos.latestFirstI,initialRef:pos.initialRef,latestRef:pos.latestRef,
      hold:i-pos.entryI,newBuys:pos.newBuyCount,agedOut:own?.closed&&own.endedAt<i});
    if(cause!=='topSell'&&pos.latestFirstI!==pos.firstI)stopMismatch++;
    exited=true;pos=null;
   }else{
    if(scheme==='ATR3'){pos.highestClose=Math.max(pos.highestClose,bars[i].c);
     pos.atrStop=Math.max(pos.atrStop,pos.highestClose-3*atr[i]);}
   }
  }
  if(!exited&&E.buys.length){
   for(const e of E.buys){
    const ref=e.ref?.dif;
    if(!Number.isFinite(ref))throw Error('Missing buy ref');
    if(!pos){
     const fill=i+1<n?bars[i+1].o:null;
     pos={entryI:i,fillEntry:fill,firstI:i,latestFirstI:i,initialRef:ref,latestRef:ref,highRef:ref,
      newBuyCount:0,highestClose:bars[i].c,atrStop:bars[i].c-3*atr[i]};
    }else{
     pos.latestFirstI=i;pos.latestRef=ref;pos.highRef=Math.max(pos.highRef,ref);
     pos.newBuyCount++;newBuyWhileHeld++;
    }
   }
  }
 }
 const closed=tradeList.filter(t=>Number.isFinite(t.fillReturn)),returns=closed.map(t=>t.fillReturn).sort((a,b)=>a-b);
 const wealth=closed.reduce((x,t)=>x*(1+t.fillReturn/100),1);
 const ddCases=closed.filter(t=>t.fillReturn<0);
 return {scheme,closed:closed.length,notFilled:tradeList.length-closed.length,open:pos?{date:bars[pos.entryI].t,entry:bars[pos.entryI].c,newBuys:pos.newBuyCount}:null,
  stops:closed.filter(t=>t.cause!=='topSell').length,exits:closed.filter(t=>t.cause==='topSell').length,
  wins:closed.filter(t=>t.fillReturn>0).length,winRate:round(closed.length?100*closed.filter(t=>t.fillReturn>0).length/closed.length:null),
  avgReturn:round(returns.length?returns.reduce((n,x)=>n+x,0)/returns.length:null),
  medianReturn:round(returns.length?returns[Math.floor(returns.length/2)]:null),
  meanLoss:round(ddCases.length?ddCases.reduce((n,t)=>n+t.fillReturn,0)/ddCases.length:null),
  worst:round(returns[0]),best:round(returns.at(-1)),maxHoldBars:Math.max(0,...closed.map(t=>t.hold)),
  exposureAdjustedFactor:round(wealth),holdingBars,unprotectedBars,newBuyWhileHeld,
  stopMismatch,tradeList};
}
const all=[];
for(let i=0;i<4;i++){
 const m=merge(hi.data[i]['15'],latest.data[i]['15']),h=merge(latest.data[i]['60']);
 const byP={'15':m,'60':h.length>65?h:resample(m,4),'90':resample(m,6),
   '120':h.length>65?resampleHourly(h):resample(m,8),
   D:merge(hd.data[i]['101'],latest.data[i]['101']),W:merge(hw.data[i]['102'],latest.data[i]['102'])};
 for(const [p,label] of periods){
  const v=calculate(byP[p]);if(!v)throw Error('missing '+i+p);
  const strategies=schemes.map(x=>model(v,x));
  const failures=v.events.filter(e=>e.type==='structureFailure'&&e.side==='bottom');
  const buys=v.events.filter(e=>e.type==='buy');
  const cycles=v.cycles.filter(c=>c.side==='bottom');
  const expired=cycles.filter(c=>c.endReason==='3 opposite-color columns');
  all.push({index:idx[i],period:label,code:p,start:v.bars[0].t,end:v.bars.at(-1).t,bars:v.bars.length,
   buys:buys.length,failures:failures.length,expired:expired.length,
   strategies});
 }
}
const simple=all.map(({strategies,...rest})=>({...rest,strategies:strategies.map(({tradeList,open,...s})=>({...s,open:!!open}))}));
const per=periods.map(([p,label])=>{
 const rows=all.filter(r=>r.code===p);
 return {period:label,indexes:rows.length,bars:rows.map(r=>r.bars),firstBuys:rows.reduce((x,r)=>x+r.buys,0),
  failures:rows.reduce((x,r)=>x+r.failures,0),
  schemes:schemes.map(s=>{
   const rr=rows.flatMap(r=>r.strategies.find(v=>v.scheme===s).tradeList.filter(t=>Number.isFinite(t.fillReturn)));
   const ret=rr.map(x=>x.fillReturn).sort((a,b)=>a-b);
   const avg=ret.length?ret.reduce((a,b)=>a+b,0)/ret.length:null;
   return {name:s,n:rr.length,stops:rr.filter(t=>t.cause!=='topSell').length,
    wins:rr.filter(t=>t.fillReturn>0).length,win:ret.length?round(rr.filter(t=>t.fillReturn>0).length/ret.length*100):null,
    avg:round(avg),median:round(ret.length?ret[Math.floor(ret.length/2)]:null),
    worst:round(ret[0]),unprotectedBars:rows.reduce((x,r)=>x+r.strategies.find(v=>v.scheme===s).unprotectedBars,0),
    maxHoldBars:Math.max(0,...rr.map(r=>r.hold))};
  })};
});
const sum=schemes.map(s=>{
 const rr=all.flatMap(r=>r.strategies.find(v=>v.scheme===s).tradeList.filter(t=>Number.isFinite(t.fillReturn)));
 const ret=rr.map(x=>x.fillReturn).sort((a,b)=>a-b);
 return {name:s,completed:rr.length,stops:rr.filter(x=>x.cause!=='topSell').length,wins:rr.filter(x=>x.fillReturn>0).length,
  win:round(rr.filter(x=>x.fillReturn>0).length/rr.length*100),avg:round(ret.reduce((a,b)=>a+b,0)/ret.length),
  median:round(ret[Math.floor(ret.length/2)]),worst:round(ret[0]),maxHold:Math.max(...rr.map(x=>x.hold)),
  open:all.filter(r=>r.strategies.find(x=>x.scheme===s).open).length,
  newBuyWhileHeld:all.reduce((n,r)=>n+r.strategies.find(x=>x.scheme===s).newBuyWhileHeld,0)};
});
const weekly=all.find(r=>r.index==='上证指数'&&r.period==='周线');
const recentWeekly=weekly.strategies.map(s=>({
 strategy:s.scheme,part:s.tradeList.filter(t=>
 t.entryT<'2024-03-01'&&t.exitT>'2023-01-01'
 ).map(({entryT,exitT,entryPrice,exitPrice,fillReturn,cause,initialRef,latestRef,newBuys,hold})=>
  ({entryT,exitT,entryPrice:round(entryPrice),exitPrice:round(exitPrice),
   fillReturn:round(fillReturn),cause,initialRef:round(initialRef),latestRef:round(latestRef),newBuys,hold}))
}));
console.log('MODEL_SUMMARY',JSON.stringify({asOf:latest.generated_at_utc,indexes:4,periods:6,schemes:sum}));
console.log('MODEL_PERIODS',JSON.stringify(per));
console.log('MODEL_SSE_WEEKLY',JSON.stringify(recentWeekly));
console.log('MODEL_GROUPS',JSON.stringify(simple));
console.log('MODEL_PASS');
