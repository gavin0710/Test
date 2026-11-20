#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('./research-execution-core.cjs');
const {loadEngine,parseQuotes,simulate,windowMetrics,money,mean,sum}=core;
const folder=path.resolve(process.argv[2]||path.join(__dirname,'research/execution-20261120'));
const output=path.resolve(process.argv[3]||path.join(folder,'outputs'));
fs.mkdirSync(output,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const protocol=read(path.join(folder,'protocol.json')),freeze=read(path.join(folder,'freeze.json'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(sha(path.join(folder,'protocol.json')),freeze.protocolSHA256,'Frozen protocol changed');
const enginePath=fs.existsSync(path.join(folder,'inputs/engine.html'))?path.join(folder,'inputs/engine.html'):path.join(__dirname,'index.html');
assert.equal(sha(enginePath),freeze.engineSHA256,'Formal engine must remain fixed');
for(const [name,hash] of Object.entries(freeze.inputs))assert.equal(sha(path.join(folder,'inputs',name)),hash,'Pinned input changed '+name);
for(const [name,hash] of Object.entries(freeze.sources||{}))assert.equal(sha(path.join(folder,'sources',name)),hash,'Pinned source changed '+name);
const engine=loadEngine(fs.readFileSync(enginePath,'utf8'));
const daily=read(path.join(folder,'inputs/history-101.json')),latest=read(path.join(folder,'inputs/latest.json'));
const summaries=[],rolling=[],annual=[],periods=[],corrections=[],diagnostics=[],causality=[],audit=[];
function writeJSON(name,value){fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');}
function writeCSV(name,rows){
 if(!rows.length){fs.writeFileSync(path.join(output,name),'');return;}
 const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const cell=v=>{if(v===undefined||v===null)return '';const s=typeof v==='object'?JSON.stringify(v):String(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
 fs.writeFileSync(path.join(output,name),keys.map(cell).join(',')+'\n'+rows.map(r=>keys.map(k=>cell(r[k])).join(',')).join('\n')+'\n');
}
function saveRun(m,name,r,detail=true){
 r.summary.case=name;summaries.push(r.summary);
 if(detail){
  const prefix=m.etf+'-'+name;
  for(const key of ['equity','fills','units','independent','attempts','corporate'])writeCSV(prefix+'-'+key+'.csv',r[key]);
  writeJSON(prefix+'-ledger.json',r);
 }
 return r;
}
function matchPassive(common,target,field){
 let lo=1e-12,hi=1,best=null;
 for(let n=0;n<23;n++){
  const w=(lo+hi)/2,r=simulate({...common,passiveWeight:w});
  const value=r.summary[field];
  if(!best||Math.abs(value-target)<Math.abs(best.summary[field]-target))best=r;
  if(value<target)lo=w;else hi=w;
 }
 return best;
}
function orderSignature(signal,from,to){
 return [...core.compileOrders(signal,from,to)].flatMap(([date,orders])=>orders.map(o=>({date,...o})))
  .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)||a.side.localeCompare(b.side));
}

for(const m of protocol.markets){
 const bars=engine.mergeHistoricalBars(daily.data[m.index]['101'],latest.data[m.index]['101']).filter(b=>b.t<=protocol.cutoff);
 assert.equal(bars.at(-1).t,protocol.cutoff,'Common completed index cutoff required');
 const signal=engine.calculate(bars);
 const quotes=parseQuotes(read(path.join(folder,'inputs',m.etf+'-unadjusted.json')),m).filter(q=>q.date<=protocol.cutoff);
 assert.equal(quotes.at(-1).date,protocol.cutoff,'Common ETF cutoff required');
 const common={market:m,signal,quotes,protocol};
 const baseline=saveRun(m,'base',simulate(common));
 // Audit causality at every original entry/exit date and its preceding close.
 const full=orderSignature(signal,m.listing,protocol.cutoff);
 const tests=new Set(full.flatMap(o=>{const at=bars.findIndex(b=>b.t===o.date);return [at-1,at]}).filter(i=>i>=59));
 for(const at of [...tests].sort((a,b)=>a-b)){
  const date=bars[at].t,prefix=engine.calculate(bars.slice(0,at+1));
  assert.equal(JSON.stringify(orderSignature(prefix,m.listing,date)),JSON.stringify(full.filter(o=>o.date<=date)),m.etf+' future-dependent signal '+date);
 }
 causality.push({etf:m.etf,cuts:tests.size,passed:true});
 console.log('CAUSALITY_PASS',m.etf,tests.size);
 for(const c of protocol.costScenarios)if(c.name!=='base')saveRun(m,c.name,simulate({...common,costs:c}));
 const noCorrection=saveRun(m,'no_correction',simulate({...common,includeCorrections:false}));
 saveRun(m,'cancel_unfilled_buy',simulate({...common,buyFailure:'cancel'}));
 saveRun(m,'lagged_adv_1pct',simulate({...common,capacityFraction:.01}));
 saveRun(m,'one_extra_session_delay',simulate({...common,delay:2}));
 const passive={};
 for(const weight of protocol.benchmarks.weights)passive[weight]=saveRun(m,'buy_hold_'+Math.round(weight*100),simulate({...common,passiveWeight:weight}));
 const exposure=saveRun(m,'expost_exposure_matched',matchPassive(common,baseline.summary.avgExposure,'avgExposure'));
 const risk=saveRun(m,'expost_volatility_matched',matchPassive(common,baseline.summary.annualizedVolatility,'annualizedVolatility'));
 diagnostics.push({etf:m.etf,kind:'expost_matching',strategyExposure:baseline.summary.avgExposure,
  passiveExposureWeight:exposure.options.passiveWeight,passiveExposure:exposure.summary.avgExposure,
  strategyVolatility:baseline.summary.annualizedVolatility,passiveVolatilityWeight:risk.options.passiveWeight,
  passiveVolatility:risk.summary.annualizedVolatility});

 const holdout=protocol.validation.historicalHoldoutStart,trainTo='2023-12-31';
 const train=saveRun(m,'historical_train',simulate({...common,to:trainTo}));
 const trainExposure=matchPassive({...common,to:trainTo},train.summary.avgExposure,'avgExposure');
 const trainRisk=matchPassive({...common,to:trainTo},train.summary.annualizedVolatility,'annualizedVolatility');
 saveRun(m,'historical_holdout',simulate({...common,from:holdout}));
 saveRun(m,'holdout_train_exposure_weight',simulate({...common,from:holdout,passiveWeight:trainExposure.options.passiveWeight}));
 saveRun(m,'holdout_train_volatility_weight',simulate({...common,from:holdout,passiveWeight:trainRisk.options.passiveWeight}));
 saveRun(m,'holdout_buy_hold_100',simulate({...common,from:holdout,passiveWeight:1}));
 diagnostics.push({etf:m.etf,kind:'train_only_weights',trainTo,holdout,exposureWeight:trainExposure.options.passiveWeight,volatilityWeight:trainRisk.options.passiveWeight});

 saveRun(m,'common_period',simulate({...common,from:protocol.validation.commonStart}));
 saveRun(m,'common_buy_hold_100',simulate({...common,from:protocol.validation.commonStart,passiveWeight:1}));
 const commonStrategy=simulate({...common,from:protocol.validation.commonStart});
 saveRun(m,'common_expost_exposure_matched',matchPassive({...common,from:protocol.validation.commonStart},commonStrategy.summary.avgExposure,'avgExposure'));

 for(let year=Number(m.listing.slice(0,4));year<=Number(protocol.cutoff.slice(0,4));year++){
  const from=year+'-01-01',to=year+'-12-31';
  const a=windowMetrics(baseline.equity,from,to,protocol.initialCash),b=windowMetrics(exposure.equity,from,to,protocol.initialCash),c=windowMetrics(passive[1].equity,from,to,protocol.initialCash);
  if(a)annual.push({etf:m.etf,year,...a,matchedPassiveReturn:b.totalReturn,fullPassiveReturn:c.totalReturn,matchedExcess:a.totalReturn-b.totalReturn});
 }
 const stageWindows=[['2010_2013','2010-01-01','2013-12-31'],['2014_2015','2014-01-01','2015-12-31'],['2016_2018','2016-01-01','2018-12-31'],['2019_2021','2019-01-01','2021-12-31'],['2022_2023','2022-01-01','2023-12-31'],['2024_2026','2024-01-01',protocol.cutoff],['post_legacy_extension',protocol.validation.postLegacyExtension,protocol.cutoff]];
 for(const [name,from,to] of stageWindows){const a=windowMetrics(baseline.equity,from,to,protocol.initialCash),b=windowMetrics(exposure.equity,from,to,protocol.initialCash),c=windowMetrics(passive[1].equity,from,to,protocol.initialCash);if(a)periods.push({etf:m.etf,period:name,...a,matchedPassiveReturn:b.totalReturn,fullPassiveReturn:c.totalReturn,matchedExcess:a.totalReturn-b.totalReturn});}
 for(let k=0;;k++){
  const start=new Date(m.listing+'T00:00:00Z');start.setUTCFullYear(start.getUTCFullYear()+k);
  const end=new Date(start);end.setUTCFullYear(end.getUTCFullYear()+protocol.validation.rollingYears);end.setUTCDate(end.getUTCDate()-1);
  const from=start.toISOString().slice(0,10),to=end.toISOString().slice(0,10);if(to>protocol.cutoff)break;
  const a=simulate({...common,from,to}),b=matchPassive({...common,from,to},a.summary.avgExposure,'avgExposure'),c=simulate({...common,from,to,passiveWeight:1});
  const name='rolling_'+k;
  for(const [kind,r] of [['strategy',a],['matched',b],['full_passive',c]]){
   writeCSV(m.etf+'-'+name+'-'+kind+'-equity.csv',r.equity);writeCSV(m.etf+'-'+name+'-'+kind+'-fills.csv',r.fills);
   writeJSON(m.etf+'-'+name+'-'+kind+'-ledger.json',r);
  }
  rolling.push({etf:m.etf,window:k,from:a.summary.from,to:a.summary.to,strategyReturn:a.summary.totalReturn,strategyCagr:a.summary.cagr,
   strategyDrawdown:a.summary.maxDrawdown,strategyExposure:a.summary.avgExposure,matchedWeight:b.options.passiveWeight,
   matchedReturn:b.summary.totalReturn,matchedDrawdown:b.summary.maxDrawdown,fullPassiveReturn:c.summary.totalReturn,
   excess:a.summary.totalReturn-b.summary.totalReturn,independentEntries:a.summary.entrySignalCount});
 }
 const correctionGroups=baseline.independent.filter(p=>p.entryType==='correctionBuy');
 for(const group of correctionGroups)corrections.push({etf:m.etf,...group,counterfactualAccountDelta:money(baseline.summary.endingNav-noCorrection.summary.endingNav)});

 // Compare all available secondary OHLC, without choosing the more profitable provider.
 const secondaryPath=path.join(folder,'sources',m.etf+'-sina.json');
 if(fs.existsSync(secondaryPath)){
  const secondary=read(secondaryPath).filter(x=>x.day<=protocol.cutoff),map=new Map(secondary.map(x=>[x.day,x]));
  const differences=[];
  for(const q of quotes){const s=map.get(q.date);if(!s)continue;const changed=['o','c','h','l'].some((f,i)=>q[f]!==Number(s[['open','close','high','low'][i]]));if(changed)differences.push({date:q.date,eastmoney:[q.o,q.c,q.h,q.l],sina:['open','close','high','low'].map(k=>Number(s[k]))});}
  const secondaryPayload={data:{code:m.etf,klines:secondary.map(s=>[s.day,s.open,s.close,s.high,s.low,Number(s.volume)/100,''].join(','))}};
  // Amount is unknown in this endpoint. Preserve null; do not manufacture turnover.
  const sq=parseQuotes(secondaryPayload,m),sr=saveRun(m,'sina_ohlc_sensitivity',simulate({...common,quotes:sq}));
  const primaryDates=new Set(quotes.map(q=>q.date));
  audit.push({etf:m.etf,eastmoneyBars:quotes.length,sinaBars:secondary.length,ohlcDifferences:differences,
   sourceAccountDelta:money(sr.summary.endingNav-baseline.summary.endingNav),missingQuoteDates:signal.bars.map(b=>b.t).filter(d=>d>=m.listing&&d<=protocol.cutoff&&!primaryDates.has(d))});
 }
 console.log('MARKET_COMPLETE',m.etf,'cases',summaries.filter(s=>s.etf===m.etf).length);
}
writeCSV('summary.csv',summaries);writeJSON('summary.json',summaries);
writeCSV('annual.csv',annual);writeCSV('market-stages.csv',periods);writeCSV('rolling-five-years.csv',rolling);
writeCSV('correction-independent-signals.csv',corrections);writeJSON('causality-audit.json',causality);
writeJSON('data-audit.json',audit);writeJSON('benchmark-matching.json',diagnostics);
writeJSON('study.json',{protocol,freeze,summaries,annual,periods,rolling,corrections,diagnostics,causality,audit});
const files=fs.readdirSync(output).filter(n=>n!=='output-hashes.json').sort();writeJSON('output-hashes.json',Object.fromEntries(files.map(n=>[n,sha(path.join(output,n))])));
console.log('FOUR_MARKET_EXECUTION_RESEARCH_COMPLETE',output,'files',files.length,'cases',summaries.length);
