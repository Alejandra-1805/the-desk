import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { scanRobinhoodOpportunities, fetchEthUsd } from "./robinhood-market.js";

export const MAX_TRADE_USD=0.50;
export const MAX_OPEN_POSITIONS=1;

const AGENTS=[
  {
    id:"bull",name:"BULL",
    style:"trend continuation + bullish confirmation",
    mission:"Prefer sustained positive momentum, rising buy pressure, healthy liquidity and continuation without extreme overextension."
  },
  {
    id:"degen",name:"DEGEN",
    style:"momentum + volatility + fast trades",
    mission:"Prefer strong short-term activity and acceleration. Accept more volatility than the others, but reject thin liquidity, extreme fees and obvious blow-off moves."
  },
  {
    id:"quant",name:"QUANT",
    style:"systematic multi-signal confirmation",
    mission:"Require agreement between liquidity, volume, transaction flow, price momentum and risk score. Trade less often when signals conflict."
  },
  {
    id:"bear",name:"BEAR",
    style:"risk-first + reversal detection",
    mission:"Prioritize capital preservation. Look for improving structure after weakness or controlled reversal setups; WAIT when downside risk or overextension dominates."
  }
];

function db(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) throw new Error("Supabase not configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function ai(){
  if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({apiKey:process.env.OPENAI_API_KEY});
}

async function decide(agent,candidates){
  const client=ai();
  const response=await client.responses.create({
    model:process.env.OPENAI_MODEL||"gpt-5.6-luna",
    input:[
      {role:"system",content:[{type:"input_text",text:
        `You are ${agent.name}, one of four autonomous experimental trading agents on Robinhood Chain (chain 4663).
Strategy: ${agent.style}.
Mandate: ${agent.mission}
Use ONLY the supplied market metrics. Never invent news, social sentiment, fills, balances, liquidity or prices.
This is spot-only. You may BUY one candidate or WAIT.
A deterministic risk layer can reject your choice.
Maximum capital per trade is USD ${MAX_TRADE_USD.toFixed(2)} and maximum open positions is one.`
      }]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({chainId:4663,maxTradeUsd:MAX_TRADE_USD,candidates})}]}
    ],
    text:{format:{
      type:"json_schema",name:"muse_robinhood_decision",strict:true,
      schema:{
        type:"object",additionalProperties:false,
        properties:{
          decision:{type:"string",enum:["BUY","WAIT"]},
          tokenAddress:{type:["string","null"]},
          symbol:{type:["string","null"]},
          confidence:{type:"number",minimum:0,maximum:100},
          amountUsd:{type:"number",minimum:0,maximum:0.5},
          reasons:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
          risks:{type:"array",items:{type:"string"},minItems:1,maxItems:2},
          comment:{type:"string"}
        },
        required:["decision","tokenAddress","symbol","confidence","amountUsd","reasons","risks","comment"]
      }
    }}
  });
  return JSON.parse(response.output_text);
}

function enforceDecision(out,candidates){
  if(out.decision!=="BUY") return {...out,decision:"WAIT",tokenAddress:null,symbol:null,amountUsd:0};
  const selected=candidates.find(x=>x.address?.toLowerCase()===String(out.tokenAddress||"").toLowerCase());
  if(!selected) return {...out,decision:"WAIT",tokenAddress:null,symbol:null,amountUsd:0,comment:"Risk engine rejected an unknown token selection."};
  if(selected.riskScore<3 || selected.liquidityUsd<5000){
    return {...out,decision:"WAIT",tokenAddress:null,symbol:null,amountUsd:0,comment:"Risk engine rejected the selection because minimum quality gates were not met."};
  }
  const amount=Math.min(MAX_TRADE_USD,Math.max(0.05,Number(out.amountUsd||MAX_TRADE_USD)));
  return {...out,amountUsd:Number(amount.toFixed(2)),selected};
}

export async function runRobinhoodAgents({save=true}={}){
  const supabase=db();
  const market=await scanRobinhoodOpportunities({limit:16});
  const ethPriceUsd=await fetchEthUsd();
  const candidates=market.candidates;
  if(!candidates.length) return {ok:true,mode:"dry_run",market,ethPriceUsd,decisions:[],note:"No candidates passed risk filters."};

  const {data:openRows,error:openErr}=await supabase.from("positions")
    .select("agent_id,token_mint,status,chain_id")
    .eq("status","OPEN").eq("chain_id",4663);
  if(openErr) throw openErr;
  const openAgents=new Set((openRows||[]).map(x=>x.agent_id));

  const decisions=[];
  for(const agent of AGENTS){
    if(openAgents.has(agent.id)){
      decisions.push({agent:agent.id,decision:"WAIT",amountUsd:0,comment:"Maximum one open position reached."});
      continue;
    }
    try{
      const raw=await decide(agent,candidates);
      const d=enforceDecision(raw,candidates);
      const amountEth=(d.decision==="BUY" && ethPriceUsd)?d.amountUsd/ethPriceUsd:0;
      const payload={
        chain:"robinhood",chain_id:4663,mode:"dry_run",
        strategy:agent.style,max_trade_usd:MAX_TRADE_USD,
        amount_usd:d.amountUsd,amount_eth:amountEth||null,
        eth_price_usd:ethPriceUsd,candidate:d.selected||null,
        reasons:d.reasons||[],risks:d.risks||[]
      };
      let eventId=null;
      if(save){
        const {data:event,error}=await supabase.from("agent_events").insert({
          agent_id:agent.id,
          event_type:d.decision==="BUY"?"EVM_BUY_SIGNAL":"EVM_WAIT_SIGNAL",
          token_mint:d.tokenAddress,
          token_symbol:d.symbol,
          decision:d.decision,
          confidence:d.confidence,
          reason:d.comment,
          payload,
          chain_id:4663,
          reference_price_usd:d.selected?.priceUsd||null
        }).select("id").single();
        if(error) throw error;
        eventId=event.id;

        if(d.decision==="BUY"){
          const {error:intentErr}=await supabase.from("trade_intents").insert({
            agent_id:agent.id,action:"BUY",
            token_mint:d.tokenAddress,token_symbol:d.symbol,
            amount_sol:null,amount_eth:amountEth||null,amount_usd:d.amountUsd,
            reason:d.comment,confidence:d.confidence,status:"PENDING",
            source_event_id:eventId,chain_id:4663,
            payload:{...payload,dry_run:true,broadcast_allowed:false},
            expires_at:new Date(Date.now()+15*60*1000).toISOString()
          });
          if(intentErr) throw intentErr;
        }
        await supabase.from("agents").update({
          status:d.decision==="BUY"?"SIGNAL READY":"SCANNING",
          updated_at:new Date().toISOString()
        }).eq("id",agent.id);
      }
      decisions.push({agent:agent.id,...d,amountEth:amountEth||null,eventId});
    }catch(e){
      decisions.push({agent:agent.id,error:e?.message||"Agent decision failed"});
      if(save) await supabase.from("agents").update({status:"ERROR",updated_at:new Date().toISOString()}).eq("id",agent.id);
    }
  }
  return {ok:true,mode:"dry_run",chain:"robinhood",chainId:4663,maxTradeUsd:MAX_TRADE_USD,maxOpenPositions:MAX_OPEN_POSITIONS,ethPriceUsd,market:{...market,candidates},decisions,createdAt:new Date().toISOString()};
}
