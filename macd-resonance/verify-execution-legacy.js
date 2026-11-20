#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {loadEngine,parseQuotes,simulate}=require('./research-execution-core.cjs');
const root=path.resolve(process.argv[2]||path.join(__dirname,'research/execution-20261120'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const protocol=read('protocol.json'),market=protocol.markets[0];
const file=path.join(root,'inputs/510210-legacy-unadjusted.json');
const old=spawnSync(process.execPath,[path.join(__dirname,'research-etf-execution.js'),file],{encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(old.status,0,old.stderr);
const legacy=JSON.parse(old.stdout),engine=loadEngine(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'));
const a=read('inputs/history-101.json'),b=read('inputs/latest.json');
const bars=engine.mergeHistoricalBars(a.data[0]['101'],b.data[0]['101']).filter(v=>v.t<=legacy.cutoff);
const signal=engine.calculate(bars),quotes=parseQuotes(JSON.parse(fs.readFileSync(file,'utf8')),market);
const options=[{}, {costs:{fee:.0005,minimumFee:5,slippage:.002}},{passiveWeight:.1},{passiveWeight:.5},{passiveWeight:1}];
const results=options.map((extra,i)=>{
 const s=simulate({market,signal,quotes,protocol,to:legacy.cutoff,buyFailure:'cancel',...extra}).summary;
 const expected=legacy.scenarios[i];
 assert.equal(s.endingNav,expected.endingNav);
 assert.equal(Number((s.totalReturn*100).toFixed(3)),expected.returnPct);
 assert.equal(Number((s.maxDrawdown*100).toFixed(3)),expected.maxDrawdownPct);
 assert.equal(Number((s.avgExposure*100).toFixed(3)),expected.avgExposurePct);
 return {name:expected.name,nav:s.endingNav,returnPct:expected.returnPct,maxDrawdownPct:expected.maxDrawdownPct,averageExposurePct:expected.avgExposurePct};
});
const result={status:'PASS',cutoff:legacy.cutoff,legacyETFSourceSHA256:legacy.etfSourceSHA256,scenarios:results};
fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
fs.writeFileSync(path.join(root,'outputs/legacy-reconciliation.json'),JSON.stringify(result,null,2)+'\n');
console.log('LEGACY_EXECUTION_RECONCILIATION_PASS',JSON.stringify(result));
