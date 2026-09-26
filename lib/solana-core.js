import OpenAI from "openai";
import bs58 from "bs58";
import { createClient } from "@supabase/supabase-js";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";

const HELIUS_KEY = process.env.HELIUS_API_KEY || "";
const JUPITER_KEY = process.env.JUPITER_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const RUN_SECRET = process.env.RUN_SECRET || "";
export const TRADING_MODE = (process.env.TRADING_MODE || "paper").toLowerCase();
const LIVE_TRADING_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
const MAX_TRADE_SOL = Math.min(Number(process.env.MAX_TRADE_SOL || "0.002"),0.002);
const MIN_ORGANIC_SCORE = Number(process.env.MIN_ORGANIC_SCORE || "60");
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || "25000");
const MIN_VOLUME_5M_USD = Number(process.env.MIN_VOLUME_5M_USD || "5000");
const MAX_CANDIDATES = Math.min(20, Math.max(4, Number(process.env.MAX_CANDIDATES || "12")));
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth:{persistSession:false,autoRefreshToken:false}
    })
  : null;

const openai = OPENAI_KEY ? new OpenAI({ apiKey:OPENAI_KEY }) : null;

export const AGENT_CONFIG = [
  {
    id:"bull", name:"BULL", color:"blue",
    style:"trend continuation + bullish confirmation",
    mission:"Prefer strong continuation, genuine demand, improving momentum and cleaner market structure. Penalize weak liquidity and obvious overextension.",
    maxTradeSol:Math.min(MAX_TRADE_SOL,0.04)
  },
  {
    id:"degen", name:"DEGEN", color:"orange",
    style:"momentum + volatility + fast trades",
    mission:"Seek fast momentum and expanding activity, but reject obvious low-quality or illiquid traps. Trade smaller when uncertainty is high.",
    maxTradeSol:Math.min(MAX_TRADE_SOL,0.03)
  },
  {
    id:"quant", name:"QUANT", color:"green",
    style:"systematic multi-signal confirmation",
    mission:"Be evidence-first. Prefer higher organic score, sufficient liquidity, broad confirmation and consistent numerical signals. Trade rarely if evidence conflicts.",
    maxTradeSol:Math.min(MAX_TRADE_SOL,0.035)
  },
  {
    id:"bear", name:"BEAR", color:"purple",
    style:"risk-first + reversal detection",
    mission:"Look for fragility, distribution, overextension and downside risk. On spot-only Solana, WAIT is valid when bearish; BUY only when risk/reward is unusually strong.",
    maxTradeSol:Math.min(MAX_TRADE_SOL,0.025)
  }
];

const walletEnv = {
  bull:["AGENT_BULL_WALLET","AGENT_BULL_SECRET_KEY"],
  degen:["AGENT_DEGEN_WALLET","AGENT_DEGEN_SECRET_KEY"],
  quant:["AGENT_QUANT_WALLET","AGENT_QUANT_SECRET_KEY"],
  bear:["AGENT_BEAR_WALLET","AGENT_BEAR_SECRET_KEY"]
};

function jupiterHeaders(){
  const h = { "accept":"application/json" };
  if(JUPITER_KEY) h["x-api-key"] = JUPITER_KEY;
  return h;
}

function heliusUrl(){
  if(!HELIUS_KEY) throw new Error("HELIUS_API_KEY is not configured");
  return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
}

export async function heliusRpc(method,params=[]){
  const res = await fetch(heliusUrl(),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:"the-desk",method,params})
  });
  if(!res.ok) throw new Error("Helius RPC request failed");
  const json = await res.json();
  if(json.error) throw new Error(json.error.message || "Helius RPC error");
  return json.result;
}

export async function getSolBalance(address){
  if(!address) return null;
  const result = await heliusRpc("getBalance",[address,{commitment:"confirmed"}]);
  return Number(result?.value || 0) / 1e9;
}

export async function fetchRecentTransactions(address,limit=8){
  if(!address) return [];
  const sigs = await heliusRpc("getSignaturesForAddress",[address,{limit}]);
  return (sigs||[]).map(x=>({
    signature:x.signature,
    slot:x.slot,
    err:x.err,
    blockTime:x.blockTime,
    confirmationStatus:x.confirmationStatus
  }));
}

