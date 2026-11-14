#!/usr/bin/env node
"use strict";
const fs=require("fs"),vm=require("vm"),path=require("path"),assert=require("node:assert/strict");
const root=__dirname;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const cut=code.indexOf('byId("refresh").onclick=load;');
assert(cut>0);
const ctx=vm.createContext({window:{},document:{},console});
vm.runInContext(code.slice(0,cut)+";this.api={calculate,resample,resampleHourly};",ctx,{timeout:5000});
const {calculate,resample,resampleHourly}=ctx.api;
const data=name=>JSON.parse(fs.readFileSync(path.join(root,"data",name),"utf8"));
const latest=data("latest.json"),daily=data("history-101.json"),weekly=data("history-102.json"),minute=data("history-15.json");
const names=["上证指数","深证成指","创业板指","科创50"];
const merge=(...xs)=>{
 const m=new Map();
 for(const arr of xs)for(const b of arr||[])if(b&&typeof b.t==="string"&&Number.isFinite(b.c))m.set(b.t,b);
 return [...m.values()].sort((a,b)=>a.t.localeCompare(b.t));
};
const outputs=[];
for(let j=0;j<4;j++){
 const m=merge(minute.data[j]["15"],latest.data[j]["15"]);
 const h=merge(latest.data[j]["60"]);
 const barsByPeriod={
  "15":m,"60":h.length>65?h:resample(m,4),
  "90":resample(m,6),"120":h.length>65?resampleHourly(h):resample(m,8),
  D:merge(daily.data[j]["101"],latest.data[j]["101"]),
  W:merge(weekly.data[j]["102"],latest.data[j]["102"])
 };
 for(const [p,bars]of Object.entries(barsByPeriod)){
  const v=calculate(bars);assert(v&&v.bars.length>60,"No data "+names[j]+" "+p);
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
  outputs.push({index:names[j],period:p,bars:v.bars.length,buys:buys.length,
   closed:v.trades.length,open:v.positions.length,stops:v.stats.failStop,
   topExits:v.stats.sellExits,correctionStops:v.stats.correctionStop});
 }
}
const sse=calculate(merge(daily.data[0]["101"],latest.data[0]["101"]));
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
