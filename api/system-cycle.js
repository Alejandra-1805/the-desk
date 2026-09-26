import { createClient } from "@supabase/supabase-js";
import { markPaperPositions } from "../lib/paper-mark.js";
import { paperScan } from "../lib/paper-core.js";
import { runDeskScan, executeBuy, executeSell } from "../lib/solana-core.js";
import { monitorLivePositions } from "../lib/live-monitor.js";
import { runRobinhoodAgents } from "../lib/robinhood-agents.js";
import { markRobinhoodPositions } from "../lib/evm-mark.js";

async function schedulerSecret(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return "";
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data}=await supabase.from("system_state").select("value").eq("key","scheduler_secret").maybeSingle();
  const v=data?.value;
  return typeof v==="string"?v:(v?.value||"");
}

async function automationState(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return {paused:true};
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await supabase.from("system_state").select("key,value").in("key",["bot_paused"]);
  if(error) throw error;
  const row=(data||[]).find(x=>x.key==="bot_paused");
  const raw=row?.value;
  const paused=raw===true || raw==="true" || raw?.value===true;
  return {paused};
}

async function enforceAutoLimits(supabase,agentId,requestedSol){
  const maxDaily=Math.min(Number(process.env.MAX_DAILY_SOL||"0.01"),0.01);
  const maxOpen=Math.min(Math.max(Number(process.env.MAX_OPEN_POSITIONS||"1"),1),2);
  const dayStart=new Date(); dayStart.setUTCHours(0,0,0,0);
  const {data:resetRow,error:resetErr}=await supabase.from("system_state")
    .select("value").eq("key","execution_limit_reset_at").maybeSingle();
  if(resetErr) throw resetErr;
  const resetRaw=resetRow?.value;
  const resetText=typeof resetRaw==="string"?resetRaw:(resetRaw?.value||null);
  const resetAt=resetText?new Date(resetText):null;
  const limitStart=(resetAt && !Number.isNaN(resetAt.getTime()) && resetAt>dayStart)?resetAt:dayStart;
  const [{data:events,error:eErr},{data:positions,error:pErr}]=await Promise.all([
    supabase.from("agent_events").select("payload,created_at")
      .eq("agent_id",agentId).eq("event_type","BUY_EXECUTED")
      .gte("created_at",limitStart.toISOString()),
    supabase.from("positions").select("id").eq("agent_id",agentId).eq("status","OPEN")
  ]);
  if(eErr) throw eErr;
  if(pErr) throw pErr;
  const used=(events||[]).reduce((s,e)=>s+Number(e.payload?.amount_sol||0),0);
  if(used+Number(requestedSol||0)>maxDaily+1e-12) throw new Error("Daily limit reached");
  if((positions||[]).length>=maxOpen) throw new Error("Open-position limit reached");
  return {used,maxDaily,maxOpen,limitWindowStart:limitStart.toISOString()};
}

async function executePendingIntents(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return {executed:0,skipped:0,errors:[]};
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {paused}=await automationState();
  if(paused) return {executed:0,skipped:0,paused:true,errors:[]};

  const autoBuy=process.env.AUTO_EXECUTION_ENABLED==="true";
  const autoSell=process.env.AUTO_SELL_ENABLED==="true";
  if(!autoBuy && !autoSell) return {executed:0,skipped:0,paused:false,errors:[]};

  const {data:intents,error}=await supabase.from("trade_intents")
    .select("*").eq("status","PENDING").order("created_at",{ascending:true}).limit(20);
  if(error) throw error;

  let executed=0, skipped=0;
  const errors=[];
  const ordered=[...(intents||[])].sort((a,b)=>(a.action==="SELL"?-1:1)-(b.action==="SELL"?-1:1));

  for(const intent of ordered){
    try{
      if(intent.expires_at && new Date(intent.expires_at).getTime()<Date.now()){
        await supabase.from("trade_intents").update({status:"EXPIRED"}).eq("id",intent.id);
        skipped++;
        continue;
      }

      if(intent.action==="SELL"){
        if(!autoSell){skipped++;continue;}
        const data=await executeSell({agentId:intent.agent_id,mint:intent.token_mint});
        await supabase.from("trade_intents").update({
          status:"EXECUTED",
          payload:{...(intent.payload||{}),auto_executed_at:new Date().toISOString(),result:{signature:data?.execution?.signature||data?.execution?.txid||null}}
        }).eq("id",intent.id).eq("status","PENDING");
        executed++;
        continue;
      }

      if(intent.action==="BUY"){
        if(!autoBuy){skipped++;continue;}
        await enforceAutoLimits(supabase,intent.agent_id,intent.amount_sol);
        const data=await executeBuy({agentId:intent.agent_id,mint:intent.token_mint,amountSol:intent.amount_sol});
        await supabase.from("trade_intents").update({
          status:"EXECUTED",
          payload:{...(intent.payload||{}),auto_executed_at:new Date().toISOString(),result:{signature:data?.execution?.signature||data?.execution?.txid||null}}
        }).eq("id",intent.id).eq("status","PENDING");
        executed++;
      }
    }catch(e){
      errors.push({id:intent.id,agent:intent.agent_id,action:intent.action,error:e?.message||"Execution failed"});
    }
  }
  return {executed,skipped,paused:false,errors};
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
    const chain=(process.env.EXECUTION_CHAIN||"robinhood").toLowerCase();
    if(chain==="robinhood"){
      const {paused}=await automationState();
      let marked=null,analysis=null;
      try{marked=await markRobinhoodPositions();}catch(e){marked={ok:false,error:e?.message||"EVM mark failed"};}
      try{analysis=await runRobinhoodAgents({save:true});}catch(e){analysis={ok:false,error:e?.message||"Robinhood scan failed"};}
      return res.status(200).json({
        ok:true,
        chain:"robinhood",
        chain_id:4663,
        bot_paused:paused,
        mode:"dry_run",
        max_trade_usd:0.50,
        max_open_positions:1,
        marked,
        analysis,
        automation:{
          broadcast:false,
          evm_execution_enabled:process.env.EVM_EXECUTION_ENABLED==="true",
          paused
        },
        note:"Robinhood agents are scanning and recording signals. No transaction can broadcast while EVM execution remains disabled."
      });
    }
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
    const liveMonitor=mode==="live"?await monitorLivePositions():null;
    const intents=mode==="live"?await queueLiveIntents():{queued:0};
    const automation=mode==="live"?await executePendingIntents():null;
    return res.status(200).json({ok:true,mode,marked,scanned,live_monitor:liveMonitor,intents,automation});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"System cycle failed"});
  }
}