function normalizeCandidate(t){
  const liquidity = Number(t.liquidity || t.liquidityUsd || t.liquidityUSD || t.stats24h?.liquidity || 0);
  const volume5m = Number(
    t.stats5m?.buyVolume || t.stats5m?.volume || t.volume5m || t.volume_5m || 0
  );
  const organicScore = Number(t.organicScore ?? t.organic_score ?? 0);
  const price = Number(t.usdPrice ?? t.price ?? t.priceUsd ?? 0);
  const change5m = Number(t.stats5m?.priceChange ?? t.priceChange5m ?? 0);
  const change1h = Number(t.stats1h?.priceChange ?? t.priceChange1h ?? 0);
  const holderCount = Number(t.holderCount ?? t.holders ?? 0);
  return {
    mint:t.id || t.address || t.mint || "",
    symbol:t.symbol || "UNKNOWN",
    name:t.name || t.symbol || "Unknown",
    priceUsd:Number.isFinite(price)?price:0,
    organicScore:Number.isFinite(organicScore)?organicScore:0,
    organicLabel:t.organicScoreLabel || t.organic_score_label || null,
    liquidityUsd:Number.isFinite(liquidity)?liquidity:0,
    volume5mUsd:Number.isFinite(volume5m)?volume5m:0,
    priceChange5m:Number.isFinite(change5m)?change5m:0,
    priceChange1h:Number.isFinite(change1h)?change1h:0,
    holderCount:Number.isFinite(holderCount)?holderCount:0,
    raw:t
  };
}

export async function fetchCandidates(){
  if(!JUPITER_KEY) throw new Error("JUPITER_API_KEY is not configured");
  const res = await fetch("https://api.jup.ag/tokens/v2/toporganicscore/5m",{
    headers:jupiterHeaders(),
    cache:"no-store"
  });
  if(!res.ok) throw new Error(`Jupiter token feed failed (${res.status})`);
  const json = await res.json();
  const arr = Array.isArray(json) ? json : (json.tokens || json.data || []);
  return arr
    .map(normalizeCandidate)
    .filter(t=>t.mint && t.mint!==WSOL_MINT)
    .filter(t=>t.organicScore>=MIN_ORGANIC_SCORE)
    .filter(t=>t.liquidityUsd===0 || t.liquidityUsd>=MIN_LIQUIDITY_USD)
    .filter(t=>t.volume5mUsd===0 || t.volume5mUsd>=MIN_VOLUME_5M_USD)
    .slice(0,MAX_CANDIDATES)
    .map(({raw,...safe})=>safe);
}

function deterministicGuard(candidate){
  let score = 0;
  if(candidate.organicScore >= 80) score += 2;
  else if(candidate.organicScore >= 65) score += 1;
  if(candidate.liquidityUsd >= 100000) score += 2;
  else if(candidate.liquidityUsd >= 25000) score += 1;
  if(candidate.volume5mUsd >= 25000) score += 2;
  else if(candidate.volume5mUsd >= 5000) score += 1;
  if(candidate.priceChange5m > 0 && candidate.priceChange5m < 15) score += 1;
  if(candidate.priceChange5m > 25) score -= 2;
  if(candidate.priceChange1h > 60) score -= 2;
  return score;
}

