#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const model=require("./analysis-patterns");
const metrics=require("./analysis-metrics");
const {readSeries}=require("./research-success");
const data=require("./analysis-data.json");
const {series,engine}=readSeries(__dirname,data.asOf);
assert.equal(data.patternSchema,1);
assert.equal(model.rules.length,20);
let anchors=0,delays=0;
const atTime=(period,time)=>["D","W"].includes(period) ? time.slice(0,10)+"T15:08" : time;
for(const row of data.samples.filter(r=>r.signal==="buy")) {
 const {pattern:p,barIndex:i}=row, v=series[row.index][row.period].result;
 assert.deepEqual(Object.keys(p.features).sort(),model.rules.map(r=>r.id).sort());
 assert(Object.values(p.features).every(v=>v===null || typeof v==="boolean"));
 const closes=v.bars.slice(0,i+1).map(b=>b.c);
 const fast=engine.ema(closes,12),slow=engine.ema(closes,26),dif=fast.map((x,j)=>x-slow[j]),dea=engine.ema(dif,9);
 assert.equal(p.values.dif,dif[i]);assert.equal(p.values.dea,dea[i]);
 assert.equal(p.features.cross_now,i>0 && dif[i]>dea[i] && dif[i-1]<=dea[i-1],"Same-bar golden cross uses only the prefix");
 assert.equal(p.features.dea_rising,p.features.dif_above_dea,"DEA slope and DIF>DEA are not independent confirmations");
 const higherPeriod=model.higherPeriods[row.period], higher=higherPeriod && series[row.index][higherPeriod].result;
 const known=atTime(row.period,row.time);
 const available=higher ? higher.bars.filter(b=>atTime(higherPeriod,b.t)<=known) : [];
 if(p.values.higher) {
  assert.equal(p.values.higher.time,available.at(-1).t,"Higher timeframe cannot use an unfinished bar");
  assert(p.values.higher.knownAt<=known);
  const hc=available.map(b=>b.c),hf=engine.ema(hc,12),hs=engine.ema(hc,26),hd=hf.map((x,j)=>x-hs[j]);
  assert.equal(p.values.higher.dif,hd.at(-1));
  assert.equal(p.features.higher_dif_rising,hd.length>=2 ? hd.at(-1)>hd.at(-2) : null);
 } else assert.equal(available.length,0);
 // Check the complete ordered confirmation window, including expiry and actual repricing.
 let entry=i;
 if(v.dif[i]<=v.dea[i]) {
  const candidates=[];
  for(let j=i+1;j<=Math.min(i+5,v.bars.length-1);j++) if(v.dif[j]>v.dea[j] && v.dif[j-1]<=v.dea[j-1]) candidates.push(j);
  entry=candidates[0]??null;
 }
 const d=p.delayed;
 assert.deepEqual(d.entry,entry===null ? null : [v.bars[entry].t,v.bars[entry].c]);
 assert.equal(d.delay,entry===null ? null : entry-i);
 assert.equal(d.status,entry!==null ? "entered" : v.bars.length-1-i>=5 ? "expired" : "waiting");
 assert.deepEqual(d.forward,metrics.horizons.map(n=>entry!==null && v.bars[entry+n] ? [v.bars[entry+n].t,v.bars[entry+n].c] : null));
 if(entry!==null && entry>i)delays++;
 anchors++;
}
let comparisons=0;
for(const scope of ["all","four","same"]) for(const index of ["all",0,1,2,3]) for(const horizon of metrics.horizons) {
 const original=metrics.evaluate(data,{mode:"buy",index,scope,horizon});
 for(const rule of model.rules) {
  const comparison=model.compare(data,{index,scope,horizon,rule:rule.id});
  const eligible=original.filter(r=>r.pattern.features[rule.id]!==null), matched=eligible.filter(r=>r.pattern.features[rule.id]);
  assert.deepEqual(comparison.rows.map(r=>r.time+"/"+r.index+"/"+r.period),matched.map(r=>r.time+"/"+r.index+"/"+r.period));
  assert.deepEqual(comparison.baseline,metrics.summarize(eligible),"Compare against the same evaluable population");
  assert.deepEqual(comparison.stats,metrics.summarize(matched));
  comparisons++;
 }
 const delayed=model.evaluateDelayed(data,{index,scope,horizon});
 const s=model.delayedSummary(delayed);
 assert.equal(s.entered+s.expired+s.waiting,delayed.length);
 assert.equal(s.evaluated+s.pending,s.entered,"Expired opportunities are not pending entry outcomes");
 assert(delayed.every(r=>!r.entry || r.entry[0].slice(0,10)<=r.rangeEnd));
 assert(delayed.every(r=>!r.outcome || r.outcome[0].slice(0,10)<=r.rangeEnd));
 for(const row of model.paired(delayed,horizon)) {
  assert(row.entry[0]<=row.outcome[0]);
  assert.equal(row.earlyResult,(row.outcome[1]/row.close-1)*100);
  assert.equal(row.result,(row.outcome[1]/row.entry[1]-1)*100);
 }
}
for(const minBars of [60,130])assert(model.evaluate(data,{minBars}).every(r=>r.barIndex+1>=minBars));
const flags=Object.fromEntries(model.rules.map(r=>[r.id,true]));
const sample={period:"D",index:0,signal:"buy",time:"2026-01-01",close:100,barIndex:140,
 covered:4,matched:2,nineAge:null,exit:null,forward:[["2026-01-06",105],["2026-01-11",105],["2026-01-21",105]],
 pattern:{features:flags,delayed:{entry:["2026-01-03",110],delay:2,status:"entered",
 checks:["2026-01-02","2026-01-03","2026-01-04","2026-01-05","2026-01-06"],
 forward:[["2026-01-08",120],["2026-01-13",120],null]}}};
const fixture={asOf:"2026-01-20T18:00",periods:[{id:"D",label:"日线"}],coverage:[{period:"D",index:0,from:"2026-01-01",to:"2026-01-02"}],samples:[sample]};
const censored=model.evaluateDelayed(fixture,{scope:"four",horizon:5})[0];
assert.equal(censored.entry,null);assert.equal(censored.entryStatus,"waiting");
assert.equal(censored.outcome,null);
const entered=model.evaluateDelayed(fixture,{scope:"all",horizon:5});
assert.equal(entered[0].entry[1],110);assert.equal(entered[0].outcome[0],"2026-01-08");
assert(entered[0].result>0,"The delayed-entry horizon starts from its actual entry");
const pair=model.paired(entered,5)[0];
assert.equal(pair.outcome[0],"2026-01-06");assert(pair.earlyResult>0 && pair.result<0,"Same endpoint retains the higher confirmation price");
assert.equal(model.paired(model.evaluateDelayed(fixture,{scope:"four",horizon:5}),5).length,0);
fixture.samples[0].pattern.features.cross_now=null;
assert.equal(model.compare(fixture,{rule:"cross_now"}).baseline.total,0,"Missing feature coverage is excluded from the comparable baseline");
console.log("BUY1_PATTERNS_PASS",JSON.stringify({anchors,delayedConfirmations:delays,comparisons,causalHigherTimeframe:true,repricedEntry:true,scopeCensoring:true}));
