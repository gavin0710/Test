#!/usr/bin/env node
"use strict";
const fs=require("fs"),vm=require("vm"),assert=require("node:assert/strict"),path=require("path");
const root=__dirname,html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script,"Dashboard script missing");new vm.Script(script,{filename:"dashboard.js"});
const cut=script.indexOf('byId("refresh").onclick=load;');assert(cut>0,"Engine isolation failed");
const sandbox={window:{},document:{},console};
vm.createContext(sandbox);
vm.runInContext(script.slice(0,cut)+";this.testApi={calculate,scanStructure,analyzeLifecycle,projectNext,resample,resampleHourly,ema};",sandbox,{timeout:3000});
const {calculate,scanStructure,analyzeLifecycle,projectNext,resample,resampleHourly,ema}=sandbox.testApi;
let assertions=0;
function ok(value,label){assert(value,label);assertions++}
function equal(actual,expected,label){assert.equal(actual,expected,label);assertions++}
function fake({gap=3,side="bottom",prices2,difs2,wickOnly=false}={}){
 const bottom=side==="bottom",c1=bottom?[100,99,98,97]:[100,101,102,103],
 c2=prices2||(bottom?[96,95.5,95]:[104,104.5,105]),
 d1=bottom?[-1,-2,-2.5,-2.2]:[1,2,2.5,2.2],
 d2=difs2||(bottom?[-1.8,-1.7,-1.6]:[1.8,1.7,1.6]);
 const prices=[...c1,...Array(gap).fill(100),...c2];
 const dif=[...d1,...Array.from({length:gap},(_,i)=>bottom?.2+i*.1:-.2-i*.1),...d2];
 const hist=[...Array(4).fill(bottom?-1:1),...Array(gap).fill(bottom?1:-1),...Array(c2.length).fill(bottom?-1:1)];
 const bars=prices.map((c,i)=>({t:"t"+String(i).padStart(3,"0"),o:c,c,h:c+(wickOnly&&i>=4+gap?10:.2),l:c-(wickOnly&&i>=4+gap?10:.2)}));
 return {bars,dif,hist,result:scanStructure(bars,dif,hist)}
}
const event=(f,type)=>f.result.events.find(e=>e.type===type);
for(const gap of [0,1,2]){
 const f=fake({gap});ok(!event(f,"watchBuy"),"Must reject "+gap+" non-green separators");
}
for(const gap of [3,4,6]){
 const f=fake({gap});ok(!!event(f,"watchBuy"),"Accept "+gap+" consecutive opposite columns");
 ok(!!event(f,"buy"),"DIF first upturn should buy with "+gap+" separators");
}
const top=fake({side:"top"});ok(!!event(top,"watchSell"),"Top divergence");ok(!!event(top,"sell"),"Top DIF downturn");
ok(!event(fake({prices2:[98,99,100]}),"watchBuy"),"No closing-price breakdown");
ok(!event(fake({prices2:[97,98,99]}),"watchBuy"),"Equal low close is not a breakdown");
ok(!event(fake({prices2:[99,99,99],wickOnly:true}),"watchBuy"),"Intrabar wick lows never count");
ok(!event(fake({difs2:[-2.8,-2.9,-3]}),"watchBuy"),"DIF new minimum invalid");
ok(!event(fake({difs2:[-2.5,-2.4,-2.3]}),"watchBuy"),"Equal DIF low invalid");
ok(!event(fake({side:"top",difs2:[2.5,2.4,2.3]}),"watchSell"),"Equal top DIF invalid");
const later=fake({prices2:[98,97,96],difs2:[-1.8,-1.9,-1.7]});
equal(event(later,"watchBuy").i,9,"Divergence only at actual closing breakdown");
equal(event(later,"buy").i,9,"DIF turn on arming bar is buy");
const watch=fake({difs2:[-1.5,-1.6,-1.7]});
equal(watch.result.state,"watchBuy","Pending bottom not a buy signal");
ok(!event(watch,"buy"),"No premature buy");
const invalid=fake({difs2:[-1.8,-2.3,-2.6]});
ok(!!event(invalid,"watchBuy"),"Early divergence appeared");
ok(!!event(invalid,"invalid"),"Later DIF breaks reference and invalidates watch");
equal(invalid.result.state,"neutral","Invalid watch not active");
const futureCross=fake({difs2:[-1.5,-1.6,-1.7]});
futureCross.bars.push({t:"t999",o:96,c:96,h:97,l:95});
futureCross.dif.push(-1.6);futureCross.hist.push(.2);
const crosses=scanStructure(futureCross.bars,futureCross.dif,futureCross.hist);
ok(crosses.events.some(e=>e.type==="buy"&&e.atCross),"First opposite-color bar may complete DIF first turn");
const noCross=fake({difs2:[-1.5,-1.6,-1.7]});
noCross.bars.push({t:"t999",o:96,c:96,h:97,l:95});
noCross.dif.push(-1.8);noCross.hist.push(.2);
const expired=scanStructure(noCross.bars,noCross.dif,noCross.hist);
ok(!expired.events.some(e=>e.type==="buy"),"Opposite bar without DIF turn must not buy");
ok(expired.events.some(e=>e.type==="expired"),"Expired region is auditable");
// Do not skip a nearer same-color region whose separator is too short:
const earlier=fake({gap:3,difs2:[-1.8,-1.9,-2]}),b3=earlier.bars.slice();
const dif3=earlier.dif.slice(),hist3=earlier.hist.slice();
for(let i=0;i<2;i++){b3.push({t:"m"+i,o:100,c:100,h:100,l:100});dif3.push(.2+i*.1);hist3.push(1)}
for(let i=0;i<3;i++){b3.push({t:"n"+i,o:90,c:90-i,h:100,l:80});dif3.push(-1.2-i*.1);hist3.push(-1)}
const nearest=scanStructure(b3,dif3,hist3);
ok(!nearest.events.some(e=>e.type==="watchBuy"&&e.regionStart===earlier.bars.length+2),"Never skip closest same-color region");
// Projection math precise: next DIF = (11/13) EMA12 - (25/27) EMA26 + (28/351) P
const e12=100,e26=102,current=-2,previous=-1.9,reference=-2.5;
const projection=projectNext({bars:[{c:99}],dif:[previous,current],dea:[-1.3,-1.3],ema12:[e12],ema26:[e26],
active:{mode:"watch",sign:-1,ref:{dif:reference}}});
ok(projection.turnPrice>projection.lossPrice,"Buying threshold above invalidation for bottom");
const testDIF=p=>projection.a+projection.k*p;
ok(Math.abs(testDIF(projection.turnPrice)-current)<1e-8,"Turn price inversion exact");
ok(Math.abs(testDIF(projection.lossPrice)-reference)<1e-8,"Invalidation inversion exact");
ok(Number.isFinite(projection.colorPrice),"Histogram color boundary computed");
const oldDIF=projectNext({bars:[{c:99}],dif:[-2.2,-2],dea:[-1.3],ema12:[100],ema26:[102],active:{mode:"watch",sign:-1,ref:{dif:-2.5}}});
equal(oldDIF.turnPrice,null,"Continued DIF ascent is not a new first turn");
const times=["09:45","10:00","10:15","10:30","10:45","11:00","11:15","11:30","13:15","13:30","13:45","14:00","14:15","14:30","14:45","15:00"];
const minute=times.map((t,i)=>({t:"2026-11-12T"+t,o:100+i,c:100+i+.4,h:101+i,l:99+i}));
equal(resample(minute,6).length,3,"90m non-overlapping buckets");
equal(resample(minute,6)[1].t,"2026-11-12T14:00","90m middle bar ends at 14:00");
const hourly=[minute[3],minute[7],minute[11],minute[15]];
equal(resampleHourly(hourly).length,2,"120m morning/afternoon buckets");
equal(resampleHourly(hourly)[0].t,"2026-11-12T11:30","120m morning close");
equal(ema(Array(70).fill(100),12).at(-1),100,"EMA constant input");
equal(calculate(Array.from({length:40},(_,i)=>({t:"t"+i,o:100,c:100,h:100,l:100}))),null,"Insufficient bars");
const simple=calculate(Array.from({length:110},(_,i)=>({t:"t"+i,o:100+i*.05,c:100+i*.05,h:101+i*.05,l:99+i*.05})));
ok(simple&&Number.isFinite(simple.dif.at(-1)),"MACD price calculation");
ok(simple.projection!==null,"Projection attached to each complete signal unit");
// Chart historical signal navigation must include every buy stage, and full mode all bars.
const uiSegment=script.slice(script.indexOf("let visibleBars="),script.indexOf("function drawPrice("));
ok(uiSegment.includes("const buyTypes=new Set"),"Historical buy type set exists");
ok(uiSegment.includes("laterBuy"),"Fourth and later buys are retained");
ok(script.includes("function buySignalEvents("),"Historical signal navigator implemented");
ok(script.includes("function navigateBuy("),"Previous and next buy navigation implemented");
ok(script.includes("function jumpToBuy("),"Exact candle index navigation implemented");
ok(uiSegment.includes("visibleBars===0?v.bars.length"),"All-history plot range uses all available candles");
const graphSection=script.slice(script.indexOf("function drawPrice("),script.indexOf("function drawMacd("));
ok(graphSection.includes('const label=(bullish?"买":"卖")'),"Explicit buy/sell label in price chart");
ok(graphSection.includes('signalAnchors[selectedP+":"+i]'),"Focused history marker highlighted");
ok(graphSection.includes('["buy","secondBuy","thirdBuy","laterBuy"]'),"All stage buy events mapped onto K-line");
// Profit classification uses exactly one initial buy and its first matched exit/stop.
const winCalc=()=>{
 const parse=fs.readFileSync(path.join(root,"index.html"),"utf8").match(/<script>([\s\S]*?)<\/script>/)?.[1];
 const section=parse.slice(parse.indexOf("function tradeSummary("),parse.indexOf("function renderWinRates("));
 return vm.runInNewContext(section+";tradeSummary");
};
const winRate=winCalc();
const testTrades=[
 {entryClose:100,exitClose:105,exitType:"topSell"},
 {entryClose:100,exitClose:98,exitType:"stop"},
 {entryClose:100,exitClose:100,exitType:"topSell"}
];
const sample=winRate(testTrades);
equal(sample.completed,3,"Exactly three completed trades");
equal(sample.wins,1,"One positive return is successful");
equal(sample.losses,1,"One negative return is unsuccessful");
equal(sample.flats,1,"Breakeven is not a successful trade");
equal(sample.sellExits,2,"Top sell exit count distinct");
equal(sample.stopExits,1,"Stop exit included in success-rate denominator");
ok(Math.abs(sample.winRate-100/3)<1e-8,"Win rate = profitable exits / all completed exits");
equal(winRate([]).winRate,null,"No completed trades means missing win rate, not zero");
equal(winRate([{entryClose:0,exitClose:100,exitType:"topSell"}]).completed,0,"Invalid entry price excluded");
// Lifecycle tests: first turn is buy; later qualifying turns before three opposite-color
// columns are second and third structure, with a reference DIF break causing a stop.
function campaign({stop=false,top=false,breakAfterThree=false,closingAt=23}={}){
 const dif=Array(36).fill(-.8);
 [dif[9],dif[10],dif[11],dif[12],dif[13],dif[14],dif[15],dif[16],dif[17],dif[18]]=
 [-1.5,-1.4,-1.3,-1.5,-1.7,-1.6,-1.75,-1.85,-1.70,stop?-2.1:-1.65];
 const hist=Array(36).fill(-.5);
 if(breakAfterThree){
  hist[19]=1;hist[20]=1;hist[21]=1;dif[22]=-2.5;
 }
 const bars=dif.map((value,i)=>({t:"2026-01-"+String(1+Math.floor(i/4)).padStart(2,"0")+"T"+String(i).padStart(2,"0"),c:100+i*.1}));
 const events=[{type:"watchBuy",i:9,t:bars[9].t,regionStart:4,ref:{dif:-2,close:102}},
  {type:"buy",i:10,t:bars[10].t,regionStart:4,ref:{dif:-2,close:102}}];
 if(top)events.push({type:"sell",i:closingAt,t:bars[closingAt].t,regionStart:21,ref:{dif:3,close:103}});
 return analyzeLifecycle(bars,dif,hist,events);
}
const first=campaign();
equal(first.counts.watch,1,"One qualifying bottom divergence");
equal(first.counts.formed,1,"One first structure");
equal(first.counts.second,1,"Second DIF upturn");
equal(first.counts.third,1,"Third DIF upturn");
equal(first.counts.buy,3,"First, second, third buys all counted");
equal(first.counts.sell,0,"No invented top sell");
equal(first.counts.open,1,"Unpaired buy retained");
equal(first.trades.length,0,"No synthetic closing trade without sell/stop");
const st=campaign({stop:true});
equal(st.counts.failStop,1,"DIF breaking original reference before 3 opposite columns triggers stop");
equal(st.counts.stopExits,1,"Stop closes open position only once");
equal(st.counts.open,0,"Stopped position not considered pending");
equal(st.losses[0].i,18,"Stop event bar index auditable");
equal(st.losses[0].holdBars,8,"Stop duration in completed bars");
equal(st.trades[0].exitType,"stop","Stop exit never counted as top sell");
equal(st.counts.sellExits,0,"Stop excluded from matched top exits");
const sold=campaign({top:true});
equal(sold.counts.sell,1,"Top structure produces one sale signal");
equal(sold.counts.sellExits,1,"Bottom buy and same-timeframe top sell paired");
equal(sold.counts.stopExits,0,"Valid top exit not counted as stop");
equal(sold.counts.open,0,"Matched trade no longer pending");
equal(sold.trades[0].exitType,"topSell","Top exit tagged distinctly");
const unpairedSell=analyzeLifecycle(
 Array.from({length:28},(_,i)=>({t:"t"+i,c:100})),Array(28).fill(2),Array(28).fill(1),
 [{type:"sell",i:20,t:"t20",regionStart:16,ref:{dif:3,close:100}}]);