async function runAgent(agent,candidates){
  if(!openai) throw new Error("OPENAI_API_KEY is not configured");
  const ranked = candidates
    .map(t=>({...t,guardScore:deterministicGuard(t)}))
    .sort((a,b)=>b.guardScore-a.guardScore)
    .slice(0,10);

  const response = await openai.responses.create({
    model:OPENAI_MODEL,
    input:[
      {
        role:"system",
        content:[{type:"input_text",text:`You are ${agent.name}, one of four competing AI traders in THE DESK on Solana.
Style: ${agent.style}.
Mandate: ${agent.mission}
You only receive verified token metrics from Jupiter. Never invent news, social sentiment, token metadata, holders, liquidity, prices, positions, fills or transactions.
You are spot-only. Output BUY or WAIT. The deterministic execution layer may reject your BUY.
This is an experimental agent competition with strict bankroll limits.`}]
      },
      {
        role:"user",
        content:[{type:"input_text",text:JSON.stringify({
          trading_mode:TRADING_MODE,
          max_trade_sol:agent.maxTradeSol,
          candidates:ranked
        })}]
      }
    ],
    text:{format:{
      type:"json_schema",
      name:"solana_agent_decision",
      strict:true,
      schema:{
        type:"object",
        additionalProperties:false,
        properties:{
          decision:{type:"string",enum:["BUY","WAIT"]},
          mint:{type:["string","null"]},
          symbol:{type:["string","null"]},
          confidence:{type:"number",minimum:0,maximum:100},
          amount_sol:{type:"number",minimum:0},
          reasons:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
          risks:{type:"array",items:{type:"string"},minItems:1,maxItems:2},
          comment:{type:"string"}
        },
        required:["decision","mint","symbol","confidence","amount_sol","reasons","risks","comment"]
      }
    }}
  });
  const out = JSON.parse(response.output_text);
  const selected = ranked.find(t=>t.mint===out.mint);
  if(out.decision==="BUY"){
    if(!selected) return {...out,decision:"WAIT",amount_sol:0,comment:"Risk engine rejected an unknown token selection."};
    if(selected.guardScore<2) return {...out,decision:"WAIT",amount_sol:0,comment:"Risk engine rejected the token because deterministic quality gates were not met."};
    out.amount_sol = Math.min(Number(out.amount_sol||0),agent.maxTradeSol,MAX_TRADE_SOL);
    if(out.amount_sol<=0) return {...out,decision:"WAIT",amount_sol:0};
  } else {
    out.amount_sol=0;
    out.mint=null;
    out.symbol=null;
  }
  return out;
}

async function persistEvent(event){
  if(!supabase) return;
  const { error } = await supabase.from("agent_events").insert(event);
  if(error) throw error;
}

async function updateAgentState(agentId,patch){
  if(!supabase) return;
  const { error } = await supabase.from("agents").update({
    ...patch,updated_at:new Date().toISOString()
  }).eq("id",agentId);
  if(error) throw error;
}

export async function getAgentsStatus(){
  let dbRows=[];
  let eventRows=[];
  let positionRows=[];
  if(supabase){
    const [agentsResult,eventsResult,positionsResult]=await Promise.all([
      supabase.from("agents").select("*").order("id"),
      supabase.from("agent_events").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("positions").select("agent_id,status,realized_pnl_sol").order("opened_at",{ascending:false})
    ]);
    if(agentsResult.error) throw agentsResult.error;
    if(eventsResult.error) throw eventsResult.error;
    if(positionsResult.error) throw positionsResult.error;
    dbRows=agentsResult.data||[];
    eventRows=eventsResult.data||[];
    positionRows=positionsResult.data||[];
  }
  const byId=new Map(dbRows.map(x=>[x.id,x]));
  const latestEvent=new Map();
  for(const e of eventRows) if(!latestEvent.has(e.agent_id)) latestEvent.set(e.agent_id,e);
  const openCount=new Map();
  for(const p of positionRows){
    if(p.status==="OPEN") openCount.set(p.agent_id,(openCount.get(p.agent_id)||0)+1);
  }
  const output=[];
  for(const cfg of AGENT_CONFIG){
    const row=byId.get(cfg.id)||{};
    const [walletName] = walletEnv[cfg.id];
    const wallet = row.wallet_address || process.env[walletName] || null;
    let balance=null;
    let recent=[];
    if(wallet && HELIUS_KEY){
      try{
        balance=await getSolBalance(wallet);
        recent=await fetchRecentTransactions(wallet,5);
      }catch{}
    }
    output.push({
      ...cfg,
      wallet,
      balanceSol:balance,
      generation:row.generation ?? 0,
      bankrollSol:Number(row.bankroll_sol||0),
      realizedPnlSol:Number(row.realized_pnl_sol||0),
      unrealizedPnlSol:Number(row.unrealized_pnl_sol||0),
      wins:Number(row.wins||0),
      losses:Number(row.losses||0),
      status:wallet ? (HELIUS_KEY?"ONLINE":"WALLET READY") : "WAITING WALLET",
      openPositions:openCount.get(cfg.id)||0,
      latestEvent:latestEvent.get(cfg.id)||null,
      recentTransactions:recent
    });
  }
  return output;
}

