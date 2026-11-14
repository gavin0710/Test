#!/usr/bin/env node
"use strict";
/* Read-only: each independent confirmed first buy is a hypothetical 1-unit trade.
  Compare same entry with own DIF stop until structure expiry, unchanged lifetime DIF floor,
  a price/ATR stop transferred when structure ends, and an always-on ATR stop. */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const root=__dirname,html=fs.readFileSync(path.join(root,'index.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const cut=script.indexOf('byId("refresh").onclick=load;'),scope=vm.createContext({window:{},document:{},console});
vm.runInContext(script.slice(0,cut)+';this.api={calculate,resample,resampleHourly};',scope,{timeout:6000});
const {calculate,resample,resampleHourly}=scope.api,j=p=>JSON.parse(fs.readFileSync(path.join(root,'data',p),'utf8'));
const latest=j('latest.json'),hd=j('history-101.json'),hw=j('history-102.json'),hm=j('history-15.json');
const idxNames=['上证指数','深证成指','创业板指','科创50'],periods=[['15','15分钟'],['60','60分钟'],['90','90分钟'],['120','120分钟'],['D','日线'],['W','周线']];
const keys=['activeOnly','permanentOwnDIF','transferATR3','alwaysATR3'];
const merge=(...series)=>{const x=new Map();for(const s of series)for(const b of s||[])if(b?.t&&Number.isFinite(b.c))x.set(b.t,b);return [...x.values()].sort((a,b)=>a.t.localeCompare(b.t))};
const round=x=>Number.isFinite(x)?+x.toFixed(3):null;
const atr=bars=>{
 const o=[];for(let i=0;i<bars.length;i++){
 const b=bars[i],tr=i?Math.max(b.h-b.l,Math.abs(b.h-bars[i-1].c),Math.abs(b.l-bars[i-1].c)):b.h-b.l;
 o.push(i?(o.at(-1)*13+tr)/14:tr);
 }return o;
};
const dataset=[];
for(let ix=0;ix<4;ix++){
 const m=merge(hm.data[ix]['15'],latest.data[ix]['15']),h=merge(latest.data[ix]['60']);
 const byP={'15':m,'60':h.length>65?h:resample(m,4),'90':resample(m,6),'120':h.length>65?resampleHourly(h):resample(m,8),D:merge(hd.data[ix]['101'],latest.data[ix]['101']),W:merge(hw.data[ix]['102'],latest.data[ix]['102'])};
 for(const [p,label] of periods){
  const v=calculate(byP[p]),bars=v.bars,n=bars.length,a=atr(bars);
  const events=v.events,buy=events.filter(e=>e.type==='buy'),sells=events.filter(e=>['sell','secondSell','thirdSell','laterSell'].includes(e.type));
  const cycs=new Map(v.cycles.filter(c=>c.side==='bottom').map(c=>[c.firstI,c]));
  const eRows=[];
  for(const entry of buy){
   const cyc=cycs.get(entry.i);
   assert(cyc,'First buy cycle unavailable');
   const rootRef=entry.ref?.dif;
   assert(Number.isFinite(rootRef),'Entry reference DIF missing');
   const top=sells.find(e=>e.i>entry.i),last=top?.i??n-1,trade={index:idxNames[ix],period:label,p,entryI:entry.i,entryT:entry.t,entryClose:bars[entry.i].c,
     initialDIF:rootRef,cycleEndI:cyc.endedAt??null,cycleEndReason:cyc.endReason??null,
     cycleEndT:Number.isInteger(cyc.endedAt)?bars[cyc.endedAt].t:null,
     topT:top?.t||null,topI:top?.i??null};
   const method={};
   for(const key of keys){
    let trigger=null,stopI=null,highest=bars[entry.i].c,trail=bars[entry.i].c-3*a[entry.i],
     floor=bars[entry.i].c-2*a[entry.i],disabled=false;
    for(let k=entry.i+1;k<=last;k++){
     const previouslyClosed=Number.isInteger(cyc.endedAt)&&cyc.endedAt<k;
     const isFailure=cyc.endReason==='DIF made new reference extreme'&&cyc.endedAt===k;
     if(key==='activeOnly'){if(isFailure){trigger='ownStructureFailure';stopI=k;break}}
     else if(key==='permanentOwnDIF'){if(v.dif[k]<rootRef-1e-9){trigger=previouslyClosed?'oldDIFBelowAfterExpiry':'ownDIFBelow';stopI=k;break}}
     else if(key==='transferATR3'){
      if(isFailure){trigger='ownStructureFailure';stopI=k;break}
      if(previouslyClosed||cyc.endedAt===k&&cyc.endReason!=='DIF made new reference extreme'){
       if(bars[k].c<=Math.max(floor,trail)-1e-9){trigger='transferredATR';stopI=k;break}
      }
     }else if(key==='alwaysATR3'){
      if(bars[k].c<=Math.max(floor,trail)-1e-9){trigger='alwaysATR';stopI=k;break}
     }
     highest=Math.max(highest,bars[k].c);
     trail=Math.max(trail,highest-3*a[k]);
    }
    const exitI=stopI??top?.i??null,fillEntry=bars[entry.i+1]?.o||null,fillExit=exitI!==null?bars[exitI+1]?.o||null:null;
    method[key]={exitI,exitT:exitI===null?null:bars[exitI].t,
      reason:trigger||(top?'topSell':'open'),triggered:trigger!==null,
      returnPct:fillExit&&fillEntry?100*(fillExit/fillEntry-1):null,
      exitClose:exitI===null?null:bars[exitI].c,
      closeReturnPct:exitI===null?null:100*(bars[exitI].c/bars[entry.i].c-1),
      holdBars:exitI===null?null:exitI-entry.i};
   }
   eRows.push({...trade,methods:method});
  }
  dataset.push({index:idxNames[ix],period:label,p,n:bars.length,episodes:eRows});
 }
}
function summary(items,method){
 const rr=items.map(r=>r.methods[method]),cl=rr.filter(x=>x.returnPct!==null),ret=cl.map(x=>x.returnPct).sort((a,b)=>a-b);
 const w=cl.filter(x=>x.returnPct>0).length;
 const expired=items.filter(e=>e.cycleEndReason==='3 opposite-color columns').length;
 return {n:cl.length,unclosed:rr.length-cl.length,stop:cl.filter(x=>x.triggered).length,
  win:cl.length?round(w/cl.length*100):null,mean:cl.length?round(ret.reduce((a,b)=>a+b,0)/cl.length):null,
  median:cl.length?round(ret[Math.floor(ret.length/2)]):null,worst:round(ret[0]),
  winAbs:w,cycleExpired:expired};
}
const subsets=dataset.filter(x=>x.p==='D'||x.p==='W'),data=subsets.flatMap(x=>x.episodes),
 weeklySSE=dataset.find(x=>x.index==='上证指数'&&x.p==='W');
const compare=keys.map(key=>({name:key,...summary(data,key)}));
const groups=subsets.map(x=>({index:x.index,period:x.period,total:x.episodes.length,
 rows:keys.map(key=>({name:key,...summary(x.episodes,key)}))}));
const matching=data.filter(e=>keys.every(k=>Number.isFinite(e.methods[k].returnPct)));
const matched=keys.map(key=>({name:key,n:matching.length,mean:round(matching.reduce((n,r)=>n+r.methods[key].returnPct,0)/matching.length)}));
const differences=data.filter(r=>r.methods.activeOnly.returnPct!==null&&r.methods.transferATR3.returnPct!==null).map(r=>({
 index:r.index,period:r.period,entryT:r.entryT,diff:round(r.methods.transferATR3.returnPct-r.methods.activeOnly.returnPct),
 baseline:r.methods.activeOnly.returnPct,transferred:r.methods.transferATR3.returnPct,
 expiry:r.cycleEndT,endReason:r.cycleEndReason
}));
const sig=weeklySSE.episodes.filter(e=>e.entryT==='2022-11-04'||e.entryT==='2023-12-29').map(e=>({...e,methods:Object.fromEntries(Object.entries(e.methods).map(([k,v])=>[k,{...v,returnPct:round(v.returnPct),closeReturnPct:round(v.closeReturnPct)}]))}));
const five=data.filter(e=>e.cycleEndReason==='3 opposite-color columns'&&e.methods.activeOnly.reason==='topSell'&&e.methods.transferATR3.reason==='transferredATR');
console.log('TRANCHE_SUMMARY',JSON.stringify({asOf:latest.generated_at_utc,total:data.length,groups:subsets.length,per:compare,matched,flatStart:matching.length,
 cycleExpiredCount:data.filter(e=>e.cycleEndReason==='3 opposite-color columns').length,
 stopAfterExpiryCount:five.length,
 pairedSwitches:{better:differences.filter(x=>x.diff>0).length,worse:differences.filter(x=>x.diff<0).length,
  equal:differences.filter(x=>x.diff===0).length},
 expiryDifferences:differences.filter(x=>x.diff!==0).sort((a,b)=>a.diff-b.diff).slice(0,10)}));
console.log('TRANCHE_SSE_WEEKLY',JSON.stringify(sig));
console.log('TRANCHE_GROUPS',JSON.stringify(groups));
console.log('TRANCHE_ALL_PASS');
