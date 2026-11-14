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

async function chartState(page){
 return page.evaluate(()=>{
  const range=chartWindow();
  return {period:selectedP,start:range.startT,end:range.endT,times:range.times,density:visibleBars,
   sliders:[...document.querySelectorAll(".history-slider")].map(s=>[s.min,s.max,s.value,s.disabled]),
   charts:[0,1,2,3].map(i=>{
    const data=visible(i,range),card=document.querySelector("#card"+i);
    return {bars:data?.bars.map(b=>b.t)||[],slots:data?.slots||[],
     first:getSignal(i,selectedP)?.bars[0].t,last:getSignal(i,selectedP)?.bars.at(-1).t,
     shown:card.querySelector(".chart-time").getAttribute("datetime"),
     close:card.querySelector(".closeprice").textContent};
   })};
 });
}
function assertAligned(state){
 assert(state.sliders.every(s=>JSON.stringify(s)===JSON.stringify(state.sliders[0])),"The four history sliders must agree");
 assert.equal(state.times.length,state.density,"Available history fills the requested shared slots");
 for(const chart of state.charts){
  assert.deepEqual(chart.bars,chart.slots.map(slot=>state.times[slot]),"Identical dates occupy identical x slots");
  assert(chart.bars.every(t=>t>=state.start&&t<=state.end));
  if(chart.first>state.end){
   assert.equal(chart.shown,null);
   assert.equal(chart.close,"—","An index cannot show a quote before it had history");
  }
 }
}
async function waitForEnd(page,oldEnd){
 await page.waitForFunction(end=>document.querySelector("#chartgrid")?.dataset.windowEnd!==end,oldEnd);
}
async function touchDrag(cdp,x,y,dx,dy){
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
 for(let step=1;step<=8;step++){
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx*step/8,y:y+dy*step/8}]});
 }
 await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
}
async function verifyNavigation(page,viewport){
 const touch=viewport.width<600;
 const range=page.locator("#card0 .history-slider");
 assert.equal(await page.locator("#quickfilter,#history-slider,.history-strip,.buynav,.chartfoot").count(),0);
 assert.equal(await page.locator("#chartgrid input[type=range]:visible").count(),4);
 assert.equal(await page.locator(".secondary details[open]").count(),0);
 assert(await page.evaluate(()=>{
  const toolbar=document.querySelector(".toolbar"),grid=document.querySelector("#chartgrid");
  return toolbar.nextElementSibling===grid&&toolbar.contains(document.querySelector("#density-count"))&&
   [...grid.querySelectorAll(".chartarea")].every(area=>
    area.querySelector(".kplot").nextElementSibling.matches(".chart-history")&&
    area.querySelector(".chart-history").nextElementSibling.matches(".macd-head"));
 }));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"The page fits the viewport at rest");
 const input=page.locator("#density-count");
 await input.fill("73");await input.press("Enter");
 assert.equal(await input.inputValue(),"73");
 const latest=await chartState(page);
 assertAligned(latest);
 await page.locator("#density-plus").click();
 assert.equal(await input.inputValue(),"83");
 await page.locator("#density-minus").click();
 assert.equal(await input.inputValue(),"73");
 await input.fill("501");await input.press("Enter");
 assert.equal(await input.inputValue(),"500");
 await input.fill("14");await input.press("Enter");
 assert.equal(await input.inputValue(),"15");
 await input.fill("100");await input.press("Enter");

 const cdp=touch?await page.context().newCDPSession(page):null;
 await range.scrollIntoViewIfNeeded();
 const bar=await range.boundingBox(),y=bar.y+bar.height/2;
 if(touch)await touchDrag(cdp,bar.x+bar.width-8,y,-bar.width*.55,0);
 else{
  await page.mouse.move(bar.x+bar.width-8,y);
  await page.mouse.down();await page.mouse.move(bar.x+bar.width*.45,y,{steps:8});await page.mouse.up();
 }
 await waitForEnd(page,latest.end);
 const panned=await chartState(page);
 assertAligned(panned);
 assert(panned.end<latest.end,"The history slider is draggable");
 assert.equal(await page.locator(".chart-card .estimate").count(),0);
 await page.locator("#card2 .history-slider").focus();
 await page.locator("#card2 .history-slider").press("Home");
 const earliest=await chartState(page);
 assertAligned(earliest);
 assert.equal(earliest.start,earliest.charts[0].first);
 assert(earliest.charts.slice(2).every(x=>!x.bars.length&&x.shown===null),"Early windows leave the later indices empty");
 await page.locator("#history-reset").click();
 assert.equal((await chartState(page)).end,latest.end);

 const plot=page.locator("#k0");
 await plot.scrollIntoViewIfNeeded();
 let plotBox=await plot.boundingBox();
 let x=plotBox.x+plotBox.width*.30,plotY=plotBox.y+plotBox.height*.62;
 if(touch){
  const scroll=await page.evaluate(()=>scrollY);
  await touchDrag(cdp,x,plotY,3,-105);
  await page.waitForFunction(before=>scrollY>before+30,scroll);
  assert.equal((await chartState(page)).end,latest.end,"A vertical swipe scrolls the page without moving history");
  await plot.scrollIntoViewIfNeeded();
  plotBox=await plot.boundingBox();x=plotBox.x+plotBox.width*.30;plotY=plotBox.y+plotBox.height*.60;
  await touchDrag(cdp,x,plotY,80,2);
 }else{
  await page.mouse.move(x,plotY);
  await page.mouse.down();await page.mouse.move(x+110,plotY+2,{steps:10});await page.mouse.up();
 }
 await waitForEnd(page,latest.end);
 const dragged=await chartState(page);
 assertAligned(dragged);
 assert(dragged.end<latest.end,"Direct drag on a K-line changes the shared window");
 await page.locator("#history-reset").click();
 await range.focus();await range.press("Home");
 const anchor=(await chartState(page)).end;
 assert.equal(anchor,(await chartState(page)).times.at(-1));
 await input.fill("50");await input.press("Enter");
 assert.equal((await chartState(page)).end,anchor,"Zoom preserves the chosen date when the window fits");
 await page.locator('#periodbar [data-p="W"]').click();
 await page.locator('#periodbar [data-p="D"]').click();
 assert.equal((await chartState(page)).end,anchor,"The daily window survives a period change");
 await page.locator("#card0 .expand").click();
 assert.equal(await page.locator(".chart-card:visible").count(),1);
 assert.equal((await chartState(page)).end,anchor,"Focus keeps the historical window");
 await page.locator("#card0 .expand").click();
 assert.equal(await page.locator(".chart-card:visible").count(),4);
 if(cdp)await cdp.detach();
}

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
   const page=await browser.newPage({viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600,
    deviceScaleFactor:viewport.width<600?2:1});
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
    const latest=at?.window.isLatest&&v?.bars?.at(-1)?.t===at?.window.endT;
    return {i,mode:v?.projection?.mode||"none",shown:!!document.querySelector("#card"+i+" .estimate"),
     expected:!!latest&&isFocusedProjection(v?.projection)};
   }));
   assert(projectionPanels.every(x=>x.shown===x.expected),"Only confirmed divergence watch/campaign should display next-candle projection");
   await verifyNavigation(page,viewport);
   const report=await page.evaluate(()=>{
    const v=getSignal(0,"D"),buy=v.events.find(e=>e.type==="buy"&&e.t.startsWith("2024-01-16"));
    const stop=buy&&v.events.find(e=>e.type==="stopLoss"&&e.structureId===buy.structureId);
    const rows=getHistoryStats().rows, trades=rows.reduce((a,r)=>a+r.v.trades.length,0);
    const day=rows.filter(r=>r.period==="D");
    const total=(field)=>day.reduce((a,r)=>a+(r.stats[field]||0),0);
    const events=collectHistoryEvents("D");
    const stops=events.filter(e=>e.type==="correctionStop");
    const rawEvents=day.reduce((a,r)=>a+r.v.events.length,0);
    const dailyDisplay=[...document.querySelectorAll("#win-period-body tr")].find(e=>e.textContent?.includes("日线"))?.textContent||"";
    return {buy:buy?.t,stop:stop?.t,structures:v.structureLedger.length,
     trades,renderedRows:document.querySelectorAll("#win-trades-body tr").length,
     open:rows.reduce((a,r)=>a+r.v.positions.length,0),
     shownOpen:document.querySelectorAll("#openrecords tbody tr").length,
     hasStructureColumn:!!document.querySelector("#win-trades-body td:nth-child(3)"),
     validPaths:rows.every(r=>r.v.positions.every(p=>p.structureId)&&r.v.trades.every(t=>t.structureId)),
     daySignalBuys:total("correctionBuy"),dayUnitBuys:total("correctionBuyUnits"),
     daySignalStops:total("correctionStop"),dayUnitStops:total("correctionStopUnits"),
     dailyDisplay,stopRows:stops.length,stopUnits:stops.reduce((a,e)=>a+e.units,0),
     historyCount:events.length,rawEvents,vanish:events.some(e=>e.type==="expired"||e.type==="invalid"),
     unpaired:events.filter(e=>e.label.includes("未配对")).length,expectedUnpaired:total("unpairedSells")};
   });
   assert.equal(report.stop,"2024-01-22");
   assert.equal(report.trades,report.renderedRows);
   assert.equal(report.open,report.shownOpen);
   assert(report.hasStructureColumn&&report.validPaths);
   assert(report.daySignalBuys>0&&report.dayUnitBuys>=report.daySignalBuys,"Every buy signal maps to one or more independently owned units");
   assert(report.daySignalStops>0&&report.dayUnitStops>=report.daySignalStops,"Every correction stop signal maps to one or more unit exits");
   assert.equal(report.stopRows,report.daySignalStops,"The history log shows one correction-stop event per trigger");
   assert.equal(report.stopUnits,report.dayUnitStops);
   assert.equal(report.historyCount,report.rawEvents-report.stopUnits+report.stopRows,"All other events reach the paged history log");
   assert(report.vanish&&report.unpaired>0);
   assert.equal(report.unpaired,report.expectedUnpaired,"Unpaired sells remain individually identifiable");
   assert(report.dailyDisplay.includes(report.daySignalBuys+" / "+report.dayUnitBuys),"Daily buy signal/unit accounting is visible");
   assert(report.dailyDisplay.includes(report.daySignalStops+" / "+report.dayUnitStops),"Daily stop signal/unit accounting is visible");
   await page.locator("#winfold > summary").click();
   assert(await page.locator("#win-period-body").isVisible());
   await page.locator("#winfold > summary").click();
   const history=page.locator("#history-fold");
   await history.locator("summary").click();
   const firstDate=await history.locator(".eventrow time").first().getAttribute("datetime");
   await history.getByRole("button",{name:"下一页"}).click();
   assert((await history.locator(".eventrow time").first().getAttribute("datetime"))<=firstDate,"Older events are reachable");
   const row=history.locator("button.eventrow[data-type='invalid'],button.eventrow[data-type='expired']").first();
   const target=await row.locator("time").getAttribute("datetime");
   await row.click();
   let window=await chartState(page);
   assert(window.start<=target&&target<=window.end&&window.charts.some(x=>x.shown===target),"History entries locate the actual candle");
   const windowBeforeReplay=window.end;
   await page.locator("#view-replay").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.equal(await page.locator(".confluence-item").count(),4);
   assert.equal(await page.locator(".chart-card .estimate").count(),0,"Historical replay has no next-candle prediction footers");
   assert.equal(await page.locator(".history-slider:visible,#history-reset:visible").count(),0,"Manual scrolling controls are hidden during replay");
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
   window=await chartState(page);
   assert(window.start<=replay.node&&replay.node<=window.end);
   assertAligned(window);
   const replayPlot=page.locator("#k0");
   await replayPlot.scrollIntoViewIfNeeded();
   const replayBox=await replayPlot.boundingBox();
   await page.mouse.move(replayBox.x+55,replayBox.y+80);
   await page.mouse.down();await page.mouse.move(replayBox.x+140,replayBox.y+82,{steps:5});await page.mouse.up();
   assert.equal((await chartState(page)).end,window.end,"Manual drag cannot move an active replay node");
   await page.locator(".replay-node").filter({hasText:"纠错止损"}).first().click();
   assert(await page.evaluate(()=>{
    const c=replayCurrent(),node=c.nodes[replayNodeIndex];
    return node.trade?.exitType==="correctionStop"&&node.trade.exitT===node.t&&node.reference===false;
   }),"Correction stops shown in replay must be recorded exits");
   assert.equal(await page.locator("#replay-memo,#replay-save").count(),0);
   await page.locator("#view-market").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   const restored=await chartState(page);
   assert.equal(restored.end,windowBeforeReplay,"Market mode restores its own selected window");
   await page.locator("#history-reset").click();
   for(const p of ["15","60","90","120","D","W"]){
    await page.locator('#periodbar [data-p="'+p+'"]').click();
    assert.equal(await page.locator(".chart-card:visible").count(),4);
    assert(await page.evaluate(()=>[0,1,2,3].every(i=>getSignal(i,selectedP)?.bars.length>=60)));
   }
   assert.deepEqual(errors,[],"Browser script errors");
   console.log("LEDGER_UI_PASS",JSON.stringify({viewport,...report,projectionPanels}));
   }finally{await browser.close()}
  }
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);if(server.listening)server.close();process.exitCode=1});
