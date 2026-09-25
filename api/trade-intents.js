import { createClient } from "@supabase/supabase-js";

export default async function handler(req,res){
  const expected=process.env.RUN_SECRET||"";
  const supplied=String(req.headers["x-run-secret"]||"");
  if(!expected || supplied!==expected) return res.status(401).json({ok:false,error:"Unauthorized"});
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return res.status(503).json({ok:false,error:"Supabase not configured"});
  try{
    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await supabase
      .from("trade_intents")
      .select("id,agent_id,action,token_symbol,token_mint,amount_sol,reason,confidence,status,payload,created_at,expires_at")
      .order("created_at",{ascending:false})
      .limit(25);
    if(error) throw error;
    return res.status(200).json({ok:true,intents:data||[]});
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"Failed to load trade intents"});
  }
}