// Vercel serverless market snapshot proxy. Shares one verified source of truth with the GitHub data collector.
export default async function handler(req,res){
 res.setHeader("Access-Control-Allow-Origin","*");
 res.setHeader("Cache-Control","no-store, max-age=0");
 const list=[
  "https://raw.githubusercontent.com/gavin0710/Test/master/macd-resonance/data/latest.json",
  "https://raw.githack.com/gavin0710/Test/master/macd-resonance/data/latest.json"
 ];
 const failures=[];
 for(const u of list){
  try{
   const ctrl=new AbortController();
   const timer=setTimeout(()=>ctrl.abort(),9500);
   let response;
   try{response=await fetch(u+"?nocache="+Date.now(),{signal:ctrl.signal,cache:"no-store"})}
   finally{clearTimeout(timer)}
   if(!response.ok)throw new Error("http "+response.status);
   const payload=await response.json();
   if(!Array.isArray(payload?.data)||payload.data.length!==4)throw new Error("Invalid Kline snapshot");
   res.setHeader("X-Market-Data-Source",u.includes("githubusercontent")?"github-raw":"githack-fallback");
   return res.status(200).json(payload);
  }catch(e){failures.push(String(e?.message||e))}
 }
 return res.status(503).json({error:"行情归档暂不可用",details:failures})
}