export async function runBullScan({save=true}={}){
  const candidates=await fetchCandidates();
  if(!candidates.length) throw new Error("No candidates passed the current risk filters");
  const agent=AGENT_CONFIG.find(x=>x.id==="bull");
  await updateAgentState("bull",{status:"ANALYZING"});
  const decision=await runAgent(agent,candidates);
  const chosen=decision.mint ? candidates.find(x=>x.mint===decision.mint)||null : null;
  const event={
    agent_id:"bull",
    event_type:decision.decision==="BUY" ? "AI_BUY_DECISION" : "AI_WAIT_DECISION",
    token_mint:decision.mint,
    token_symbol:decision.symbol,
    decision:decision.decision,
    confidence:decision.confidence,
    reason:decision.comment,
    payload:{...decision,candidate:chosen,trading_mode:TRADING_MODE}
  };
  if(save) await persistEvent(event);
  await updateAgentState("bull",{status:decision.decision==="BUY"?"SIGNAL READY":"SCANNING"});
  return {trading_mode:TRADING_MODE,decision:{agent:"bull",...decision,candidate:chosen},created_at:new Date().toISOString()};
}

export async function runDeskScan({save=true}={}){
  const candidates=await fetchCandidates();
  if(!candidates.length) throw new Error("No candidates passed the current risk filters");
  const decisions=[];
  for(const agent of AGENT_CONFIG){
    await updateAgentState(agent.id,{status:"ANALYZING"});
    try{
      const decision=await runAgent(agent,candidates);
      const chosen=decision.mint ? candidates.find(x=>x.mint===decision.mint)||null : null;
      const event={
        agent_id:agent.id,
        event_type:decision.decision==="BUY" ? "AI_BUY_DECISION" : "AI_WAIT_DECISION",
        token_mint:decision.mint,
        token_symbol:decision.symbol,
        decision:decision.decision,
        confidence:decision.confidence,
        reason:decision.comment,
        payload:{...decision,candidate:chosen,trading_mode:TRADING_MODE}
      };
      if(save) await persistEvent(event);
      decisions.push({agent:agent.id,...decision,candidate:chosen});
      await updateAgentState(agent.id,{status:decision.decision==="BUY"?"SIGNAL READY":"SCANNING"});
    }catch(e){
      decisions.push({agent:agent.id,error:e.message});
      await updateAgentState(agent.id,{status:"ERROR"});
    }
  }
  return {trading_mode:TRADING_MODE,candidates,decisions,created_at:new Date().toISOString()};
}

function parseSecret(raw){
  if(!raw) throw new Error("Agent secret key is not configured");
  const s=raw.trim();
  if(s.startsWith("[")) return Uint8Array.from(JSON.parse(s));
  return bs58.decode(s);
}

function signSerializedSolanaTransaction(base64Tx, rawSecret){
  const secret=parseSecret(rawSecret);
  if(secret.length!==64 && secret.length!==32) throw new Error("Agent secret key must decode to 32 or 64 bytes");
  const seed=Buffer.from(secret.slice(0,32));
  const derPrefix=Buffer.from("302e020100300506032b657004220420","hex");
  const privateKey=createPrivateKey({key:Buffer.concat([derPrefix,seed]),format:"der",type:"pkcs8"});

  const tx=Buffer.from(base64Tx,"base64");
  let cursor=0;
  let signatureCount=0;
  let shift=0;
  while(true){
    if(cursor>=tx.length) throw new Error("Invalid Solana transaction encoding");
    const b=tx[cursor++];
    signatureCount|=(b&0x7f)<<shift;
    if((b&0x80)===0) break;
    shift+=7;
    if(shift>21) throw new Error("Invalid Solana signature vector");
  }
  if(signatureCount<1) throw new Error("Jupiter transaction has no signer slot");
  const signaturesStart=cursor;
  const messageStart=signaturesStart+(signatureCount*64);
  if(messageStart>=tx.length) throw new Error("Invalid Solana transaction length");
  const message=tx.subarray(messageStart);
  const signature=cryptoSign(null,message,privateKey);
  if(signature.length!==64) throw new Error("Ed25519 signing failed");
  signature.copy(tx,signaturesStart);
  return tx.toString("base64");
}

function secretForAgent(agentId){
  const pair=walletEnv[agentId];
  if(!pair) throw new Error("Unknown agent");
  return process.env[pair[1]] || "";
}

