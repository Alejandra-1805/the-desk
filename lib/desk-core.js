import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const WATCHLIST = (process.env.WATCHLIST || "AAPL,TSLA,NVDA,META")
  .split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

const marketKey = process.env.TWELVE_DATA_API_KEY || "";
const openaiKey = process.env.OPENAI_API_KEY || "";
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession:false, autoRefreshToken:false }
    })
  : null;

const openai = openaiKey ? new OpenAI({ apiKey:openaiKey }) : null;

export const AGENTS = [
  { id:"bull", name:"BULL", color:"blue", mission:"Look for upside, trend continuation, improving momentum and bullish evidence, while explicitly acknowledging invalidation risks." },
  { id:"degen", name:"DEGEN", color:"orange", mission:"Focus on short-term momentum, velocity, abnormal volume, volatility expansion and fast asymmetric setups. Avoid inventing catalysts." },
  { id:"quant", name:"QUANT", color:"green", mission:"Be evidence-first and numerical. Prioritize indicator alignment, probability, signal quality and contradictions." },
  { id:"bear", name:"BEAR", color:"purple", mission:"Look for downside, overextension, weak structure and reversal risk, while explicitly acknowledging bullish evidence." }
];

const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
const pct = (a,b) => ((a/b)-1)*100;

function sma(values,n){ return values.length>=n ? avg(values.slice(-n)) : null; }

function rsi(values,n=14){
  if(values.length<n+1) return null;
  let gains=0, losses=0;
  for(let i=values.length-n;i<values.length;i++){
    const d=values[i]-values[i-1];
    if(d>=0) gains+=d; else losses-=d;
  }
  if(losses===0) return 100;
  const rs=(gains/n)/(losses/n);
  return 100-(100/(1+rs));
}

function volatility(values,n=20){
  if(values.length<n+1) return null;
  const returns=[];
  for(let i=values.length-n;i<values.length;i++) returns.push((values[i]-values[i-1])/values[i-1]);
  const m=avg(returns);
  return Math.sqrt(avg(returns.map(v=>(v-m)**2)))*Math.sqrt(252)*100;
}

export function ensureTicker(ticker){
  const t=(ticker||"").toUpperCase().trim();
  if(!WATCHLIST.includes(t)) throw new Error("Ticker not in watchlist");
  return t;
}

export async function fetchMarket(ticker){
  if(!marketKey) throw new Error("TWELVE_DATA_API_KEY is not configured");
  ticker=ensureTicker(ticker);

  const [seriesRes, quoteRes] = await Promise.all([
    fetch("https://api.twelvedata.com/time_series?" + new URLSearchParams({
      symbol:ticker, interval:"1day", outputsize:"120", format:"JSON", apikey:marketKey
    }), { cache:"no-store" }),
    fetch("https://api.twelvedata.com/quote?" + new URLSearchParams({
      symbol:ticker, apikey:marketKey
    }), { cache:"no-store" })
  ]);

  if(!seriesRes.ok || !quoteRes.ok) throw new Error("Market data provider request failed");
  const series=await seriesRes.json();
  const quote=await quoteRes.json();
  if(series.status==="error") throw new Error(series.message || "Time series unavailable");
  if(quote.status==="error") throw new Error(quote.message || "Quote unavailable");

  const rows=(series.values||[]).slice().reverse();
  if(rows.length<55) throw new Error("Not enough market history");
  const closes=rows.map(r=>Number(r.close)).filter(Number.isFinite);
  const latest=rows.at(-1);
  const price=Number(quote.close || quote.price || latest.close);
  const previousClose=Number(quote.previous_close || rows.at(-2).close);
  const volume=Number(quote.volume || latest.volume || 0);
  const avgVolume20=avg(rows.slice(-20).map(r=>Number(r.volume||0)));
  const high20=Math.max(...rows.slice(-20).map(r=>Number(r.high)));
  const low20=Math.min(...rows.slice(-20).map(r=>Number(r.low)));

  return {
    ticker,
    timestamp: quote.datetime || latest.datetime || new Date().toISOString(),
    price,
    open:Number(quote.open || latest.open),
    high:Number(quote.high || latest.high),
    low:Number(quote.low || latest.low),
    previousClose,
    changePct:pct(price,previousClose),
    volume,
    avgVolume20,
    volumeVsAvgPct:avgVolume20 ? pct(volume,avgVolume20) : null,
    sma20:sma(closes,20),
    sma50:sma(closes,50),
    rsi14:rsi(closes,14),
    volatility20:volatility(closes,20),
    momentum5:pct(price,closes.at(-6)),
    momentum20:pct(price,closes.at(-21)),
    distanceHigh20Pct:pct(price,high20),
    distanceLow20Pct:pct(price,low20),
    candles:rows.slice(-60).map(r=>({
      datetime:r.datetime,
      open:Number(r.open), high:Number(r.high),
      low:Number(r.low), close:Number(r.close),
      volume:Number(r.volume||0)
    }))
  };
}

