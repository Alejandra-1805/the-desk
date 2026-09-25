import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const JUPITER_KEY=process.env.JUPITER_API_KEY||"";
const OPENAI_KEY=process.env.OPENAI_API_KEY||"";
const MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const TRADING_MODE=(process.env.TRADING_MODE||"paper").toLowerCase();
const MIN_ORGANIC_SCORE=60;
const MIN_LIQUIDITY_USD=25000;
const MIN_VOLUME_5M_USD=5000;

const openai=OPENAI_KEY?new OpenAI({apiKey:OPENAI_KEY}):null;
const supabase=SUPABASE_URL&&SUPABASE_KEY?createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;

export const AGENTS=[
  {id:"bull",name:"BULL",style:"trend continuation",mission:"Prefer improving momentum, positive short-term price action, strong organic score, sufficient liquidity and healthy activity."},
  {id:"degen",name:"DEGEN",style:"fast momentum",mission:"Prefer faster momentum and activity expansion, but penalize violent overextension and weak liquidity."},
  {id:"quant",name:"QUANT",style:"systematic confirmation",mission:"Be numerical and conservative. Prefer multiple independent metrics agreeing before BUY."},
  {id:"bear",name:"BEAR",style:"risk-first reversal",mission:"Focus on downside and overextension risk. Because V1 is spot-only, use WAIT when downside risk dominates."}
];

function headers(){return {"accept":"application/json","x-api-key":JUPITER_KEY};}

function normalize(t){
  const liquidity=Number(t.liquidity||t.liquidityUsd||t.liquidityUSD||t.stats24h?.liquidity||0);
  const volume5m=Number(t.stats5m?.buyVolume||t.stats5m?.volume||t.volume5m||t.volume_5m||0);
  const organicScore=Number(t.organicScore??t.organic_score??0);
  const price=Number(t.usdPrice??t.price??t.priceUsd??0);
  const change5m=Number(t.stats5m?.priceChange??t.priceChange5m??0);
  const change1h=Number(t.stats1h?.priceChange??t.priceChange1h??0);
  return {
    mint:t.id||t.address||t.mint||"",
    symbol:t.symbol||"UNKNOWN",
    name:t.name||t.symbol||"Unknown",
    priceUsd:Number.isFinite(price)?price:0,
    organicScore:Number.isFinite(organicScore)?organicScore:0,
    organicLabel:t.organicScoreLabel||t.organic_score_label||null,
    liquidityUsd:Number.isFinite(liquidity)?liquidity:0,
    volume5mUsd:Number.isFinite(volume5m)?volume5m:0,
    priceChange5m:Number.isFinite(change5m)?change5m:0,
    priceChange1h:Number.isFinite(change1h)?change1h:0
  };
}

function guardScore(t){
  let s=0;
  if(t.organicScore>=85)s+=2; else if(t.organicScore>=70)s+=1;
  if(t.liquidityUsd>=250000)s+=2; else if(t.liquidityUsd>=MIN_LIQUIDITY_USD)s+=1;
  if(t.volume5mUsd>=25000)s+=2; else if(t.volume5mUsd>=MIN_VOLUME_5M_USD)s+=1;
  if(t.priceChange5m>0&&t.priceChange5m<12)s+=1;
  if(t.priceChange5m>20)s-=2;
  if(Math.abs(t.priceChange1h)>150)s-=2;
  return s;
}

export async function fetchPumpCandidates(){
  if(!JUPITER_KEY) throw new Error("JUPITER_API_KEY is not configured");
  const r=await fetch("https://api.jup.ag/tokens/v2/toporganicscore/5m",{headers:headers(),cache:"no-store"});
  if(!r.ok) throw new Error("Jupiter token feed failed ("+r.status+")");
  const json=await r.json();
  const arr=Array.isArray(json)?json:(json.tokens||json.data||[]);
  return arr.map(normalize)
    .filter(t=>t.mint&&t.mint.toLowerCase().endsWith("pump"))
    .filter(t=>t.organicScore>=MIN_ORGANIC_SCORE)
    .filter(t=>t.liquidityUsd>=MIN_LIQUIDITY_USD)
    .filter(t=>t.volume5mUsd>=MIN_VOLUME_5M_USD)
    .map(t=>({...t,guardScore:guardScore(t)}))
    .sort((a,b)=>b.guardScore-a.guardScore)
    .slice(0,8);
}

