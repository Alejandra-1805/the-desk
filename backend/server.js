import http from "node:http";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const PORT=Number(process.env.PORT||3000);
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const JUPITER_KEY=process.env.JUPITER_API_KEY||"";
const HELIUS_KEY=process.env.HELIUS_API_KEY||"";
const OPENAI_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const RUN_SECRET=process.env.RUN_SECRET||"";
const TRADING_MODE=(process.env.TRADING_MODE||"paper").toLowerCase();
const AUTOMATION_ENABLED=(process.env.BOT_AUTOMATION_ENABLED||"true")==="true";
const SCAN_INTERVAL_MS=Math.max(60000,Number(process.env.SCAN_INTERVAL_MS||300000));

const supabase=SUPABASE_URL&&SUPABASE_KEY?createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const openai=OPENAI_KEY?new OpenAI({apiKey:OPENAI_KEY}):null;

const AGENTS=[
  {id:"bull",name:"BULL",style:"trend continuation + bullish confirmation",mission:"Prefer strong continuation, genuine demand, improving momentum and cleaner market structure. Penalize weak liquidity and obvious overextension."},
  {id:"degen",name:"DEGEN",style:"momentum + volatility + fast trades",mission:"Seek fast momentum and expanding activity, but reject obvious low-quality or illiquid traps."},
  {id:"quant",name:"QUANT",style:"systematic multi-signal confirmation",mission:"Be evidence-first. Prefer higher organic score, sufficient liquidity, broad confirmation and consistent numerical signals."},
  {id:"bear",name:"BEAR",style:"risk-first + reversal detection",mission:"Look for fragility, distribution, overextension and downside risk. WAIT is valid when bearish."}
];

