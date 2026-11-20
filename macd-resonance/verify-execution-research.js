#!/usr/bin/env node
"use strict";
const assert=require('node:assert/strict');
const {simulate}=require('./research-execution-core.cjs');
const dates=['2020-01-02','2020-01-03','2020-01-06','2020-01-07','2020-01-08'];
const protocol={initialCash:100000,unitFraction:.1,entryExposureCap:.5,cutoff:dates[4],baseCosts:{fee:0,minimumFee:0,slippage:0}};
const market={id:'test',etf:'000000',listing:dates[0],splits:[],dividends:[]};
function q(i,price=10,extra={}){return {date:dates[i],o:price,c:price,h:price,l:price,volume:100000,amount:price*10000000,reference:price,laggedAverageShares:10000000,...extra};}
function signal(legs){return {bars:dates.map(t=>({t})),trades:legs.filter(x=>x.exitT),positions:legs.filter(x=>!x.exitT)};}
function leg(extra={}){return {structureId:'B:0',entryT:dates[0],entryI:0,campaignI:0,entryType:'buy',...extra};}
function run(opts={}){return simulate({market,protocol,quotes:dates.map((_,i)=>q(i)),signal:signal([leg()]),...opts});}

// These are deliberately synthetic accounting fixtures, never research prices.
let r=run({signal:signal([leg({exitT:dates[1],exitType:'topSell',exitI:1})]),quotes:[q(0),q(1),q(2,11),q(3,11),q(4,11)]});
assert.equal(r.fills[0].date,dates[1]);assert.equal(r.fills[1].date,dates[2]);
assert.equal(r.summary.endingNav,101000);assert.equal(r.units[0].totalNetPnl,1000);
assert(r.fills.every(f=>!f.signalT||f.date>f.signalT));

r=run({market:{...market,splits:[{date:dates[2],ratio:2}]},quotes:[q(0),q(1),q(2,5),q(3,5),q(4,5)]});
assert.equal(r.units[0].shares,2000);assert(r.equity.every(e=>e.nav===100000),'Split must not create profits');

r=run({market:{...market,dividends:[{record:dates[1],ex:dates[2],pay:dates[4],perShare:.1}]},
 signal:signal([leg({exitT:dates[1],exitType:'topSell',exitI:1})]),quotes:[q(0),q(1),q(2,9.9),q(3,9.9),q(4,9.9)]});
assert.equal(r.equity[2].cash,99900);assert.equal(r.equity[2].dividendReceivable,100);
assert.equal(r.equity[4].cash,100000);assert.equal(r.units[0].dividends,100);
assert.equal(r.summary.endingNav,100000,'Dividend and ex-price must reconcile even after sale');

r=run({quotes:[q(0),q(2),q(3),q(4)]});
assert.equal(r.fills[0].date,dates[2]);assert.equal(r.attempts[0].action,'defer');
r=run({quotes:[q(0),q(2),q(3),q(4)],signal:signal([leg({exitT:dates[1],exitType:'stop',exitI:1})])});
assert.equal(r.fills.length,0);assert(r.skipped.some(x=>x.reason==='exit_signalled_before_entry_filled'));
r=run({quotes:[q(0),q(2),q(3),q(4)],buyFailure:'cancel'});assert.equal(r.fills.length,0);

r=run({quotes:[q(0),q(1,11,{reference:10}),q(2),q(3),q(4)]});
assert.equal(r.fills[0].date,dates[2],'Do not assume a limit-up opening buy can fill');
r=run({capacityFraction:.01,quotes:[q(0),q(1,10,{laggedAverageShares:100000}),q(2,10,{laggedAverageShares:50000}),q(3,10,{laggedAverageShares:50000}),q(4)],
 signal:signal([leg({exitT:dates[1],exitType:'topSell',exitI:1})])});
assert.equal(r.fills[0].shares,1000);assert.deepEqual(r.fills.filter(f=>f.side==='sell').map(f=>f.shares),[500,500]);
assert.equal(r.summary.unitClosed,1);assert.equal(r.units[0].totalNetPnl,0);

const six=Array.from({length:6},(_,i)=>leg({structureId:'B:'+i,campaignI:i}));
r=run({signal:signal(six)});assert(r.summary.maxExposure<=.5+1e-8);assert.equal(r.summary.entries,5);
r=run({signal:signal([leg({entryType:'correctionBuy',correctionFromExitI:0})])});
assert.equal(r.fills.length,0);assert.equal(r.skipped[0].reason,'parent_top_sale_unfilled');
r=run({protocol:{...protocol,baseCosts:{fee:.0003,minimumFee:5,slippage:.0005}}});
assert.equal(r.fills[0].price,10.005);assert.equal(r.fills[0].commission,5);
assert.equal(r.summary.endingNav,99990.5);assert.equal(r.fills[0].shares,900);
console.log('EXECUTION_ACCOUNTING_FIXTURES_PASS: next-session execution, T+1, splits, dividends/receivables after sale, missing/limit orders, cancellation, partial fills, cap, correction parent and costs');