equal(unpairedSell.counts.sell,1,"Raw top sell signal preserved");
equal(unpairedSell.counts.unpairedSells,1,"Unpaired sell flagged instead of phantom trade");
equal(unpairedSell.counts.sellExits,0,"No sell trade without prior buy");
const safe=campaign({breakAfterThree:true});
equal(safe.counts.failStop,0,"Three consecutive opposite colors terminate stop guard before later reference break");
equal(safe.counts.open,1,"No fabricated stop after campaign ended");
if(fs.existsSync(path.join(root,"data","latest.json"))){
 const snap=JSON.parse(fs.readFileSync(path.join(root,"data","latest.json"),"utf8"));
 ok(Array.isArray(snap.data)&&snap.data.length===4,"Four market indexes");
 for(const item of snap.data)for(const bars of Object.values(item)){
  ok(Array.isArray(bars)&&bars.length>=60,"Verified OHLC series");
  for(const b of bars)ok(Number.isFinite(b.c)&&Number.isFinite(b.o)&&b.h>=b.l,"OHLC integrity");
 }
}

const local=sandbox.testApi.localWave;
const barsForWaves=[10,11,12,13,12,11,10,9,8,9,10,11,12,11,10,9,8,9,10,11,12].map((p,i)=>({t:"T"+i,c:p,o:p,h:p+.1,l:p-.1}));
const waveData=local(barsForWaves);
ok(waveData.at[8].direction==="down","Last confirmed high at index 3 detected only after index 6");
ok(waveData.at[8].pivotAt===3,"Correct previous confirmed high pivot");
ok(waveData.at[11].direction==="up","Low at index 8 only confirms on index 11");
ok(waveData.at[10].direction==="down","No use of future right-hand bars before confirmation");
ok(waveData.at[15].direction==="down","New high at 12 becomes confirmed index 15");
ok(waveData.at[18].direction==="down","New low at 16 cannot confirm before index 19");
ok(waveData.at[19].direction==="up","New low at 16 confirms index 19");
ok(html.includes('id="wave-entry-body"'),"Wave success rate breakdown table present");
ok(html.includes('四指数当前波段（临时）'),"Current wave table column present");
console.log("PASS:",assertions,"assertions: close prices, >=3 separators, region-DIF, second/third structures, stop before 3 opposite bars, time-frame-local sell exits, unresolved holds, EMA thresholds and verified OHLC");