export function deterministicSignal(s){
  let score=0;
  score += s.changePct>0 ? 1 : -1;
  score += s.price>s.sma20 ? 1 : -1;
  score += s.price>s.sma50 ? 1 : -1;
  if(s.rsi14>=55 && s.rsi14<=72) score++;
  if(s.rsi14>76) score--;
  if(s.rsi14<34) score++;
  if(s.momentum5>0) score++; else score--;
  if(s.volatility20>75) score--;
  return {
    score,
    bias:score>=3 ? "LONG" : score<=-3 ? "SHORT" : "WAIT",
    confidence:Math.max(50,Math.min(88,50+Math.abs(score)*6))
  };
}

async function runAgent(agent,snapshot){
  if(!openai) throw new Error("OPENAI_API_KEY is not configured");
  const baseline=deterministicSignal(snapshot);
  const verified={
    ticker:snapshot.ticker,
    price:snapshot.price,
    change_pct:snapshot.changePct,
    volume:snapshot.volume,
    volume_vs_avg_pct:snapshot.volumeVsAvgPct,
    sma20:snapshot.sma20,
    sma50:snapshot.sma50,
    rsi14:snapshot.rsi14,
    volatility20:snapshot.volatility20,
    momentum_5d:snapshot.momentum5,
    momentum_20d:snapshot.momentum20,
    distance_high20_pct:snapshot.distanceHigh20Pct,
    distance_low20_pct:snapshot.distanceLow20Pct,
    deterministic_baseline:baseline
  };

  const response=await openai.responses.create({
    model:openaiModel,
    input:[
      {
        role:"system",
        content:[{type:"input_text",text:`You are ${agent.name}, one of four competing market agents in THE DESK.
${agent.mission}
Use ONLY the verified numeric market data supplied to you.
Never invent news, earnings, fundamentals, events, fills, trades, positions, prices or performance.
Your output is market analysis, not execution or investment advice.`}]
      },
      {role:"user",content:[{type:"input_text",text:JSON.stringify(verified)}]}
    ],
    text:{format:{
      type:"json_schema",
      name:"desk_agent_call",
      strict:true,
      schema:{
        type:"object",
        additionalProperties:false,
        properties:{
          bias:{type:"string",enum:["LONG","SHORT","WAIT"]},
          confidence:{type:"number",minimum:0,maximum:100},
          reasons:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
          risks:{type:"array",items:{type:"string"},minItems:1,maxItems:2},
          comment:{type:"string"}
        },
        required:["bias","confidence","reasons","risks","comment"]
      }
    }}
  });

  return { agent_id:agent.id, agent_name:agent.name, ...JSON.parse(response.output_text) };
}

