import { createClient } from "@supabase/supabase-js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const expected=process.env.RUN_SECRET||"";
  const supplied=String(req.headers["x-run-secret"]||"");
  if(!expected || supplied!==expected) return res.status(401).json({ok:false,error:"Unauthorized"});
  const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
  const id=Number(body.intent_id);
  if(!Number.isFinite(id)) return res.status(400).json({ok:false,error:"Invalid intent_id"});
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return res.status(503).json({ok:false,error:"Supabase not configured"});
  try{
    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:row,error:readErr}=await supabase.from("trade_intents")
      .select("id,agent_id,action,token_symbol,token_mint,status,reason,payload")
      .eq("id",id).maybeSingle();
    if(readErr) throw readErr;
    if(!row) return res.status(404).json({ok:false,error:"Intent not found"});
    if(row.action!=="SELL") return res.status(400).json({ok:false,error:"Only SELL intents can be approved here"});
    if(row.status!=="PENDING") return res.status(409).json({ok:false,error:"Intent is not pending",intent:row});
    const {data,error}=await supabase.from("trade_intents")
      .update({status:"APPROVED",payload:{...(row.payload||{}),approved_at:new Date().toISOString(),approval_source:"control-panel"}})
      .eq("id",id)
      .select("id,agent_id,action,token_symbol,token_mint,status,reason,payload")
      .single();
    if(error) throw error;
    return res.status(200).json({ok:true,intent:data,note:"SELL approved. Approval does not itself broadcast a Solana transaction."});
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"Approval failed"});
  }
}