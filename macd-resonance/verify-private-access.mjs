import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import latest from "./api/latest.js";
import history from "./api/history.js";

const savedFetch=globalThis.fetch;
const savedToken=process.env.MACD_GITHUB_TOKEN,savedPrivate=process.env.MACD_REPOSITORY_PRIVATE;
const fixtures=Object.fromEntries(await Promise.all(["latest","history-15","history-101","history-102"].map(async name=>
 [name+".json",JSON.parse(await readFile(new URL("./data/"+name+".json",import.meta.url),"utf8"))])));
let checks=0;
async function invoke(handler,query={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(p){this.body=p;return this}};
 await handler({query},res);
 assert.match(res.headers["Cache-Control"],/private, no-store/);
 assert.equal(res.headers["Access-Control-Allow-Origin"],undefined);
 return res;
}
try{
 process.env.MACD_GITHUB_TOKEN="test-only-not-a-real-credential";
 process.env.MACD_REPOSITORY_PRIVATE="true";
 globalThis.fetch=async(url,options)=>{
  const parsed=new URL(url),name=parsed.pathname.split("/").at(-1);
  assert.equal(parsed.origin,"https://api.github.com");
  assert.equal(parsed.searchParams.get("ref"),"master");
  assert.equal(options.headers.Authorization,"Bearer "+process.env.MACD_GITHUB_TOKEN);
  assert.equal(options.headers.Accept,"application/vnd.github.raw+json");
  assert.equal(options.redirect,"error");
  assert.equal(options.cache,"no-store");
  assert(!url.includes(process.env.MACD_GITHUB_TOKEN));
  return Response.json(fixtures[name]);
 };
 for(const period of [null,"15","101","102"]){
  const res=await invoke(period?history:latest,period?{period}:{});
  assert.equal(res.code,200);
  assert.deepEqual(res.body,fixtures[period?"history-"+period+".json":"latest.json"]);
  assert.equal(res.headers["X-Market-Data-Source"],"github-authenticated");
  assert(!JSON.stringify(res).includes(process.env.MACD_GITHUB_TOKEN));
  checks++;
 }
 for(const status of [401,403,404,429]){
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response("upstream",{status})};
  const res=await invoke(latest);
  assert.equal(res.code,503);assert.equal(calls,1,"Private reads cannot fall back to a public mirror");checks++;
 }
 globalThis.fetch=async()=>{throw new Error("sensitive "+process.env.MACD_GITHUB_TOKEN)};
 const failure=await invoke(history,{period:"101"});
 assert.equal(failure.code,503);assert(!JSON.stringify(failure).includes(process.env.MACD_GITHUB_TOKEN));checks++;
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[]})};
 assert.equal((await invoke(latest)).code,503);checks++;
 calls=0;assert.equal((await invoke(history,{period:"../../secret"})).code,400);assert.equal(calls,0);checks++;
 delete process.env.MACD_GITHUB_TOKEN;
 assert.equal((await invoke(latest)).code,503);assert.equal(calls,0);checks++;
 delete process.env.MACD_REPOSITORY_PRIVATE;
 calls=0;globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(options.headers,undefined);
  return calls===1?new Response("unavailable",{status:503}):Response.json(fixtures["latest.json"]);
 };
 const publicFallback=await invoke(latest);
 assert.equal(publicFallback.code,200);assert.equal(calls,2);
 assert.equal(publicFallback.headers["X-Market-Data-Source"],"githack-fallback");checks++;
 console.log("PRIVATE_ARCHIVE_ACCESS_PASS",JSON.stringify({checks,archives:4,largeDailyArchiveBytes:JSON.stringify(fixtures["history-101.json"]).length}));
}finally{
 globalThis.fetch=savedFetch;
 if(savedToken===undefined)delete process.env.MACD_GITHUB_TOKEN;else process.env.MACD_GITHUB_TOKEN=savedToken;
 if(savedPrivate===undefined)delete process.env.MACD_REPOSITORY_PRIVATE;else process.env.MACD_REPOSITORY_PRIVATE=savedPrivate;
}
