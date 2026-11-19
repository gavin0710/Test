// Credentials stay in the Vercel function. Browsers only receive validated OHLC.
const repo="https://api.github.com/repos/gavin0710/Test/contents/macd-resonance/data/";
const allowed=new Set(["latest.json","history-15.json","history-101.json","history-102.json"]);

async function readMarketArchive(file,validate,timeoutMs){
 if(!allowed.has(file))throw new Error("Unsupported archive");
 const token=process.env.MACD_GITHUB_TOKEN?.trim();
 if(process.env.MACD_REPOSITORY_PRIVATE==="true"&&!token)throw new Error("Private archive access is not configured");
 const sources=token?[
  {url:repo+file+"?ref=master",name:"github-authenticated",headers:{
   Authorization:"Bearer "+token,Accept:"application/vnd.github.raw+json",
   "X-GitHub-Api-Version":"2022-11-28","User-Agent":"macd-resonance-monitor"
  }}
 ]:[
  {url:"https://raw.githubusercontent.com/gavin0710/Test/master/macd-resonance/data/"+file,name:"github-raw"},
  {url:"https://raw.githack.com/gavin0710/Test/master/macd-resonance/data/"+file,name:"githack-fallback"}
 ];
 const failures=[];
 for(const source of sources){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   // Never follow an upstream redirect carrying the private read credential.
   const upstream=await fetch(source.url+(token?"&":"?")+"ts="+Date.now(),{
    headers:source.headers,signal:controller.signal,cache:"no-store",redirect:"error"
   });
   if(!upstream.ok){failures.push(source.name+": http "+upstream.status);continue}
   const payload=await upstream.json();
   if(!validate(payload)){failures.push(source.name+": invalid archive");continue}
   return {payload,source:source.name};
  }catch{
   // Upstream exception text may contain credentials or internal details.
   failures.push(source.name+": unavailable");
  }finally{clearTimeout(timer)}
 }
 throw new Error(failures.join("; "));
}

function privateDataHeaders(res){
 res.setHeader("Cache-Control","private, no-store, max-age=0");
 res.setHeader("Vercel-CDN-Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
}

module.exports={readMarketArchive,privateDataHeaders};
