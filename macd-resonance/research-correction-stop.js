#!/usr/bin/env node
"use strict";
/*
 Read-only counterfactual study of the user's confirmed proposal:
 DIF <= original top area DIF high on the first CLOSED bar AFTER correction buy
 triggers correction stop. This research script DOES NOT modify dashboard rules.
*/
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const DIR=__dirname;
const html=fs.readFileSync(path.join(DIR,'index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const cut=source.indexOf('byId("refresh").onclick=load;');
assert(cut>0,'Unable to isolate dashboard calculations');
const context=vm.createContext({window:{},document:{},console});
vm.runInContext(source.slice(0,cut)+';this.research={calculate,resample,resampleHourly};',context,{timeout:4500});
const {calculate,resample,resampleHourly}=context.research;
const j=p=>JSON.parse(fs.readFileSync(path.join(DIR,'data',p),'utf8'));
const snap=j('latest.json'),histD=j('history-101.json'),histW=j('history-102.json'),hist15=j('history-15.json');
const IDX=['上证指数','深证成指','创业板指','科创50'];
const PER=[['15','15分钟'],['60','60分钟'],['90','90分钟'],['120','120分钟'],['D','日线'],['W','周线']];
const merge=(...items)=>{
 const map=new Map();
 for(const bars of items)for(const b of bars||[]){
  if(b&&typeof b.t==='string'&&Number.isFinite(b.c)&&Number.isFinite(b.o)&&Number.isFinite(b.h)&&Number.isFinite(b.l))map.set(b.t,b);
 }
 return [...map.values()].sort((a,b)=>a.t.localeCompare(b.t));
};
const round=(x,d=3)=>Number.isFinite(x)?Number(x.toFixed(d)):null;
const pct=(b,a)=>b/a*100-100;
const result=[];
const nByPeriod=[];
function firstFallAt(dif,h,entry,last=dif.length-1) {
 for(let i=entry+1;i<=last;i++)if(dif[i]<=h+1e-9)return i;
 return -1;
}
assert.equal(firstFallAt([1,3.1,3,2.9],3,1),2,'equality triggers first correction stop');
assert.equal(firstFallAt([1,3.1,3.07,3.02],3,1),-1,'above reference does not stop');
assert.equal(firstFallAt([1,3.1,3.01,2.9],3,1),3,'later re-entry below reference triggers');
assert.equal(firstFallAt([3,2.9,2.8],3,0),1,'cannot stop on correction-entry bar');
for(let index=0;index<4;index++){
 const m=merge(hist15.data[index]['15'],snap.data[index]['15']);
 const h=merge(snap.data[index]['60']);
 const d=merge(histD.data[index]['101'],snap.data[index]['101']);
 const w=merge(histW.data[index]['102'],snap.data[index]['102']);
 const barsByP={'15':m,'60':h.length>65?h:resample(m,4),'90':resample(m,6),'120':h.length>65?resampleHourly(h):resample(m,8),D:d,W:w};
 for(const [p,pLabel] of PER){
  const bars=barsByP[p],v=calculate(bars);
  if(!v)continue;
  const corrections=v.events.filter(e=>e.type==='correctionBuy');
  nByPeriod.push({index:IDX[index],period:pLabel,candles:bars.length,corrections:corrections.length,first:bars[0].t,last:bars.at(-1).t});
  for(const e of corrections){
   const trade=v.trades.find(t=>t.entryType==='correctionBuy'&&t.entryI===e.i);
   const open=v.position?.entryType==='correctionBuy'&&v.position.entryI===e.i?v.position:null;
   assert(trade||open,'Correction event must have matching open or completed position');
   const limit=trade?.exitI??bars.length-1;
   const stopIdx=firstFallAt(v.dif,e.refDIF,e.i,limit);
   let confirmStopIdx=-1,belowRun=0;
   for(let j=e.i+1;j<=limit;j++){
    belowRun=v.dif[j]<=e.refDIF+1e-9?belowRun+1:0;
    if(belowRun>=2){confirmStopIdx=j;break;}
   }
   const optionBExitIdx=confirmStopIdx>=0?confirmStopIdx:trade?.exitI??null;
   const optionBReturn=optionBExitIdx===null?null:pct(bars[optionBExitIdx].c,bars[e.i].c);
   const difRebreakWithin=(lookback)=>stopIdx>=0?
    v.dif.slice(stopIdx+1,Math.min(v.dif.length,stopIdx+1+lookback)).some(d=>d>e.refDIF+1e-9):false;
   const prior=v.trades.filter(t=>t.exitType==='topSell'&&t.exitI<e.i&&t.campaignI===e.originalI).at(-1);
   assert(prior,'Correction must link to an original paired sale');
   assert(v.dif[e.i]>e.refDIF+1e-9,'Correction entry must break reference high strictly');
   assert(v.dif[e.i-1]<=e.refDIF+1e-9,'Correction entry must first cross reference high');
   const trigger=stopIdx>=0;
   const exitI=trigger?stopIdx:trade?.exitI??null;
   const exitMode=trigger&&stopIdx<trade?.exitI?'纠错止损':trigger&&stopIdx===trade?.exitI?'同根止损/顶部卖':trade?'原顶部卖出':'尚未退出';
   const exitC=exitI===null?null:bars[exitI].c;
   const recent=bars.slice(e.i,limit+1);
   const futureMax=trigger?Math.max(...bars.slice(stopIdx+1,Math.min(bars.length,stopIdx+11)).map(b=>b.c),bars[stopIdx].c):null;
   let peak=bars[e.i].c,maxDrawdown=0;
   for(const b of recent){peak=Math.max(peak,b.c);maxDrawdown=Math.min(maxDrawdown,pct(b.c,peak))}
   const row={
    index:IDX[index],period:pLabel,originalBuy:e.originalT,priorSell:prior.exitT,priorSellClose:round(prior.exitClose,2),
    correctionBuy:e.t,correctionClose:round(bars[e.i].c,2),referenceDIF:round(e.refDIF,5),
    entryDIF:round(v.dif[e.i],5),stopFound:trigger,stopT:trigger?bars[stopIdx].t:null,
    stopDIF:trigger?round(v.dif[stopIdx],5):null,stopClose:trigger?round(bars[stopIdx].c,2):null,
    barsToStop:trigger?stopIdx-e.i:null,stopReturnPct:trigger?round(pct(bars[stopIdx].c,bars[e.i].c)):null,
    legacyExitT:trade?.exitT||null,legacyExitKind:trade?.exitType||null,
    legacyReturnPct:trade?round(pct(trade.exitClose,bars[e.i].c)):null,
    proposedExitMode:exitMode,proposedReturnPct:exitI!==null?round(pct(exitC,bars[e.i].c)):null,
    counterfactualVsLegacyPct:trade&&trigger?round(pct(bars[stopIdx].c,bars[e.i].c)-pct(trade.exitClose,bars[e.i].c)):null,
    confirmStopDate:confirmStopIdx>=0?bars[confirmStopIdx].t:null,
    confirmStopClose:confirmStopIdx>=0?round(bars[confirmStopIdx].c,2):null,
    twoBarExitReturnPct:optionBReturn===null?null:round(optionBReturn),
    rebreakDIFWithin5Bars:difRebreakWithin(5),rebreakDIFWithin10Bars:difRebreakWithin(10),
    maxCloseDrawdownPct:round(maxDrawdown),
    maxClose10BarsAfterStopPct:trigger?round(pct(futureMax,bars[stopIdx].c)):null,
    status:trade?'历史已退出':open?'历史未退出':'未知',
    linkOriginalI:e.originalI,linkPrevExitI:e.previousExitI
   };
   result.push(row);
  }
 }
}
result.sort((a,b)=>a.correctionBuy.localeCompare(b.correctionBuy)||a.index.localeCompare(b.index));
const counted=nByPeriod.reduce((n,x)=>n+x.corrections,0);
assert.equal(counted,result.length,'All correction events mapped');
const stopEvents=result.filter(x=>x.stopFound);
const earlyStop=result.filter(x=>x.stopFound&&x.proposedExitMode==='纠错止损');
const noStop=result.filter(x=>!x.stopFound);
const returnOf=r=>r.proposedReturnPct;
const closed=result.filter(r=>r.proposedReturnPct!==null);
const gain=closed.filter(r=>returnOf(r)>0);
const summary={
 asOf:snap.generated_at_utc,series:nByPeriod.length,correctionCount:result.length,
 correctionByPeriod:Object.fromEntries(PER.map(([p,label])=>[label,result.filter(r=>r.period===label).length])),
 stoppedBeforeExistingExit:earlyStop.length,stopAtOrBeforeExistingExit:stopEvents.length,
 difRebreakWithin5Bars:result.filter(r=>r.rebreakDIFWithin5Bars).length,
 difRebreakWithin10Bars:result.filter(r=>r.rebreakDIFWithin10Bars).length,
 twoBarConfirmed:result.filter(r=>r.confirmStopDate).length,
 twoBarCompleted:result.filter(r=>r.twoBarExitReturnPct!==null).length,
 twoBarWinRatePct:result.filter(r=>r.twoBarExitReturnPct!==null).length?
  round(result.filter(r=>r.twoBarExitReturnPct>0).length/result.filter(r=>r.twoBarExitReturnPct!==null).length*100,2):null,
 twoBarMeanReturnPct:result.filter(r=>r.twoBarExitReturnPct!==null).length?
  round(result.filter(r=>r.twoBarExitReturnPct!==null).reduce((n,r)=>n+r.twoBarExitReturnPct,0)/result.filter(r=>r.twoBarExitReturnPct!==null).length):null,
 noStopBeforeExistingExit:noStop.length,
 proposalClosed:closed.length,proposalUnclosed:result.length-closed.length,
 proposalProfitable:gain.length,proposalWinRatePct:closed.length?round(gain.length/closed.length*100,2):null,
 proposalMeanReturnPct:closed.length?round(closed.reduce((sum,r)=>sum+returnOf(r),0)/closed.length):null,
 originalClosed:result.filter(r=>r.legacyReturnPct!==null).length,
 originalMeanReturnPct:result.filter(r=>r.legacyReturnPct!==null).length?round(result.filter(r=>r.legacyReturnPct!==null).reduce((n,r)=>n+r.legacyReturnPct,0)/result.filter(r=>r.legacyReturnPct!==null).length):null
};
console.log('RESULT_BEGIN');
console.log(JSON.stringify({summary,records:result,periods:nByPeriod},null,2));
console.log('RESULT_END');
console.log('SUMMARY',JSON.stringify(summary));
console.log('CASE_ROWS_HEADER',"指数\t周期\t原买入\t先前顶部卖出\t纠错买回\t参考DIF\t买回DIF\t纠错收盘\t新止损日期\t止损DIF\t止损收盘\t持有K线\t纠错收益%\t原规则退出\t原收益%\t是否先行止损\t止损后10根最高涨幅%\t5根内DIF复破\t10根内DIF复破\t双柱确认退出\t双柱收益%");
for(const r of result)console.log('CASE_ROW',[
 r.index,r.period,r.originalBuy,r.priorSell,r.correctionBuy,r.referenceDIF,r.entryDIF,r.correctionClose,r.stopT||'未触发',
 r.stopDIF??'—',r.stopClose??'—',r.barsToStop??'—',r.proposedReturnPct??'未退出',r.legacyExitT||'未退出',
 r.legacyReturnPct??'未退出',r.proposedExitMode,r.maxClose10BarsAfterStopPct??'—',r.rebreakDIFWithin5Bars,r.rebreakDIFWithin10Bars,r.confirmStopDate||'未触发',r.twoBarExitReturnPct??'未退出'].join('\t'));
