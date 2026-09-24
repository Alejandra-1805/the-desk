import { WATCHLIST, runDesk } from "../lib/desk-core.js";
export default async function handler(req,res){
  const bearer=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const secret=process.env.CRON_SECRET||"";
  if(!secret || bearer!==secret) return res.status(401).json({ok:false,error:"Unauthorized"});
  const output=[];
  for(const ticker of WATCHLIST){
    try{
      const r=await runDesk(ticker,{save:true});
      output.push({ticker,ok:true,run_id:r.run_id,consensus:r.desk_consensus});
    }catch(e){
      output.push({ticker,ok:false,error:e.message});
    }
  }
  res.status(200).json({ok:true,results:output});
}