async function isLiveAgentEnabled(agentId){
  if(agentId==="bull") return true;

  if(supabase){
    const {data}=await supabase.from("system_state")
      .select("key,value")
      .in("key",["multi_agent_live_after","bot_paused"]);
    const state=new Map((data||[]).map(r=>[r.key,r.value]));
    const pausedRaw=state.get("bot_paused");
    const paused=pausedRaw===true || pausedRaw==="true" || pausedRaw?.value===true;
    if(paused) return false;

    const liveAfterRaw=state.get("multi_agent_live_after");
    const liveAfter=typeof liveAfterRaw==="string" ? liveAfterRaw : (liveAfterRaw?.value||null);
    if(liveAfter && Date.now()>=new Date(liveAfter).getTime()) return true;
  }

  const defaultAllowlist=process.env.AUTO_EXECUTION_ENABLED==="true"?"bull":"bull";
  const liveAllowlist=(process.env.LIVE_AGENT_ALLOWLIST||defaultAllowlist)
    .split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return liveAllowlist.includes(agentId);
}

async function getTokenBalanceRaw(owner,mint){
  const result=await heliusRpc("getTokenAccountsByOwner",[
    owner,
    {mint},
    {encoding:"jsonParsed",commitment:"confirmed"}
  ]);
  let total=0n;
  for(const row of result?.value||[]){
    const amount=row?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if(amount!=null) total+=BigInt(amount);
  }
  return total;
}

export async function executeBuy({agentId,mint,amountSol}){
  if(TRADING_MODE!=="live" || !LIVE_TRADING_ENABLED) {
    throw new Error("Live trading is disabled. Set TRADING_MODE=live and LIVE_TRADING_ENABLED=true only after paper testing.");
  }
  const cfg=AGENT_CONFIG.find(x=>x.id===agentId);
  if(!cfg) throw new Error("Unknown agent");
  if(!(await isLiveAgentEnabled(agentId))) throw new Error("Agent is not enabled for live execution yet");
  amountSol=Math.min(Number(amountSol||0),cfg.maxTradeSol,MAX_TRADE_SOL);
  if(!(amountSol>0)) throw new Error("Invalid trade size");
  if(!JUPITER_KEY) throw new Error("JUPITER_API_KEY is not configured");

  const candidates=await fetchCandidates();
  const candidate=candidates.find(x=>x.mint===mint);
  if(!candidate || deterministicGuard(candidate)<2) throw new Error("Token failed current execution risk gates");

  const walletAddress=process.env[walletEnv[agentId][0]] || "";
  if(!walletAddress) throw new Error("Agent wallet address is not configured");
  const rawSecret=secretForAgent(agentId);
  if(!rawSecret) throw new Error("Agent secret key is not configured");
  const amountLamports=Math.floor(amountSol*1e9);
  const orderUrl="https://api.jup.ag/ultra/v1/order?" + new URLSearchParams({
    inputMint:WSOL_MINT,
    outputMint:mint,
    amount:String(amountLamports),
    taker:walletAddress
  });
  const orderRes=await fetch(orderUrl,{headers:jupiterHeaders(),cache:"no-store"});
  const order=await orderRes.json();
  if(!orderRes.ok || !order.transaction || !order.requestId) throw new Error(order.error || "Jupiter order failed");

  const signedTransaction=signSerializedSolanaTransaction(order.transaction,rawSecret);

  const executeRes=await fetch("https://api.jup.ag/ultra/v1/execute",{
    method:"POST",
    headers:{...jupiterHeaders(),"content-type":"application/json"},
    body:JSON.stringify({signedTransaction,requestId:order.requestId})
  });
  const result=await executeRes.json();
  if(!executeRes.ok) throw new Error(result.error || "Jupiter execute failed");

  await persistEvent({
    agent_id:agentId,
    event_type:"BUY_EXECUTED",
    token_mint:mint,
    token_symbol:candidate.symbol,
    decision:"BUY",
    confidence:null,
    reason:"Passed deterministic risk gates and executed through Jupiter.",
    tx_signature:result.signature || result.txid || null,
    payload:{amount_sol:amountSol,jupiter:result,candidate}
  });

  return {
    agent:agentId,
    wallet:walletAddress,
    token:candidate,
    amountSol,
    execution:result
  };
}


