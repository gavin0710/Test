#!/usr/bin/env node
"use strict";
const http=require("http"),fs=require("fs"),path=require("path"),assert=require("node:assert/strict");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/tmp/macd-ledger-v2/node_modules/playwright");
const viewports=[{width:1500,height:960},{width:390,height:844}];
const root=__dirname,files={
 "/":path.join(root,"index.html"),"/api/latest":path.join(root,"data","latest.json"),
 "/api/history?period=15":path.join(root,"data","history-15.json"),
 "/api/history?period=101":path.join(root,"data","history-101.json"),
 "/api/history?period=102":path.join(root,"data","history-102.json")
};
const server=http.createServer((req,res)=>{
 const item=files[req.url?.split("&ts=")[0]]||files[req.url?.split("?ts=")[0]];
 if(!item){res.writeHead(404);res.end("not found");return}
 res.setHeader("Content-Type",item.endsWith(".html")?"text/html;charset=utf-8":"application/json;charset=utf-8");
 fs.createReadStream(item).pipe(res);
});
(async()=>{
 let base=process.env.MACD_BASE_URL;
 const usingArchive=!base;
 if(usingArchive){
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  base="http://127.0.0.1:"+server.address().port;
 }
 const launchOptions={headless:true,args:["--no-sandbox",...JSON.parse(process.env.CHROMIUM_ARGS||"[]")],
  executablePath:process.env.CHROMIUM_PATH};
 try{
  for(const viewport of viewports){
   const browser=await chromium.launch(launchOptions);
   try{
   const page=await browser.newPage({viewport});
   const errors=[];page.on("pageerror",err=>errors.push(err.message));
   if(usingArchive)await page.route(/eastmoney\.com/,route=>route.abort());
   const resp=await page.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
   assert.equal(resp.status(),200);
   await page.waitForFunction(()=>!load.busy&&getSignal(0,"D")?.bars?.length>=8763&&
    document.querySelector("#status")?.textContent.includes("24/24"),null,{timeout:65000});
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.equal(await page.locator(".kplot").count(),4);
   assert.equal(await page.locator(".mplot").count(),4);
   assert.equal(await page.locator("#statsbody tr").count(),24);
   const projectionPanels=await page.evaluate(()=>[0,1,2,3].map(i=>{
    const v=getSignal(i,selectedP),at=visible(i);
    const latest=!replayMode&&v?.bars?.at(-1)?.t===at?.bars?.at(-1)?.t;
    return {i,mode:v?.projection?.mode||"none",shown:!!document.querySelector("#card"+i+" .estimate"),
     expected:!!latest&&isFocusedProjection(v?.projection)};
   }));
   assert(projectionPanels.every(x=>x.shown===x.expected),"Only confirmed divergence watch/campaign should display next-candle projection");
   const report=await page.evaluate(()=>{
    const v=getSignal(0,"D"),buy=v.events.find(e=>e.type==="buy"&&e.t.startsWith("2024-01-16"));
    const stop=buy&&v.events.find(e=>e.type==="stopLoss"&&e.structureId===buy.structureId);
    const rows=getHistoryStats().rows, trades=rows.reduce((a,r)=>a+r.v.trades.length,0);
    const day=rows.filter(r=>r.period==="D");
    const total=(field)=>day.reduce((a,r)=>a+(r.stats[field]||0),0);
    const oldPeriod=selectedP;selectedP="D";
    const quickStopCount=quickCollect("correctionStop").length;
    selectedP=oldPeriod;
    const dailyDisplay=[...document.querySelectorAll("#win-period-body tr")].find(e=>e.textContent?.includes("日线"))?.textContent||"";
    return {buy:buy?.t,stop:stop?.t,structures:v.structureLedger.length,
     trades,renderedRows:document.querySelectorAll("#win-trades-body tr").length,
     open:rows.reduce((a,r)=>a+r.v.positions.length,0),
     shownOpen:document.querySelectorAll("#openrecords tbody tr").length,
     hasStructureColumn:!!document.querySelector("#win-trades-body td:nth-child(3)"),
     validPaths:rows.every(r=>r.v.positions.every(p=>p.structureId)&&r.v.trades.every(t=>t.structureId)),
     daySignalBuys:total("correctionBuy"),dayUnitBuys:total("correctionBuyUnits"),
     daySignalStops:total("correctionStop"),dayUnitStops:total("correctionStopUnits"),
     dailyDisplay,quickStopCount};
   });
   assert.equal(report.stop,"2024-01-22");
   assert.equal(report.trades,report.renderedRows);
   assert.equal(report.open,report.shownOpen);
   assert(report.hasStructureColumn&&report.validPaths);
   assert(report.daySignalBuys>0&&report.dayUnitBuys>=report.daySignalBuys,"Every buy signal maps to one or more independently owned units");
   assert(report.daySignalStops>0&&report.dayUnitStops>=report.daySignalStops,"Every correction stop signal maps to one or more unit exits");
   assert.equal(report.quickStopCount,report.daySignalStops,"Correction-stop point selector shows one event per trigger");
   assert(report.dailyDisplay.includes(report.daySignalBuys+" / "+report.dayUnitBuys),"Daily buy signal/unit accounting is visible");
   assert(report.dailyDisplay.includes(report.daySignalStops+" / "+report.dayUnitStops),"Daily stop signal/unit accounting is visible");
   await page.locator("#view-replay").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.equal(await page.locator(".confluence-item").count(),4);
   assert.equal(await page.locator(".chart-card .estimate").count(),0,"Historical replay has no next-candle prediction footers");
   assert(await page.locator(".replay-overview .replay-metric").count()>=5);
   await page.locator(".replay-node").filter({hasText:"首次买入"}).first().click();
   const replay=await page.evaluate(()=>{
    const c=replayCurrent(),node=c.nodes[replayNodeIndex],confluence=replayResonance(c,node);
    return {direction:confluence.direction,matches:confluence.matched,node:node.t,
     charts:[0,1,2,3].map(i=>{
      const v=getSignal(i,c.period),at=findEndAtOrBefore(v.bars,node.t)-1;
      const card=document.querySelector("#card"+i);
      return {t:v.bars[at]?.t,close:v.bars[at]?.c,shown:card.querySelector(".closeprice").textContent,
       inWindow:visible(i).bars.some(b=>b.t===v.bars[at]?.t)};
     })};
   });
   assert.equal(replay.direction,"buy");
   assert(replay.matches>=1);
   assert(replay.charts.every(x=>x.t===undefined?x.shown==="—":x.t<=replay.node&&x.inWindow&&
    Math.abs(Number(x.shown.replace(/,/g,""))-x.close)<.006),"Four replay charts render prices for the selected historical time");
   await page.locator(".replay-node").filter({hasText:"纠错止损"}).first().click();
   assert(await page.evaluate(()=>{
    const c=replayCurrent(),node=c.nodes[replayNodeIndex];
    return node.trade?.exitType==="correctionStop"&&node.trade.exitT===node.t&&node.reference===false;
   }),"Correction stops shown in replay must be recorded exits");
   assert.equal(await page.locator("#replay-memo,#replay-save").count(),0);
   await page.locator("#view-market").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   for(const p of ["15","60","90","120","D","W"]){
    await page.locator('#periodbar [data-p="'+p+'"]').click();
    assert.equal(await page.locator(".chart-card:visible").count(),4);
    assert(await page.evaluate(()=>[0,1,2,3].every(i=>getSignal(i,selectedP)?.bars.length>=60)));
   }
   if(await page.evaluate(()=>maxPanOffset()>2)){
    await page.evaluate(()=>setPanOffset(3));
    assert.equal(await page.locator(".chart-card .estimate").count(),0,"Historical Kline browsing should not show forward projections");
    await page.evaluate(()=>setPanOffset(0));
   }
   assert.deepEqual(errors,[],"Browser script errors");
   console.log("LEDGER_UI_PASS",JSON.stringify({viewport,...report,projectionPanels}));
   }finally{await browser.close()}
  }
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);if(server.listening)server.close();process.exitCode=1});
