import { runRobinhoodAgents } from "../lib/robinhood-agents.js";
import { markRobinhoodPositions } from "../lib/evm-mark.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const supplied=req.headers["x-run-secret"]||"";
  if(!process.env.RUN_SECRET || supplied!==process.env.RUN_SECRET){
    return res.status(401).json({ok:false,error:"Unauthorized"});
  }
  try{
    let marked=null;
    try{marked=await markRobinhoodPositions();}catch(e){marked={ok:false,error:e?.message||"mark_failed"};}
    const analysis=await runRobinhoodAgents({save:true});
    return res.status(200).json({
      ok:true,chain:"robinhood",chain_id:4663,mode:"dry_run",
      max_trade_usd:0.50,max_open_positions:1,
      broadcast:false,marked,analysis,
      note:"Signals and intents were recorded. No blockchain transaction was broadcast."
    });
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"Robinhood dry run failed"});
  }
}
