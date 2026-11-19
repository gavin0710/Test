import {readMarketArchive,privateDataHeaders} from "../lib/market-archive.mjs";

export default async function handler(req,res){
 privateDataHeaders(res);
 const period=String(req.query?.period||"");
 if(!["15","101","102"].includes(period))return res.status(400).json({error:"Unsupported history period"});
 try{
  const {payload,source}=await readMarketArchive("history-"+period+".json",
   data=>Array.isArray(data?.data)&&data.data.length===4&&data.period===period&&
    data.data.every(index=>Array.isArray(index[period])),12000);
  res.setHeader("X-Data-Archive-Period",period);
  res.setHeader("X-Market-Data-Source",source);
  return res.status(200).json(payload);
 }catch(error){
  return res.status(503).json({error:"History archive is not yet available",period,details:[error.message]});
 }
}
