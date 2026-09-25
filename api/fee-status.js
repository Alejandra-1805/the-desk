import { createClient } from "@supabase/supabase-js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await supabase.from("creator_fee_events").select("amount_sol,amount_usd,processed,received_at");
    if(error) throw error;
    const rows=data||[];
    const totalUsd=rows.reduce((s,x)=>s+Number(x.amount_usd||0),0);
    const unprocessedUsd=rows.filter(x=>!x.processed).reduce((s,x)=>s+Number(x.amount_usd||0),0);
    const threshold=Number(process.env.SPAWN_THRESHOLD_USD||10);
    return res.status(200).json({
      ok:true,
      configured:Boolean(process.env.CREATOR_FEE_WALLET&&process.env.PROJECT_TOKEN_MINT&&process.env.HELIUS_WEBHOOK_SECRET),
      events:rows.length,
      total_usd:Number(totalUsd.toFixed(4)),
      unprocessed_usd:Number(unprocessedUsd.toFixed(4)),
      spawn_threshold_usd:threshold,
      progress_pct:threshold?Number(Math.min(100,unprocessedUsd/threshold*100).toFixed(1)):0,
      spawns_available:threshold?Math.floor(unprocessedUsd/threshold):0
    });
  }catch(e){return res.status(503).json({ok:false,error:e?.message||"Fee status failed"});}
}