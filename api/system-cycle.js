import { createClient } from "@supabase/supabase-js";
import { markPaperPositions } from "../lib/paper-mark.js";
import { paperScan } from "../lib/paper-core.js";
import { runDeskScan } from "../lib/solana-core.js";

async function schedulerSecret(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return "";
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data}=await supabase.from("system_state").select("value").eq("key","scheduler_secret").maybeSingle();
  const v=data?.value;
  return typeof v==="string"?v:(v?.value||"");
}

async function queueLiveIntents(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return {queued:0};
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const since=new Date(Date.now()-10*60*1000).toISOString();
  const {data:events,error}=await supabase
    .from("agent_events")
    .select("id,agent_id,event_type,token_mint,token_symbol,decision,confidence,reason,payload,created_at")
    .eq("event_type","AI_BUY_DECISION")
    .eq("decision","BUY")
    .gte("created_at",since)
    .order("created_at",{ascending:false});
  if(error) throw error;
  let queued=0;
  for(const e of events||[]){
    const amount=Math.min(Number(e.payload?.amount_sol||process.env.MAX_TRADE_SOL||0.002),Number(process.env.MAX_TRADE_SOL||0.002),0.002);
    const {error:upsertError}=await supabase.from("trade_intents").upsert({
      agent_id:e.agent_id,
      action:"BUY",
      token_mint:e.token_mint,
      token_symbol:e.token_symbol,
      amount_sol:amount,
      reason:e.reason,
      confidence:e.confidence,
      source_event_id:e.id,
      payload:{mode:"live",source:"system-cycle",event_created_at:e.created_at},
      expires_at:new Date(Date.now()+10*60*1000).toISOString()
    },{onConflict:"agent_id,action,source_event_id",ignoreDuplicates:true});
    if(upsertError) throw upsertError;
    queued++;
  }
  return {queued};
}

export default async function handler(req,res){
  const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const envSecret=process.env.CRON_SECRET||"";
  const dbSecret=await schedulerSecret();
  if(!supplied || (supplied!==envSecret && supplied!==dbSecret)){
    return res.status(401).json({ok:false,error:"Unauthorized"});
  }
  try{
    const mode=(process.env.TRADING_MODE||"paper").toLowerCase();
    let marked=null;
    try{marked=await markPaperPositions();}catch(e){marked={ok:false,error:e?.message||"Mark skipped"};}
    let scanned=null;
    if(mode==="paper"){
      try{scanned=await paperScan();}
      catch(e){scanned={ok:false,error:e?.message||"Scan skipped"};}
    }else{
      try{scanned=await runDeskScan({save:true});}
      catch(e){scanned={ok:false,error:e?.message||"Live scan skipped"};}
    }
    const intents=mode==="live"?await queueLiveIntents():{queued:0};
    return res.status(200).json({ok:true,mode,marked,scanned,intents});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"System cycle failed"});
  }
}