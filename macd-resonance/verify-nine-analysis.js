#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const data = require("./analysis-data.json");
const model = require("./analysis-nine");
const metrics = require("./analysis-metrics");
const { readSeries } = require("./research-success");
const { series } = readSeries(__dirname, data.asOf);
assert.equal(data.nineSchema, 1);
assert(data.nineSamples.length > data.samples.filter(r => r.signal === "buy").length, "Study all nines, not just MACD-entry nines");
const unique = new Set();
let expectedCount = 0;
for (const { id: period } of data.periods) for (let index = 0; index < 4; index++) {
  const { bars, result } = series[index][period];
  for (let i = 12; i < bars.length; i++) {
    const direction = Math.sign(bars[i].c - bars[i - 4].c);
    const same = j => j >= 4 && Math.sign(bars[j].c - bars[j - 4].c) === direction;
    if (!direction || !Array.from({ length: 9 }, (_, j) => same(i - j)).every(Boolean) || same(i - 9)) continue;
    expectedCount++;
    const row = data.nineSamples.find(r => r.period === period && r.index === index && r.barIndex === i);
    assert(row, "Every first nine in each run must be archived");
    const key = [period,index,row.time].join("/"); assert(!unique.has(key)); unique.add(key);
    assert.equal(row.side, direction < 0 ? "low" : "high");
    assert.equal(row.close, bars[i].c); assert.equal(row.time, bars[i].t);
    assert.equal(row.sequenceStart, bars[i - 8].t);
    assert.equal(row.trendAt, bars[i - 9].t);
    if (result) assert.equal(result.nine[i], direction * 9, "Nine identity agrees with the chart's capped counter");
    const avg = at => at >= 59 ? bars.slice(at - 59, at + 1).reduce((sum,b) => sum + b.c, 0) / 60 : null;
    const current = avg(i - 9), previous = avg(i - 14);
    for (const [a,b] of [[current,row.trendMa[0]],[previous,row.trendMa[1]]]) {
      if (a === null) assert.equal(b, null); else assert(Math.abs(a - b) < 1e-7, "Trend averages use only closes before the sequence");
    }
    if (current === null || previous === null) assert.equal(row.trend, "unknown");
    else if (Math.abs(current - previous) > Math.max(Math.abs(current),1) * 1e-10) assert.equal(row.trend, current > previous ? "up" : "down");
    const next = bars[i + 1], valid = !!next && Math.sign(next.c - bars[i - 3].c) === direction;
    assert.deepEqual(row.tenCheck, next ? [next.t, next.c, valid] : null);
    const point = at => bars[at] ? [bars[at].t, bars[at].c] : null;
    assert.deepEqual(row.forward, metrics.horizons.map(n => point(i + n)));
    assert.deepEqual(row.tenForward, metrics.horizons.map(n => valid ? point(i + 1 + n) : null));
  }
}
assert.equal(expectedCount, data.nineSamples.length);
let comparisons = 0;
for (const scope of ["all","four","same"]) for (const index of ["all",0,1,2,3]) for (const horizon of metrics.horizons) for (const goal of ["reversal","up","down"]) {
  const options = {scope,index,horizon,goal};
  const base = model.evaluate(data,options);
  const c = model.continuation(base);
  assert.equal(c.valid + c.invalid + c.waiting, base.length);
  const eligible = model.evaluate(data,{...options,stage:"eligibleNine"});
  const tens = model.evaluate(data,{...options,stage:"ten"});
  assert.deepEqual(eligible.map(r=>[r.period,r.index,r.time]),tens.map(r=>[r.period,r.index,r.time]));
  const early = model.evaluate(data,{...options,stage:"pairedNine"});
  const late = model.evaluate(data,{...options,stage:"pairedTen"});
  assert.deepEqual(early.map(r=>[r.time,r.index,r.period,r.outcome]),late.map(r=>[r.time,r.index,r.period,r.outcome]),"Paired endpoint and population must match");
  for (const row of [...base,...tens,...late]) {
    const range = metrics.sampleRange(data,row.period,scope);
    assert(row.trendAt < row.sequenceStart && row.sequenceStart < row.time);
    assert(!row.outcome || metrics.day(row.outcome[0]) <= range.to);
    if (row.stage !== "nine") assert(metrics.day(row.entry[0]) <= range.to);
    if (row.outcome) {
      assert.equal(row.priceMove,100*(row.outcome[1]/row.entry[1]-1));
      const sign = goal === "up" ? 1 : goal === "down" ? -1 : row.side === "low" ? 1 : -1;
      assert.equal(row.result,row.priceMove*sign);
    } else assert.equal(row.result,null);
  }
  for (const rows of [base,eligible,tens,early,late]) {
    const s=model.summarize(rows);assert.equal(s.total,s.evaluated+s.pending);
    assert.equal(s.rate,s.evaluated?s.wins/s.evaluated:null);
  }
  comparisons++;
}
// Repricing and scope boundaries: delayed entry is higher, while both methods share an original endpoint.
const row={period:"D",index:0,side:"low",time:"2026-01-01",close:100,barIndex:100,
  sequenceStart:"2025-12-20",trendAt:"2025-12-19",trend:"up",trendMa:[100,99],
  forward:[["2026-01-06",105],["2026-01-11",105],null],tenCheck:["2026-01-02",110,true],tenForward:[["2026-01-07",120],["2026-01-12",120],null]};
