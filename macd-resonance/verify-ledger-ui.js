#!/usr/bin/env node
"use strict";
const http=require("http"),fs=require("fs"),path=require("path"),assert=require("node:assert/strict");
const {chromium}=require("/tmp/macd-ledger-v2/node_modules/playwright");
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
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  for(const viewport of [{width:1500,height:960},{width:390,height:844}]){
   const page=await browser.newPage({viewport});
   const errors=[];page.on("pageerror",err=>errors.push(err.message));
   await page.route(/eastmoney\.com/,route=>route.abort());
   const resp=await page.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
   assert.equal(resp.status(),200);
   await page.waitForFunction(()=>getSignal(0,"D")?.bars?.length>=8763,null,{timeout:45000});
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.equal(await page.locator(".kplot").count(),4);
   assert.equal(await page.locator(".mplot").count(),4);
   assert.equal(await page.locator("#statsbody tr").count(),24);
   const report=await page.evaluate(()=>{
    const v=getSignal(0,"D"),buy=v.events.find(e=>e.type==="buy"&&e.t.startsWith("2024-01-16"));
    const stop=buy&&v.events.find(e=>e.type==="stopLoss"&&e.structureId===buy.structureId);
    const rows=getHistoryStats().rows, trades=rows.reduce((a,r)=>a+r.v.trades.length,0);
    return {buy:buy?.t,stop:stop?.t,structures:v.structureLedger.length,
     trades,renderedRows:document.querySelectorAll("#win-trades-body tr").length,
     open:rows.reduce((a,r)=>a+r.v.positions.length,0),
     shownOpen:document.querySelectorAll("#openrecords tbody tr").length,
     hasStructureColumn:!!document.querySelector("#win-trades-body td:nth-child(3)"),
     validPaths:rows.every(r=>r.v.positions.every(p=>p.structureId)&&r.v.trades.every(t=>t.structureId))};
   });
   assert.equal(report.stop,"2024-01-22");
   assert.equal(report.trades,report.renderedRows);
   assert.equal(report.open,report.shownOpen);
   assert(report.hasStructureColumn&&report.validPaths);
   await page.locator("#view-replay").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.equal(await page.locator(".confluence-item").count(),4);
   assert(await page.locator(".replay-overview .replay-metric").count()>=5);
   await page.locator("#view-market").click();
   assert.equal(await page.locator(".chart-card:visible").count(),4);
   assert.deepEqual(errors,[],"Browser script errors");
   console.log("LEDGER_UI_PASS",JSON.stringify({viewport,...report}));
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
