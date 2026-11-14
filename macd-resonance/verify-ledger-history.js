#!/usr/bin/env node
"use strict";
const fs=require("fs"),vm=require("vm"),path=require("path"),assert=require("node:assert/strict");
const root=__dirname;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const cut=code.indexOf('byId("refresh").onclick=load;');
assert(cut>0);
const ctx=vm.createContext({window:{},document:{},console});
vm.runInContext(code.slice(0,cut)+";this.api={calculate,completedPeriodBars,mergeHistoricalBars};",ctx,{timeout:5000});
const {calculate,completedPeriodBars,mergeHistoricalBars:merge}=ctx.api;
const data=name=>JSON.parse(fs.readFileSync(path.join(root,"data",name),"utf8"));
const latest=data("latest.json"),daily=data("history-101.json"),weekly=data("history-102.json"),minute=data("history-15.json");
const names=["上证指数","深证成指","创业板指","科创50"];
const now=process.env.MACD_HISTORY_AS_OF;
const outputs=[];
for(let j=0;j<4;j++){
 const m=merge(minute.data[j]["15"],latest.data[j]["15"]);
 const barsByPeriod=completedPeriodBars({
  "15":m,"60":latest.data[j]["60"],
  "101":merge(daily.data[j]["101"],latest.data[j]["101"]),
  "102":merge(weekly.data[j]["102"],latest.data[j]["102"])
 },now);
 const minuteDates=[...new Set(m.map(b=>b.t.slice(0,10)))];
 const missingOpen=new Set(minuteDates.map(d=>d+"T09:45"));
 const missingInterior=new Set(minuteDates.map(d=>d+"T10:00"));
 for(const removed of [missingOpen,missingInterior]){
  const complete=completedPeriodBars({"15":m},now);
  const partial=completedPeriodBars({"15":m.filter(b=>!removed.has(b.t))},now);
  for(const [period,close] of [["60","10:30"],["90","11:00"],["120","11:30"]]){
   assert.deepEqual(partial[period],complete[period].filter(b=>b.t.slice(11)!==close),
    "A real source gap can only remove its own aggregation bucket: "+names[j]+" "+period);
  }
 }
 for(const [p,bars]of Object.entries(barsByPeriod)){
  const v=calculate(bars);assert(v&&v.bars.length>60,"No data "+names[j]+" "+p);
  assert(bars.every((b,i)=>[b.o,b.c,b.h,b.l].every(Number.isFinite)&&b.l>0&&
   b.l<=Math.min(b.o,b.c)+.011&&b.h>=Math.max(b.o,b.c)-.011&&(!i||bars[i-1].t<b.t)),
   "Finite, ordered OHLC for "+names[j]+" "+p);
  const buys=v.events.filter(e=>e.type==="buy"),ledger=v.structureLedger;
  assert.equal(ledger.length,buys.length,"Every first buy requires one bottom structure");
  assert.equal(new Set(ledger.map(c=>c.structureId)).size,ledger.length,"Unique bottom structure keys");
  const initialEntries=[...v.trades,...v.positions].filter(t=>t.entryType==="buy");
  assert.equal(initialEntries.length,buys.length,"Every first buy opens exactly one risk unit");
  assert.equal(v.trades.length,v.stats.completed,"Completed trade counter equals actual closed units");
  assert.equal(v.positions.length,v.stats.open,"Open unit counter equals open ledger");
  assert.equal(v.trades.filter(t=>t.exitType==="topSell").length,v.stats.sellExits);
  assert.equal(v.trades.filter(t=>t.exitType!=="topSell").length,v.stats.stopExits);
  const ids=new Set(ledger.map(l=>l.structureId));
  for(const t of [...v.trades,...v.positions]){
   assert(ids.has(t.structureId),"Trade references a real structure");
   assert(t.campaignI===Number(t.structureId.slice(2)),"Campaign linked to original buy1");
   assert(t.buySignals.length>=1,"Trade has at least one entry signal");
  }
  for(const t of v.trades.filter(t=>t.exitType==="stop")){
   const s=v.events.find(e=>e.i===t.exitI&&e.type==="structureFailure"&&e.structureId===t.structureId);
   assert(s,"Every stop has same-structure technical failure");
   const origin=ledger.find(l=>l.structureId===t.structureId);
   assert(t.exitI===origin.endI,"Stop on exact structure invalidation bar");
  }
  const correctionBuys=v.events.filter(e=>e.type==="correctionBuy");
  const correctionStops=v.events.filter(e=>e.type==="correctionStop");
  const correctionUnits=[...v.trades,...v.positions].filter(t=>t.entryType==="correctionBuy");
  assert.equal(v.stats.correctionBuy,correctionBuys.length,"Correction buy signal count");
  assert.equal(v.stats.correctionBuyUnits,correctionUnits.length,"Correction buy risk units");
  assert.equal(v.stats.correctionStop,new Set(correctionStops.map(e=>e.i)).size,"Distinct correction stop triggers, not risk units");
  assert.equal(v.stats.correctionStopUnits,correctionStops.length,"Unit-level correction stop exits");
  assert.equal(v.stats.correctionStopUnits,v.trades.filter(t=>t.exitType==="correctionStop").length,"No duplicate stop executions");
  if(j===0&&p==="D"){
   const example=correctionBuys.find(e=>e.t==="2014-09-12");
   const sameStop=correctionStops.filter(e=>e.t==="2014-09-16");
   assert.equal(example?.linkedStructureIds?.length,7,"One correction signal reopens seven structure units");
   assert.equal(sameStop.length,7,"One 2014-09-16 DIF trigger closes seven units");
   console.log("LEDGER_SSE_CORRECTION_SIGNAL",JSON.stringify({
    correctionBuy:example.t,signalCount:1,buyUnits:example.linkedStructureIds.length,
    correctionStop:"2014-09-16",stopSignals:1,stopUnits:sameStop.length}));
  }
  outputs.push({index:names[j],period:p,bars:v.bars.length,buys:buys.length,
   closed:v.trades.length,open:v.positions.length,stops:v.stats.failStop,
   topExits:v.stats.sellExits,correctionStops:v.stats.correctionStop,correctionStopUnits:v.stats.correctionStopUnits});
 }
}
const sse=calculate(completedPeriodBars({"101":merge(daily.data[0]["101"],latest.data[0]["101"])},now).D);
const janBuy=sse.events.find(e=>e.type==="buy"&&e.t.startsWith("2024-01-16"));
if(janBuy){
 const stop=sse.events.find(e=>e.type==="stopLoss"&&e.structureId===janBuy.structureId);
 assert(stop,"2024-01-16 new structure must get its own independent stop");
 console.log("SSE_JAN2024_INDEPENDENT_STOP",JSON.stringify({buy:janBuy.t,structure:janBuy.structureId,stop:stop.t}));
}
const summary=outputs.reduce((x,y)=>({periods:x.periods+1,buy1:x.buy1+y.buys,
 closed:x.closed+y.closed,open:x.open+y.open,stops:x.stops+y.stops,topExits:x.topExits+y.topExits}),{periods:0,buy1:0,closed:0,open:0,stops:0,topExits:0});
console.log("LEDGER_REAL_HISTORY_SUMMARY",JSON.stringify(summary));
console.log("LEDGER_HISTORY_BY_SERIES",JSON.stringify(outputs));
console.log("LEDGER_REAL_HISTORY_ALL_PASS");
