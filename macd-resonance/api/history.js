// Public, read-only history proxy. Historical bars are committed to GitHub,
// not generated in the request, and are kept separate from the fast snapshot.
export default async function handler(req,res){
 const period=String(req.query?.period||"");
 if(!["15","101","102"].includes(period))return res.status(400).json({error:"Unsupported history period"});
 res.setHeader("Access-Control-Allow-Origin","*");
 res.setHeader("Cache-Control","no-store, max-age=0");
 const file="macd-resonance/data/history-"+period+".json";
 const urls=[
  "https://raw.githubusercontent.com/gavin0710/Test/master/"+file,
  "https://raw.githack.com/gavin0710/Test/master/"+file
 ];
 const errors=[];
 for(const u of urls){
  try{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   let upstream;
   try{upstream=await fetch(u+"?ts="+Date.now(),{signal:controller.signal,cache:"no-store"})}
   finally{clearTimeout(timer)}
   if(!upstream.ok)throw Error("Upstream "+upstream.status);
   const payload=await upstream.json();
   if(!Array.isArray(payload.data)||payload.data.length!==4||payload.period!==period)throw Error("Invalid history data");
   if(payload.data.some(o=>!Array.isArray(o[period])))throw Error("Missing period array");
   res.setHeader("X-Data-Archive-Period",period);
   return res.status(200).json(payload);
  }catch(e){errors.push(String(e.message||e))}
 }
 return res.status(503).json({error:"History archive is not yet available",period,details:errors});
}