function consensus(calls){
  const weighted=calls.reduce((sum,c)=>{
    const dir=c.bias==="LONG"?1:c.bias==="SHORT"?-1:0;
    return sum+dir*Number(c.confidence||0);
  },0);
  const denom=calls.reduce((sum,c)=>sum+Number(c.confidence||0),0)||1;
  const x=weighted/denom;
  return {
    label:x>0.18?"LONG":x<-0.18?"SHORT":"WAIT",
    confidence:Math.round(Math.abs(x)*100),
    vote:{
      long:calls.filter(c=>c.bias==="LONG").length,
      short:calls.filter(c=>c.bias==="SHORT").length,
      wait:calls.filter(c=>c.bias==="WAIT").length
    }
  };
}

export async function runDesk(ticker,{save=true}={}){
  ticker=ensureTicker(ticker);
  const snapshot=await fetchMarket(ticker);
  const calls=[];
  for(const agent of AGENTS) calls.push(await runAgent(agent,snapshot));
  const deskConsensus=consensus(calls);
  let runId=null;

  if(save && supabase){
    const { data:run, error:runError } = await supabase
      .from("desk_runs")
      .insert({
        ticker,
        reference_price:snapshot.price,
        market_timestamp:snapshot.timestamp,
        consensus:deskConsensus.label,
        consensus_confidence:deskConsensus.confidence,
        snapshot
      })
      .select("id")
      .single();
    if(runError) throw runError;
    runId=run.id;

    const { error:callsError } = await supabase.from("agent_calls").insert(
      calls.map(c=>({
        desk_run_id:runId,
        agent_id:c.agent_id,
        agent_name:c.agent_name,
        bias:c.bias,
        confidence:c.confidence,
        reasons:c.reasons,
        risks:c.risks,
        comment:c.comment
      }))
    );
    if(callsError) throw callsError;

    const { error:resultsError } = await supabase.from("call_results").insert(
      ["1H","1D","1W"].map(horizon=>({desk_run_id:runId,horizon}))
    );
    if(resultsError) throw resultsError;
  }

  return {run_id:runId,snapshot,agents:calls,desk_consensus:deskConsensus};
}

export async function getLatest(ticker){
  if(!supabase) throw new Error("Supabase is not configured");
  ticker=ensureTicker(ticker);
  const { data:run, error } = await supabase
    .from("desk_runs")
    .select("*")
    .eq("ticker",ticker)
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error) throw error;
  if(!run) return null;
  const { data:calls, error:callsError } = await supabase
    .from("agent_calls")
    .select("*")
    .eq("desk_run_id",run.id)
    .order("id");
  if(callsError) throw callsError;
  return {...run,agents:calls||[]};
}

export async function getLeaderboard(){
  if(!supabase) throw new Error("Supabase is not configured");
  const { data:calls, error:callsError }=await supabase.from("agent_calls").select("id,desk_run_id,agent_id,agent_name,bias");
  if(callsError) throw callsError;
  const { data:results, error:resultsError }=await supabase.from("call_results").select("desk_run_id,horizon,return_pct,resolved").eq("horizon","1D");
  if(resultsError) throw resultsError;
  const byRun=new Map((results||[]).map(r=>[String(r.desk_run_id),r]));
  const stats=new Map();
  for(const c of calls||[]){
    if(!stats.has(c.agent_id)) stats.set(c.agent_id,{agent_id:c.agent_id,agent_name:c.agent_name,calls:0,resolved:0,wins:0});
    const s=stats.get(c.agent_id); s.calls++;
    const r=byRun.get(String(c.desk_run_id));
    if(r?.resolved){
      s.resolved++;
      const ret=Number(r.return_pct);
      if((c.bias==="LONG"&&ret>0)||(c.bias==="SHORT"&&ret<0)||(c.bias==="WAIT"&&Math.abs(ret)<1)) s.wins++;
    }
  }
  return [...stats.values()].map(s=>({...s,accuracy_pct:s.resolved?Number((s.wins/s.resolved*100).toFixed(1)):null}))
    .sort((a,b)=>(b.accuracy_pct??-1)-(a.accuracy_pct??-1)||b.calls-a.calls);
}