export async function executeSell({agentId,mint}){
  if(TRADING_MODE!=="live" || !LIVE_TRADING_ENABLED) {
    throw new Error("Live trading is disabled.");
  }
  const cfg=AGENT_CONFIG.find(x=>x.id===agentId);
  if(!cfg) throw new Error("Unknown agent");
  if(!(await isLiveAgentEnabled(agentId))) throw new Error("Agent is not enabled for live execution yet");
  if(!mint || mint===WSOL_MINT) throw new Error("Invalid token mint");
  if(!JUPITER_KEY) throw new Error("JUPITER_API_KEY is not configured");

  const walletAddress=process.env[walletEnv[agentId][0]] || "";
  if(!walletAddress) throw new Error("Agent wallet address is not configured");
  const rawSecret=secretForAgent(agentId);
  if(!rawSecret) throw new Error("Agent secret key is not configured");

  const rawBalance=await getTokenBalanceRaw(walletAddress,mint);
  if(rawBalance<=0n) throw new Error("No token balance available to sell");

  const orderUrl="https://api.jup.ag/ultra/v1/order?" + new URLSearchParams({
    inputMint:mint,
    outputMint:WSOL_MINT,
    amount:rawBalance.toString(),
    taker:walletAddress
  });
  const orderRes=await fetch(orderUrl,{headers:jupiterHeaders(),cache:"no-store"});
  const order=await orderRes.json();
  if(!orderRes.ok || !order.transaction || !order.requestId) throw new Error(order.error || "Jupiter sell order failed");

  const signedTransaction=signSerializedSolanaTransaction(order.transaction,rawSecret);

  const executeRes=await fetch("https://api.jup.ag/ultra/v1/execute",{
    method:"POST",
    headers:{...jupiterHeaders(),"content-type":"application/json"},
    body:JSON.stringify({signedTransaction,requestId:order.requestId})
  });
  const result=await executeRes.json();
  if(!executeRes.ok) throw new Error(result.error || "Jupiter sell execute failed");

  const signature=result.signature || result.txid || null;
  const outputLamports=Number(result.totalOutputAmount || result.outputAmountResult || 0);
  const outputSol=outputLamports/1e9;

  let symbol=null;
  let realizedPnlSol=null;
  if(supabase){
    const {data:position}=await supabase.from("positions")
      .select("*")
      .eq("agent_id",agentId)
      .eq("token_mint",mint)
      .eq("status","OPEN")
      .order("opened_at",{ascending:false})
      .limit(1)
      .maybeSingle();

    if(position){
      symbol=position.token_symbol||null;
      realizedPnlSol=outputSol-Number(position.cost_sol||0);
      await supabase.from("positions").update({
        status:"CLOSED",
        closed_at:new Date().toISOString(),
        realized_pnl_sol:realizedPnlSol,
        tx_close:signature
      }).eq("id",position.id);

      const {data:agentRow}=await supabase.from("agents").select("realized_pnl_sol,wins,losses").eq("id",agentId).maybeSingle();
      const nextRealized=Number(agentRow?.realized_pnl_sol||0)+realizedPnlSol;
      const win=realizedPnlSol>0;
      await supabase.from("agents").update({
        realized_pnl_sol:nextRealized,
        unrealized_pnl_sol:0,
        wins:Number(agentRow?.wins||0)+(win?1:0),
        losses:Number(agentRow?.losses||0)+(win?0:1),
        updated_at:new Date().toISOString()
      }).eq("id",agentId);
    }
  }

  await persistEvent({
    agent_id:agentId,
    event_type:"SELL_EXECUTED",
    token_mint:mint,
    token_symbol:symbol,
    decision:"SELL",
    confidence:null,
    reason:"User-confirmed live exit executed through Jupiter.",
    tx_signature:signature,
    payload:{
      input_amount_raw:rawBalance.toString(),
      output_sol:outputSol,
      realized_pnl_sol:realizedPnlSol,
      jupiter:result
    }
  });

  return {
    agent:agentId,
    wallet:walletAddress,
    mint,
    soldRaw:rawBalance.toString(),
    outputSol,
    realizedPnlSol,
    execution:result
  };
}
