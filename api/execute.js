import { createClient } from "@supabase/supabase-js";
import { parseEther } from "ethers";
import { executeBuyAndRecord, executeSellAndRecord } from "../lib/evm-trading.js";
import { fetchEthUsd } from "../lib/robinhood-market.js";

function client(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
}

async function enforceExecutionLimits(agentId,requestedSol){
  const supabase=client();
  if(!supabase) throw new Error("Supabase not configured");
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

  const [{data:events,error:eErr},{data:positions,error:pErr}] = await Promise.all([
    supabase.from("agent_events")
      .select("payload,created_at")
      .eq("agent_id",agentId)
      .eq("event_type","BUY_EXECUTED")
      .gte("created_at",limitStart.toISOString()),
    supabase.from("positions")
      .select("id")
      .eq("agent_id",agentId)
      .eq("status","OPEN")
  ]);
  if(eErr) throw eErr;
  if(pErr) throw pErr;

  const used=(events||[]).reduce((s,e)=>s+Number(e.payload?.amount_sol||0),0);
  if(used+Number(requestedSol||0) > maxDaily+1e-12){
    throw new Error(`Daily execution limit reached for ${agentId}: ${used.toFixed(6)} / ${maxDaily.toFixed(6)} SOL`);
  }
  if((positions||[]).length>=maxOpen){
    throw new Error(`Open-position limit reached for ${agentId}: ${positions.length} / ${maxOpen}`);
  }
  return {maxDailySol:maxDaily,maxOpenPositions:maxOpen,usedTodaySol:used,openPositions:(positions||[]).length,limitWindowStart:limitStart.toISOString()};
}

