#!/usr/bin/env node
"use strict";
const assert=require('node:assert/strict'),data=require('./analysis-data.json'),model=require('./analysis-early'),charts=require('./analysis-research-charts'),metrics=require('./analysis-metrics'),patterns=require('./analysis-patterns'),{readSeries}=require('./research-success');
const {series,engine}=readSeries(__dirname,data.asOf);
assert.equal(data.earlySchema,1);let watches=0,nines=0,prefixes=0,observations=0;
for(const{id:period}of data.periods)for(let index=0;index<4;index++){
 const v=series[index][period],raw=engine.scanStructure(v.bars,v.result.dif,v.result.hist).events;
 const rows=data.earlySamples.filter(r=>r.period===period&&r.index===index);assert.equal(rows.length,raw.filter(e=>e.type==='watchBuy'&&e.i>=59).length);
 const unique=new Set();
 for(const row of rows){
  watches++;assert(!unique.has(row.watch));unique.add(row.watch);
  const w=raw.find(e=>e.type==='watchBuy'&&e.i===row.watch);assert(w);assert.equal(row.refDif,w.ref.dif);assert.equal(row.refClose,w.ref.close);
  const end=raw.find(e=>e.regionStart===w.regionStart&&e.i>=w.i&&['buy','invalid','expired'].includes(e.type));assert.deepEqual(row.resolution,end?{i:end.i,type:end.type}:null);assert.equal(row.formed,end?.type==='buy'?end.i:null);
  let run=0,first=null;for(let i=4;i<(end?.i??v.bars.length);i++){run=v.bars[i].c<v.bars[i-4].c?run+1:0;if(run===9&&i>=w.i&&first===null)first=i;}
  assert.equal(row.nine,first,'First low9 must be inside an active watch and strictly before confirmation/failure');
  if(first!==null)nines++;
  const actual=row.formed===null?null:v.result.trades.find(t=>t.entryType==='buy'&&t.entryI===row.formed);assert.deepEqual(row.exit,actual?{i:actual.exitI,type:actual.exitType}:null,'Confirmed entries preserve their own structure exit');
  for(const[at,ctx]of [[row.watch,row.contextWatch],[row.nine,row.contextNine]])if(at!==null){
   const hp=patterns.higherPeriods[period],h=hp?patterns.latestKnown(series[index][hp].bars,hp,patterns.knownAt(period,v.bars[at].t)):-1;
   assert.equal(ctx.higherUp,h>=1?series[index][hp].result.dif[h]>series[index][hp].result.dif[h-1]:null);
   if(h>=0)assert(patterns.knownAt(hp,ctx.higherAt)<=patterns.knownAt(period,v.bars[at].t));
  }
 }
 const indicator=charts.indicators(data.nineHistory[index][period]);for(const key of ['dif','dea','hist'])for(let i=0;i<v.bars.length;i++)assert(Math.abs(indicator[key][i]-v.result[key][i])<1e-8,'Research chart indicators match the live engine exactly');
 // Recompute the event stream on genuine history prefixes, including low9 before a future confirmation.
 const anchors=[rows[0]?.watch,rows.find(r=>r.nine!==null)?.nine].filter(Number.isFinite);
 for(const anchor of anchors){
  const cut=Math.min(v.bars.length,anchor+2),prefixBars=v.bars.slice(0,cut),prefixResult=engine.calculate(prefixBars),copy=series.map(s=>({...s}));copy[index][period]={bars:prefixBars,result:prefixResult};
  const rebuilt=model.buildRows(copy,[{id:period}],engine).filter(r=>r.index===index),truncated={...data,nineHistory:data.nineHistory.map(s=>({...s}))};truncated.nineHistory[index][period]=data.nineHistory[index][period].slice(0,cut);
  for(const cohort of ['nine','all']){const a=model.evaluate(truncated,{period,index,cohort}),b=model.evaluate({...truncated,earlySamples:rebuilt},{period,index,cohort});
  assert.deepEqual(a.map(r=>[r.id,r.nine,r.formedInWindow,r.resolutionInWindow,r.plans,r.priceEdge,r.lead]),b.map(r=>[r.id,r.nine,r.formedInWindow,r.resolutionInWindow,r.plans,r.priceEdge,r.lead]),'Future bars cannot change earlier eligible signals or prices');prefixes++;}
 }
}
assert.equal(watches,data.earlySamples.length);
for(const scope of ['all','four','same'])for(const index of ['all',0,1,2,3])for(const horizon of [5,10,20])for(const cohort of ['nine','all']){
 const rows=model.evaluate(data,{scope,index,horizon,cohort});
 for(const row of rows){
  const bars=data.nineHistory[row.index][row.period];if(cohort==='nine')assert(row.nine!==null&&row.nine<(row.resolution?.i??Infinity));
  for(const [kind,p]of Object.entries(row.plans)){
   if(p.entry){assert.equal(p.entry[2],p.signal[2]+1);assert.equal(p.entry[1],bars[p.entry[2]][1]);assert(p.entry[2]<=row.available);assert(metrics.day(p.entry[0])<=row.rangeEnd);
    assert(p.exit[2]>=p.entry[2]);assert.equal(p.exit[1],bars[p.exit[2]][p.closed?1:4]);assert(p.mae<=1e-10);assert(p.preMae<=1e-10);
    if(row.complete)assert.equal(p.result,100*(p.exit[1]/p.entry[1]-1));else assert.equal(p.result,null);
   }else assert.equal(p.result,row.complete?0:null,'Cash is 0% only after a common observation endpoint exists');
  }
  if(row.complete){assert.equal(row.endpoint[2],row.anchor+horizon);assert.equal(row.delta,row.plans.nine.result-row.plans.standard.result);}
  if(row.priceEdge!==null){assert.equal(row.priceEdge,100*(row.plans.standard.entry[1]/row.plans.nine.entry[1]-1));assert(row.lead>0);}
  observations++;
 }
 for(const kind of Object.keys(model.plans)){const s=model.summarize(rows,kind),done=rows.filter(r=>r.complete);assert.equal(s.evaluated,s.entered+s.cash);assert.equal(s.total,s.evaluated+s.pending);assert.equal(s.mean,done.length?done.reduce((a,r)=>a+r.plans[kind].result,0)/done.length:null);}
}
// Exact accounting examples: compare next opens; failed early trade remains while the standard plan stays in cash.
const bars=Array.from({length:95},(_,i)=>[new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10),100,110,95,100]);
bars[73]=[bars[73][0],90,100,85,95];bars[76]=[bars[76][0],105,112,100,108];bars[77]=[bars[77][0],108,115,105,110];
const row={id:'fixture',index:0,period:'D',watch:70,nine:72,formed:75,resolution:{i:75,type:'buy'},exit:null,trend:'up',contextWatch:{},contextNine:{}};
const fixture={asOf:bars.at(-1)[0]+'T18:00',coverage:[{period:'D',index:0,from:bars[0][0],to:bars.at(-1)[0]}],earlySamples:[row],nineHistory:[{D:bars}]};
let value=model.evaluate(fixture,{horizon:5})[0];assert.equal(value.plans.nine.entry[1],90);assert.equal(value.plans.standard.entry[1],105);assert.equal(value.priceEdge,100*(105/90-1));assert.equal(value.lead,3);assert.equal(value.plans.nine.exit[1],110);
row.formed=null;row.resolution={i:74,type:'invalid'};bars[75]=[bars[75][0],80,90,1,20];
value=model.evaluate(fixture,{horizon:5})[0];assert.equal(value.plans.nine.exit[1],80);assert.equal(value.plans.standard.result,0);assert.equal(value.delta,100*(80/90-1));assert(value.plans.nine.mae> -20,'The stop bar later low is not owned after an open exit');
fixture.coverage[0].to=bars[72][0];value=model.evaluate(fixture,{horizon:5,scope:'four'})[0];assert.equal(value.formedInWindow,null);assert.equal(value.plans.nine.entry,null);assert.equal(value.plans.nine.result,null);assert.equal(value.resolutionInWindow,null);
fixture.coverage[0].to=bars.at(-1)[0];row.nine=null;assert.equal(model.evaluate(fixture).length,0);value=model.evaluate(fixture,{cohort:'all',horizon:5})[0];assert.equal(value.plans.nine.result,0);assert.equal(model.summarize([value]).cash,1);
assert.throws(()=>model.evaluate(fixture,{horizon:2}));
console.log('EARLY_RESEARCH_PASS',JSON.stringify({watches,nines,prefixes,observations,nextOpen:true,failedSetupsIncluded:true,cashIncluded:true,noFuture:true}));