function headers(){const h={accept:"application/json"};if(JUPITER_KEY)h["x-api-key"]=JUPITER_KEY;return h;}
function normalize(t){
  const liquidity=Number(t.liquidity||t.liquidityUsd||t.liquidityUSD||t.stats24h?.liquidity||0);
  const volume5m=Number(t.stats5m?.buyVolume||t.stats5m?.volume||t.volume5m||t.volume_5m||0);
  const organicScore=Number(t.organicScore??t.organic_score??0);
  const price=Number(t.usdPrice??t.price??t.priceUsd??0);
  const change5m=Number(t.stats5m?.priceChange??t.priceChange5m??0);
  const change1h=Number(t.stats1h?.priceChange??t.priceChange1h??0);
  return {mint:t.id||t.address||t.mint||"",symbol:t.symbol||"UNKNOWN",name:t.name||t.symbol||"Unknown",liquidityUsd:liquidity,volume5mUsd:volume5m,organicScore,price,priceChange5m:change5m,priceChange1h:change1h};
}
function guard(x){
  let s=0;
  if(x.organicScore>=80)s+=2; else if(x.organicScore>=65)s+=1;
  if(x.liquidityUsd>=100000)s+=2; else if(x.liquidityUsd>=25000)s+=1;
  if(x.volume5mUsd>=25000)s+=2; else if(x.volume5mUsd>=5000)s+=1;
  if(x.priceChange5m>0&&x.priceChange5m<15)s+=1;
  if(x.priceChange5m>25)s-=2;
  if(x.priceChange1h>60)s-=2;
  return s;
}
async function candidates(){
  if(!JUPITER_KEY)throw new Error("JUPITER_API_KEY missing");
  const r=await fetch("https://api.jup.ag/tokens/v2/toporganicscore/5m",{headers:headers(),cache:"no-store"});
  if(!r.ok)throw new Error("Jupiter feed failed "+r.status);
  const j=await r.json();
  const arr=Array.isArray(j)?j:(j.tokens||j.data||[]);
  return arr.map(normalize).filter(x=>x.mint&&x.organicScore>=60&&(x.liquidityUsd===0||x.liquidityUsd>=25000)&&(x.volume5mUsd===0||x.volume5mUsd>=5000)).map(x=>({...x,guardScore:guard(x)})).sort((a,b)=>b.guardScore-a.guardScore).slice(0,10);
}
async function decide(agent,list){
  if(!openai)throw new Error("OPENAI_API_KEY missing");
  const response=await openai.responses.create({
    model:OPENAI_MODEL,
    input:[
      {role:"system",content:[{type:"input_text",text:`You are ${agent.name}, one of four competing AI market agents on Solana. Style: ${agent.style}. Mandate: ${agent.mission}. Use only supplied verified market metrics. Output BUY or WAIT. Do not invent news, fills, balances or social data. A deterministic layer may reject a BUY.`}]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({trading_mode:TRADING_MODE,candidates:list})}]}
    ],
    text:{format:{type:"json_schema",name:"market_agent_decision",strict:true,schema:{type:"object",additionalProperties:false,properties:{
      decision:{type:"string",enum:["BUY","WAIT"]},mint:{type:["string","null"]},symbol:{type:["string","null"]},confidence:{type:"number",minimum:0,maximum:1},comment:{type:"string"}
    },required:["decision","mint","symbol","confidence","comment"]}}}
  });
  const out=JSON.parse(response.output_text);
  const chosen=list.find(x=>x.mint===out.mint)||null;
  if(out.decision==="BUY"&&(!chosen||chosen.guardScore<2)) return {...out,decision:"WAIT",mint:null,symbol:null,comment:"Deterministic risk gate rejected the selected token."};
  if(out.decision==="WAIT") return {...out,mint:null,symbol:null};
  return out;
}
async function scan(){
  if(!supabase)throw new Error("Supabase not configured");
  const list=await candidates();
  if(!list.length)throw new Error("No candidates passed filters");
  const results=[];
  for(const agent of AGENTS){
    try{
      await supabase.from("agents").update({status:"ANALYZING",updated_at:new Date().toISOString()}).eq("id",agent.id);
      const d=await decide(agent,list);
      const chosen=d.mint?list.find(x=>x.mint===d.mint)||null:null;
      const event={
        agent_id:agent.id,
        event_type:d.decision==="BUY"?"AI_BUY_DECISION":"AI_WAIT_DECISION",
        token_mint:d.mint,
        token_symbol:d.symbol,
        decision:d.decision,
        confidence:d.confidence,
        reason:d.comment,
        payload:{...d,candidate:chosen,trading_mode:TRADING_MODE,source:"railway-bot"}
      };
      const {error}=await supabase.from("agent_events").insert(event); if(error)throw error;
      await supabase.from("agents").update({status:d.decision==="BUY"?"SIGNAL READY":"SCANNING",updated_at:new Date().toISOString()}).eq("id",agent.id);
      results.push({agent:agent.id,...d});
    }catch(e){
      await supabase.from("agents").update({status:"ERROR",updated_at:new Date().toISOString()}).eq("id",agent.id);
      results.push({agent:agent.id,error:e.message});
    }
  }
  await supabase.from("system_state").upsert({key:"last_live_scan",value:{at:new Date().toISOString(),candidate_count:list.length,source:"railway-bot"},updated_at:new Date().toISOString()});
  return {ok:true,candidate_count:list.length,results,at:new Date().toISOString()};
}

let running=false;
let lastRun=null;
async function runSafe(){
  if(running)return;
  running=true;
  try{lastRun=await scan();console.log("scan",JSON.stringify(lastRun));}
  catch(e){lastRun={ok:false,error:e.message,at:new Date().toISOString()};console.error("scan_error",e);}
  finally{running=false;}
}

function json(res,status,body){res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(body));}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET"&&url.pathname==="/health") return json(res,200,{ok:true,service:"market-agents-bot",automation_enabled:AUTOMATION_ENABLED,trading_mode:TRADING_MODE,database_configured:Boolean(supabase),jupiter_configured:Boolean(JUPITER_KEY),helius_configured:Boolean(HELIUS_KEY),ai_configured:Boolean(openai),last_run:lastRun?.at||null});
  if(req.method==="GET"&&url.pathname==="/status") return json(res,200,{ok:true,running,lastRun});
  if(req.method==="POST"&&url.pathname==="/run"){
    const supplied=req.headers["x-run-secret"]||"";
    if(!RUN_SECRET||supplied!==RUN_SECRET)return json(res,401,{ok:false,error:"Unauthorized"});
    await runSafe();
    return json(res,lastRun?.ok?200:503,lastRun||{ok:false,error:"No result"});
  }
  return json(res,404,{ok:false,error:"Not found"});
});

server.listen(PORT,"0.0.0.0",()=>{
  console.log("MARKET AGENTS bot listening on",PORT);
  if(AUTOMATION_ENABLED){setTimeout(runSafe,15000);setInterval(runSafe,SCAN_INTERVAL_MS);}
});
