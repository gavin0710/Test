#!/usr/bin/env node
"use strict";
/* Read-only audit: never changes dashboard's trading rules or production deployment. */
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const root=__dirname,html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script,"Missing dashboard inline script");
const cut=script.indexOf('byId("refresh").onclick=load;');
const sandbox=vm.createContext({window:{},document:{},console});
vm.runInContext(script.slice(0,cut)+";this.api={calculate,resample,resampleHourly,scanStructure,ema,analyzeLifecycle};",sandbox,{timeout:8000});
const {calculate,resample,resampleHourly,scanStructure,ema}=sandbox.api;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,"data",file),"utf8"));
const latest=read("latest.json"),daily=read("history-101.json"),weekly=read("history-102.json"),m15=read("history-15.json");
const idxNames=["上证指数","深证成指","创业板指","科创50"],periods=[["15","15分钟"],["60","60分钟"],["90","90分钟"],["120","120分钟"],["D","日线"],["W","周线"]];
const EPS=1e-9;const f=x=>typeof x==="number"?+x.toFixed(6):x;
const merge=(...parts)=>{const map=new Map();for(const bars of parts)for(const b of bars||[])if(b?.t&&Number.isFinite(b.c))map.set(b.t,b);return [...map.values()].sort((a,b)=>a.t.localeCompare(b.t))};
const row=b=>({date:b.t,close:f(b.c)});
function independentCheck(v,event){
 const {hist,dif,bars}=v,si=hist.map(x=>x<-EPS?-1:x>EPS?1:0),index=event.i,
  regionStart=event.regionStart;
 const sign=event.type.includes("Buy")||event.type==="buy"?-1:1;
 if(!Number.isInteger(regionStart))return {ok:false,issue:"no regionStart"};
 let end=regionStart;while(end+1<si.length&&si[end+1]===sign)end++;
 let priorEnd=regionStart-1;
 while(priorEnd>=0&&si[priorEnd]!==sign)priorEnd--;
 if(priorEnd<0)return {ok:false,issue:"no prior matching color"};
 let priorStart=priorEnd;while(priorStart>0&&si[priorStart-1]===sign)priorStart--;
 const gap=regionStart-priorEnd-1,mid=si.slice(priorEnd+1,regionStart);
 const zero=mid.filter(x=>x===0).length,opposite=mid.filter(x=>x===-sign).length;
 const first=bars.slice(priorStart,priorEnd+1),refPrice=sign<0?Math.min(...first.map(b=>b.c)):Math.max(...first.map(b=>b.c)),refDIF=sign<0?Math.min(...dif.slice(priorStart,priorEnd+1)):Math.max(...dif.slice(priorStart,priorEnd+1));
 const current=bars.slice(regionStart,Math.min(end,index)+1),minmaxClose=sign<0?Math.min(...current.map(b=>b.c)):Math.max(...current.map(b=>b.c)),minmaxDIF=sign<0?Math.min(...dif.slice(regionStart,Math.min(end,index)+1)):Math.max(...dif.slice(regionStart,Math.min(end,index)+1));
 const priceOK=sign<0?minmaxClose<refPrice-EPS:minmaxClose>refPrice+EPS;
 const difOK=sign<0?minmaxDIF>refDIF+EPS:minmaxDIF<refDIF-EPS;
 const hasOpposite=gap>=3&&mid.every(x=>x===-sign);
 const atCross=index===end+1&&si[index]!==sign;
 const onRegion=index>=regionStart&&index<=end;
 const rec={ok:hasOpposite&&priceOK&&difOK&&(onRegion||atCross),sign:sign<0?"green":"red",
  gap,zero,opposite,allGapOpposite:mid.every(x=>x===-sign),
  prevStart:bars[priorStart].t,prevEnd:bars[priorEnd].t,
  betweenDates:bars.slice(priorEnd+1,regionStart).map(b=>b.t),betweenHist:hist.slice(priorEnd+1,regionStart).map(f),
  currStart:bars[regionStart].t,currEnd:bars[end].t,
  firstRefClose:f(refPrice),firstRefDIF:f(refDIF),
  secondCloseAtSignal:f(minmaxClose),secondDIFAtSignal:f(minmaxDIF),
  priceOK,difOK,onRegion,atCross,signalDate:bars[index].t,
  sourceGap:event.gap,sourceRefClose:f(event.ref?.close),sourceRefDIF:f(event.ref?.dif)};
 return rec;
}
const cases=[],problems=[],gap3=[],allBuy=[],allSell=[],rangeDump=[],signalAround=[];let text2024=null;
for(let i=0;i<4;i++){
 const base=merge(m15.data[i]["15"],latest.data[i]["15"]);
 const d=merge(daily.data[i]["101"],latest.data[i]["101"]);
 const w=merge(weekly.data[i]["102"],latest.data[i]["102"]);
 const h=merge(latest.data[i]["60"]);
 const pp={"15":base,"60":h.length>65?h:resample(base,4),"90":resample(base,6),"120":h.length>65?resampleHourly(h):resample(base,8),D:d,W:w};
 for(const [period,periodName]of periods){
  const bars=pp[period],v=calculate(bars);
  if(!v)continue;
  const firstSignals=v.events.filter(e=>e.type==="buy"||e.type==="sell");
  const stageSignals=v.events.filter(e=>/^(second|third|later)(Buy|Sell)$/.test(e.type));
  const bad=[];
  for(const ev of firstSignals){
   const ck=independentCheck(v,ev);
   if(!ck.ok){problems.push({index:idxNames[i],period:periodName,type:ev.type,date:ev.t,check:ck});bad.push({ev,ck})}
   if(ck.gap===3)gap3.push({index:idxNames[i],period:periodName,type:ev.type,date:ev.t,gap:ck.gap,mid:ck.betweenDates});
   if(ev.type==="buy")allBuy.push({index:idxNames[i],period:periodName,date:ev.t,gap:ck.gap});
   else allSell.push({index:idxNames[i],period:periodName,date:ev.t,gap:ck.gap});
  }
  for(const ev of v.events.filter(e=>e.t.slice(0,10)>="2024-06-01"&&e.t.slice(0,10)<="2024-08-20"&&period==="D")){
   if(["watchBuy","buy","secondBuy","thirdBuy","laterBuy","invalid","expired","stopLoss","sell","watchSell"].includes(ev.type)){
    let check=Number.isInteger(ev.regionStart)?independentCheck(v,ev):null;
    signalAround.push({index:idxNames[i],event:{...ev,ref:ev.ref&&{close:f(ev.ref.close),dif:f(ev.ref.dif)}},check});
   }
  }
  cases.push({index:idxNames[i],period:periodName,bars:bars.length,start:bars[0]?.t,end:bars.at(-1)?.t,baseBuy:firstSignals.filter(e=>e.type==="buy").length,baseSell:firstSignals.filter(e=>e.type==="sell").length,secondary:stageSignals.length,bad:bad.length,gap3:firstSignals.filter(e=>independentCheck(v,e).gap===3).length});
  if(i===0&&period==="D"){
   const around=v.events.filter(e=>e.t.slice(0,10)>="2024-05-01"&&e.t.slice(0,10)<="2024-09-30");
   text2024={period:periodName,firstAvailable:bars[0].t,
    events:around.map(e=>({type:e.type,date:e.t,i:e.i,regionStart:e.regionStart,ref:e.ref&&{close:f(e.ref.close),dif:f(e.ref.dif)},gap:e.gap,check:e.type==="buy"||e.type==="sell"?independentCheck(v,e):null})),
    rows:bars.map((bar,k)=>({bar,k})).filter(x=>x.bar.t>="2024-06-01"&&x.bar.t<="2024-07-24").map(({bar,k})=>({date:bar.t,close:f(bar.c),dif:f(v.dif[k]),dea:f(v.dea[k]),hist:f(v.hist[k]),color:v.hist[k]<-EPS?"green":v.hist[k]>EPS?"red":"zero"}))};
  }
 }
}
const summary={source:latest.generated_at_utc,groups:cases.length,totalBaseBuy:allBuy.length,totalBaseSell:allSell.length,totalSecondary:cases.reduce((s,c)=>s+c.secondary,0),strictFailures:problems.length,threeGapEvents:gap3.length,threeGapBuy:gap3.filter(x=>x.type==="buy").length,threeGapSell:gap3.filter(x=>x.type==="sell").length};
console.log("AUDIT_SUMMARY",JSON.stringify(summary));
console.log("AUDIT_CASES",JSON.stringify(cases));
console.log("AUDIT_SSE_2024",JSON.stringify(text2024));
console.log("AUDIT_EVENTS_2024",JSON.stringify(signalAround));
console.log("AUDIT_GAP3",JSON.stringify(gap3));
console.log("AUDIT_PROBLEMS",JSON.stringify(problems));
console.log("AUDIT_DONE");