const fixture={asOf:"2026-01-20T18:00",periods:[{id:"D"}],coverage:[{period:"D",from:"2026-01-01",to:"2026-01-01"}],nineSamples:[row]};
assert.equal(model.evaluate(fixture,{scope:"four"})[0].tenStatus,"waiting");
assert.equal(model.evaluate(fixture,{scope:"four",stage:"ten"}).length,0);
const ten=model.evaluate(fixture,{stage:"ten",horizon:5})[0];assert.equal(ten.entry[1],110);assert.equal(ten.outcome[0],"2026-01-07");
assert.equal(ten.trend,"up");
assert(model.evaluate(fixture,{stage:"pairedNine",horizon:5})[0].result>0);
assert(model.evaluate(fixture,{stage:"pairedTen",horizon:5})[0].result<0);
row.tenCheck[2]=false;assert.equal(model.continuation(model.evaluate(fixture)).invalid,1);
assert.equal(model.evaluate(fixture,{stage:"ten"}).length,0);
row.tenCheck=null;assert.equal(model.continuation(model.evaluate(fixture)).waiting,1);
row.forward[0][1]=100;assert.equal(model.summarize(model.evaluate(fixture,{horizon:5})).wins,0);
row.side="high";assert.equal(model.summarize(model.evaluate(fixture,{horizon:5})).wins,0);
// A long run must produce only one nine, and trend must remain frozen when the future arrives.
const bars=Array.from({length:110},(_,i)=>({t:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),c:100+i}));
for(let i=80;i<bars.length;i++)bars[i].c=bars[i-4].c-2;
const generated=model.buildNineRows([{D:{bars}}],[{id:"D"}]);
const low=generated.filter(r=>r.side==="low");assert.equal(low.length,1);assert.equal(low[0].barIndex,88);assert.equal(low[0].trend,"up");
const prefix=model.buildNineRows([{D:{bars:bars.slice(0,89)}}],[{id:"D"}]).find(r=>r.side==="low");
assert.equal(prefix.tenCheck,null);assert.deepEqual(prefix.trendMa,low[0].trendMa);assert.equal(prefix.trend,low[0].trend);
assert.throws(()=>model.evaluate(fixture,{horizon:7}),/Invalid nine/);
console.log("NINE_ANALYSIS_PASS",JSON.stringify({series:24,sequences:expectedCount,comparisons,scopeCensoring:true,repricedTen:true,pairedEndpoints:true,frozenTrend:true}));
// Graphs must show the exact source OHLC, frozen trend and counted endpoint.
const charts=require('./analysis-nine-charts');
assert.equal(data.chartSchema,1);
for(let index=0;index<4;index++)for(const {id}of data.periods){
 assert.deepEqual(data.nineHistory[index][id],Array.from(series[index][id].bars,b=>[b.t,b.o,b.h,b.l,b.c]));
}
let chartChecks=0;
for(const stage of ['nine','ten','pairedNine','pairedTen'])for(const horizon of metrics.horizons){
 const rows=model.evaluate(data,{stage,horizon,goal:'up'});
 for(const row of rows){if(!row.outcome)continue;const chart=charts.snapshot(data,row);
  assert.equal(chart.bars.at(-1).t,row.outcome[0]);assert.equal(chart.bars.at(-1).c,row.outcome[1]);
  assert.equal(chart.bars.find(b=>b.i===chart.entryIndex).c,row.entry[1]);
  assert(chart.bars.every(b=>metrics.day(b.t)<=row.rangeEnd));
  if(row.trendMa[0]!==null)assert(Math.abs(chart.bars.find(b=>b.i===chart.trendIndex).ma-row.trendMa[0])<1e-7);
  chartChecks++;
 }
 for(const trend of ['up','down'])for(const side of ['low','high']){
  const picked=charts.examples(rows,{trend,side});
  for(const [key,example]of Object.entries(picked))if(example){
   assert.equal(example.priceMove>0,key==='success');
   assert(!rows.some(r=>r.trend===trend&&r.side===side&&r.outcome&&(r.priceMove>0)===(key==='success')&&r.time>example.time),'Examples are the latest matching outcomes, not selected by return size');
  }
 }
}
assert(require('node:fs').statSync(__dirname+'/analysis-data.json').size<4_000_000,'Complete archive stays below Vercel response limit');
console.log('NINE_CHARTS_PASS',JSON.stringify({chartChecks,exactOHLC:true,exactEndpoints:true,recentSuccessFailure:true}));
