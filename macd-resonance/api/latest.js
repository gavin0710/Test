import {readMarketArchive,privateDataHeaders} from "../lib/market-archive.mjs";

export default async function handler(req,res){
 privateDataHeaders(res);
 try{
  const {payload,source}=await readMarketArchive("latest.json",
   data=>Array.isArray(data?.data)&&data.data.length===4,9500);
  res.setHeader("X-Market-Data-Source",source);
  return res.status(200).json(payload);
 }catch(error){
  return res.status(503).json({error:"行情归档暂不可用",details:[error.message]});
 }
}
