import { paperScan } from "../lib/paper-core.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const data=await paperScan();
    return res.status(200).json({ok:true,data});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Paper scan failed"});
  }
}