async function decide(agent,candidates){
  if(!openai) throw new Error("OPENAI_API_KEY is not configured");
  const response=await openai.responses.create({
    model:MODEL,
    input:[
      {role:"system",content:[{type:"input_text",text:`You are ${agent.name}, one of four competing AI agents in THE DESK on Solana.
Style: ${agent.style}.
Mandate: ${agent.mission}
Use ONLY the verified Jupiter metrics provided. Never invent news, social activity, holders, fills, wallet balances or transaction confirmations.
This is PAPER MODE: no transaction can be signed or sent.
Choose BUY or WAIT. BUY only one candidate. Amount is a hypothetical paper allocation capped at 0.02 SOL.`}]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({mode:"paper",candidates})}]}
    ],
    text:{format:{type:"json_schema",name:"paper_decision",strict:true,schema:{
      type:"object",additionalProperties:false,
      properties:{
        decision:{type:"string",enum:["BUY","WAIT"]},
        mint:{type:["string","null"]},
        symbol:{type:["string","null"]},
        confidence:{type:"number",minimum:0,maximum:100},
        amount_sol:{type:"number",minimum:0,maximum:0.02},
        reasons:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
        risks:{type:"array",items:{type:"string"},minItems:1,maxItems:2},
        comment:{type:"string"}
      },
      required:["decision","mint","symbol","confidence","amount_sol","reasons","risks","comment"]
    }}}
  });
  const out=JSON.parse(response.output_text);
  const selected=candidates.find(x=>x.mint===out.mint);
  if(out.decision==="BUY"&&(!selected||selected.guardScore<2)){
    return {...out,decision:"WAIT",mint:null,symbol:null,amount_sol:0,comment:"Deterministic risk gate rejected the proposed BUY."};
  }
  if(out.decision==="WAIT") return {...out,mint:null,symbol:null,amount_sol:0};
  return out;
}

export async function paperScan(){
  if(TRADING_MODE!=="paper") throw new Error("Paper scan is disabled unless TRADING_MODE=paper");
  if(!supabase) throw new Error("Supabase is not configured");

  const {data:last}=await supabase.from("system_state").select("value,updated_at").eq("key","last_paper_scan").maybeSingle();
  if(last?.updated_at){
    const age=Date.now()-new Date(last.updated_at).getTime();
    if(age<10*60*1000){
      return {throttled:true,next_in_seconds:Math.ceil((10*60*1000-age)/1000),message:"A paper scan already ran recently."};
    }
  }

  const candidates=await fetchPumpCandidates();
  if(!candidates.length) throw new Error("No pump.fun candidates passed the current safety filters");

  const decisions=[];
  for(const agent of AGENTS){
    const d=await decide(agent,candidates);
    const chosen=d.mint?candidates.find(x=>x.mint===d.mint)||null:null;
    const event={
      agent_id:agent.id,
      event_type:d.decision==="BUY"?"PAPER_BUY_DECISION":"PAPER_WAIT_DECISION",
      token_mint:d.mint,
      token_symbol:d.symbol,
      decision:d.decision,
      confidence:d.confidence,
      reason:d.comment,
      payload:{...d,candidate:chosen,trading_mode:"paper",executed:false}
    };
    const {error}=await supabase.from("agent_events").insert(event);
    if(error) throw error;
    await supabase.from("agents").update({status:d.decision==="BUY"?"PAPER SIGNAL":"SCANNING",updated_at:new Date().toISOString()}).eq("id",agent.id);
    decisions.push({agent:agent.id,...d,candidate:chosen});
  }

  await supabase.from("system_state").upsert({
    key:"last_paper_scan",
    value:{at:new Date().toISOString(),candidate_count:candidates.length},
    updated_at:new Date().toISOString()
  });

  return {throttled:false,mode:"paper",candidate_count:candidates.length,candidates,decisions,created_at:new Date().toISOString()};
}