export default async function handler(req,res){
  try{
    const chain=(process.env.EXECUTION_CHAIN||"robinhood").toLowerCase();
    const supplied=req.headers["x-run-secret"]||req.query.secret||"";
    if(!process.env.RUN_SECRET || supplied!==process.env.RUN_SECRET) return res.status(401).json({ok:false,error:"Unauthorized"});

    if(chain==="robinhood"){
      const supabase=client();
      if(!supabase) return res.status(503).json({ok:false,error:"Supabase not configured"});
      const {data:state,error:stateErr}=await supabase.from("system_state").select("key,value").in("key",["bot_paused"]);
      if(stateErr) throw stateErr;
      const row=(state||[]).find(x=>x.key==="bot_paused");
      const raw=row?.value;
      const paused=raw===true || raw==="true" || raw?.value===true;

      if(req.method==="GET"){
        const {data:intents,error}=await supabase.from("trade_intents")
          .select("id,agent_id,action,token_symbol,token_mint,amount_eth,amount_usd,reason,confidence,status,payload,created_at,expires_at,chain_id")
          .eq("chain_id",4663).order("created_at",{ascending:false}).limit(25);
        if(error) throw error;
        return res.status(200).json({
          ok:true,chain:"robinhood",chain_id:4663,intents:intents||[],
          bot:{paused,evm_execution_enabled:process.env.EVM_EXECUTION_ENABLED==="true",max_trade_usd:0.50,max_open_positions:1}
        });
      }

      if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
      const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};

      if(body.action==="pause-bot" || body.action==="resume-bot"){
        const next=body.action==="pause-bot";
        const {error}=await supabase.from("system_state").upsert({
          key:"bot_paused",value:next,updated_at:new Date().toISOString()
        },{onConflict:"key"});
        if(error) throw error;
        return res.status(200).json({ok:true,chain:"robinhood",bot_paused:next});
      }

      const agentId=String(body.agent_id||"bull").toLowerCase();
      if(!["bull","degen","quant","bear"].includes(agentId)) return res.status(400).json({ok:false,error:"Invalid agent"});
      const broadcastRequested=body.broadcast===true;
      const broadcastAllowed=broadcastRequested && !paused && process.env.EVM_EXECUTION_ENABLED==="true";

      if(body.action==="buy" || body.action==="prepare-buy"){
        const token=String(body.token||body.mint||"");
        const amountUsd=Math.min(0.50,Math.max(0.01,Number(body.amount_usd||0.50)));
        const ethPriceUsd=await fetchEthUsd();
        if(!ethPriceUsd) return res.status(503).json({ok:false,error:"ETH/USD reference unavailable"});
        const amountEth=amountUsd/ethPriceUsd;
        const amountWei=parseEther(amountEth.toFixed(18)).toString();
        const result=await executeBuyAndRecord({
          agentId,tokenOut:token,amountWei,amountUsd,
          referencePriceUsd:Number(body.reference_price_usd||0)||null,
          allowBroadcast:broadcastAllowed
        });
        return res.status(200).json({
          ok:true,chain:"robinhood",mode:broadcastAllowed?"live":"dry_run",
          max_trade_usd:0.50,eth_price_usd:ethPriceUsd,amount_usd:amountUsd,amount_eth:amountEth,
          bot_paused:paused,broadcast_requested:broadcastRequested,broadcast_allowed:broadcastAllowed,result
        });
      }

      if(body.action==="sell" || body.action==="prepare-sell"){
        const token=String(body.token||body.mint||"");
        const result=await executeSellAndRecord({
          agentId,token,referencePriceUsd:Number(body.reference_price_usd||0)||null,
          allowBroadcast:broadcastAllowed
        });
        return res.status(200).json({
          ok:true,chain:"robinhood",mode:broadcastAllowed?"live":"dry_run",
          bot_paused:paused,broadcast_requested:broadcastRequested,broadcast_allowed:broadcastAllowed,result
        });
      }

      return res.status(400).json({ok:false,error:"Unsupported Robinhood action"});
    }

    const mod=await import("../lib/solana-core.js");
    if(req.method==="GET"){
      const supabase=client();
      if(!supabase) return res.status(503).json({ok:false,error:"Supabase not configured"});
      const [{data,error},{data:state,error:stateErr}]=await Promise.all([
        supabase.from("trade_intents")
          .select("id,agent_id,action,token_symbol,token_mint,amount_sol,reason,confidence,status,payload,created_at,expires_at")
          .order("created_at",{ascending:false}).limit(25),
        supabase.from("system_state").select("key,value").in("key",["bot_paused"])
      ]);
      if(error) throw error;
      if(stateErr) throw stateErr;
      const row=(state||[]).find(x=>x.key==="bot_paused");
      const raw=row?.value;
      const paused=raw===true || raw==="true" || raw?.value===true;
      return res.status(200).json({
        ok:true,
        intents:data||[],
        bot:{
          paused,
          auto_execution_enabled:process.env.AUTO_EXECUTION_ENABLED==="true",
          auto_sell_enabled:process.env.AUTO_SELL_ENABLED==="true",
          max_trade_sol:Number(process.env.MAX_TRADE_SOL||0.002),
          max_daily_sol:Number(process.env.MAX_DAILY_SOL||0.01),
          max_open_positions:Number(process.env.MAX_OPEN_POSITIONS||1)
        }
      });
    }

    if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};

    if(body.action==="pause-bot" || body.action==="resume-bot"){
      const supabase=client();
      if(!supabase) return res.status(503).json({ok:false,error:"Supabase not configured"});
      const paused=body.action==="pause-bot";
      const {error}=await supabase.from("system_state").upsert({
        key:"bot_paused",
        value:paused,
        updated_at:new Date().toISOString()
      },{onConflict:"key"});
      if(error) throw error;
      return res.status(200).json({ok:true,bot_paused:paused});
    }

    if(body.action==="sell"){
      const data=await mod.executeSell({agentId:body.agent_id,mint:body.mint});
      return res.status(200).json({ok:true,data});
    }

    if(body.action==="approve-sell"){
      const id=Number(body.intent_id);
      if(!Number.isFinite(id)) return res.status(400).json({ok:false,error:"Invalid intent_id"});
      const supabase=client();
      if(!supabase) return res.status(503).json({ok:false,error:"Supabase not configured"});
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
      return res.status(200).json({ok:true,intent:data,note:"SELL approved. Approval does not broadcast a Solana transaction."});
    }

    const limits=await enforceExecutionLimits(body.agent_id,body.amount_sol);
    const data=await mod.executeBuy({agentId:body.agent_id,mint:body.mint,amountSol:body.amount_sol});
    return res.status(200).json({ok:true,limits,data});
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"Execute failed",name:e?.name||null,stage:"execute"});
  }
}