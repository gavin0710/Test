#!/usr/bin/env node
"use strict";
const fs=require("fs");
const vm=require("vm");
const assert=require("node:assert/strict");
const path=require("path");
const root=__dirname;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const m=html.match(/<script>([\s\S]*?)<\/script>/);
assert(m&&m[1],"Dashboard inline script missing");
const script=m[1];
new vm.Script(script,{filename:"dashboard.js"});
const cut=script.indexOf('byId("refresh").onclick=load;');
assert(cut>0,"Could not isolate calculation engine");
const sandbox={window:{},document:{},console};
vm.createContext(sandbox);
vm.runInContext(script.slice(0,cut)+";this.testApi={calculate,resample,resampleHourly,parseBars,ema};",sandbox,{timeout:1000});
const {calculate,resample,resampleHourly,ema}=sandbox.testApi;
function segment(from,to,count,out){for(let i=0;i<count;i++)out.push(from+(to-from)*(i+1)/count)}
function wave(type){
 const up=type==="sell",s=up?1:-1;
 const cls=[];segment(100,100,80,cls);segment(100,100+s*12,35,cls);segment(100+s*12,100+s*4,38,cls);segment(100+s*4,100+s*15,110,cls);segment(100+s*15,100+s*10,25,cls);
 return cls.map((c,i)=>({t:"t"+i,o:c,c,h:c+.05,l:c-.05}));
}
for(const sign of ["buy","sell"]){
 const v=calculate(wave(sign));
 assert(v&&v.events.some(x=>x.type===sign),sign+" structural divergence missed");
 assert.equal(v.nine.at(-1)*(sign==="buy"?1:-1)>0,true,"Nine-turn direction inconsistent");
 assert(v.dif.every(Number.isFinite)&&v.dea.every(Number.isFinite),"MACD numerical failure");
}
const times=["09:45","10:00","10:15","10:30","10:45","11:00","11:15","11:30","13:15","13:30","13:45","14:00","14:15","14:30","14:45","15:00"];
const minute=times.map((t,i)=>({t:"2026-11-12T"+t,o:100+i,c:100+i+.4,h:101+i,l:99+i}));
assert.equal(resample(minute,6).length,3,"90m non-overlapping buckets");
assert.equal(resample(minute,6)[1].t,"2026-11-12T14:00","90m middle bar ends at 14:00");
const hourly=[minute[3],minute[7],minute[11],minute[15]];
assert.equal(resampleHourly(hourly).length,2,"120m morning/afternoon buckets");
assert.equal(resampleHourly(hourly)[0].t,"2026-11-12T11:30","120m morning close");
assert.equal(ema(Array(70).fill(100),12).at(-1),100,"EMA constant input");
assert.equal(calculate(wave("sell").slice(0,40)),null,"Insufficient bars must not make signals");
if(fs.existsSync(path.join(root,"data","latest.json"))){
 const snap=JSON.parse(fs.readFileSync(path.join(root,"data","latest.json"),"utf8"));
 assert(Array.isArray(snap.data)&&snap.data.length===4,"Snapshot needs four indexes");
 for(const item of snap.data)for(const bars of Object.values(item)){
  assert(Array.isArray(bars)&&bars.length>=60,"Snapshot must retain verified OHLC source series");
  for(const b of bars){
   assert(Number.isFinite(b.c)&&Number.isFinite(b.o)&&b.h>=b.l,"Invalid price bar");
  }
 }
}
console.log("PASS: JS parse, synthetic MACD bidirectional turns, nine-turn, 90/120-minute buckets, snapshot schema");
