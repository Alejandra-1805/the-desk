import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const JUPITER_KEY=process.env.JUPITER_API_KEY||"";
const supabase=SUPABASE_URL&&SUPABASE_KEY?createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;

const RULES={
  bull:{tp:15,sl:-8,maxHours:6},
  degen:{tp:12,sl:-7,maxHours:2},
  quant:{tp:10,sl:-5,maxHours:8},
  bear:{tp:8,sl:-4,maxHours:4}
};

async function prices(mints){
  if(!JUPITER_KEY||!mints.length) return {};
  const r=await fetch("https://api.jup.ag/price/v3?ids="+encodeURIComponent(mints.join(",")),{
    headers:{accept:"application/json","x-api-key":JUPITER_KEY},
    cache:"no-store"
  });
  if(!r.ok) throw new Error("Jupiter Price API failed ("+r.status+")");
  const j=await r.json();
  return j.data||j;
}

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}

export async function syncLivePositions(){
  if(!supabase) throw new Error("Supabase is not configured");

  const {data:buys,error:buyErr}=await supabase
    .from("agent_events")
    .select("id,agent_id,token_mint,token_symbol,tx_signature,payload,created_at,reference_price_usd")
    .eq("event_type","BUY_EXECUTED")
    .not("tx_signature","is",null)
    .order("created_at",{ascending:false})
    .limit(100);
  if(buyErr) throw buyErr;

  let created=0;
  for(const e of buys||[]){
    const {data:existing,error:exErr}=await supabase.from("positions").select("id").eq("tx_open",e.tx_signature).maybeSingle();
    if(exErr) throw exErr;
    if(existing) continue;

    const candidate=e.payload?.candidate||{};
    const execution=e.payload?.jupiter||{};
    const entry=num(e.reference_price_usd)??num(candidate.priceUsd)??num(candidate.price)??null;
    const cost=num(e.payload?.amount_sol)??0;
    const qtyRaw=execution.totalOutputAmount||execution.outputAmountResult||null;

    const {error:insErr}=await supabase.from("positions").insert({
      agent_id:e.agent_id,
      token_mint:e.token_mint,
      token_symbol:e.token_symbol,
      entry_price_usd:entry,
      current_price_usd:entry,
      quantity:qtyRaw?Number(qtyRaw):null,
      cost_sol:cost,
      status:"OPEN",
      opened_at:e.created_at,
      tx_open:e.tx_signature
    });
    if(insErr) throw insErr;
    created++;
  }
  return {created};
}

export async function monitorLivePositions(){
  if(!supabase) throw new Error("Supabase is not configured");
  await syncLivePositions();

  const {data:positions,error}=await supabase.from("positions").select("*").eq("status","OPEN").order("opened_at");
  if(error) throw error;
  if(!positions?.length) return {open:0,updated:0,sell_signals:0,positions:[]};

  const mintList=[...new Set(positions.map(p=>p.token_mint).filter(Boolean))];
  const px=await prices(mintList);
  const now=Date.now();
  const out=[];
  let sellSignals=0;

  for(const p of positions){
    const current=num(px[p.token_mint]?.usdPrice??px[p.token_mint]?.price);
    const entry=num(p.entry_price_usd);
    if(!(current>0)||!(entry>0)){
      out.push({id:p.id,agent:p.agent_id,symbol:p.token_symbol,status:"PRICE_UNAVAILABLE"});
      continue;
    }

    const pnlPct=((current/entry)-1)*100;
    const cost=num(p.cost_sol)||0;
    const approxPnlSol=cost*(pnlPct/100);
    const rule=RULES[p.agent_id]||{tp:10,sl:-6,maxHours:6};
    const hours=(now-new Date(p.opened_at).getTime())/3600000;
    let exitReason=null;
    if(pnlPct>=rule.tp) exitReason="TAKE_PROFIT";
    else if(pnlPct<=rule.sl) exitReason="STOP_LOSS";
    else if(hours>=rule.maxHours) exitReason="MAX_HOLD";

    const {error:uErr}=await supabase.from("positions").update({current_price_usd:current}).eq("id",p.id);
    if(uErr) throw uErr;
    await supabase.from("agents").update({unrealized_pnl_sol:approxPnlSol,updated_at:new Date().toISOString()}).eq("id",p.agent_id);

    if(exitReason){
      const {data:buyEvent,error:beErr}=await supabase
        .from("agent_events")
        .select("id")
        .eq("tx_signature",p.tx_open)
        .eq("event_type","BUY_EXECUTED")
        .maybeSingle();
      if(beErr) throw beErr;

      const {error:intErr}=await supabase.from("trade_intents").upsert({
        agent_id:p.agent_id,
        action:"SELL",
        token_mint:p.token_mint,
        token_symbol:p.token_symbol,
        amount_sol:null,
        reason:exitReason,
        confidence:null,
        source_event_id:buyEvent?.id||null,
        payload:{
          position_id:p.id,
          entry_price_usd:entry,
          current_price_usd:current,
          pnl_pct:pnlPct,
          approx_pnl_sol:approxPnlSol,
          exit_reason:exitReason,
          source:"live-monitor"
        },
        expires_at:new Date(now+10*60*1000).toISOString()
      },{onConflict:"agent_id,action,source_event_id",ignoreDuplicates:true});
      if(intErr) throw intErr;
      sellSignals++;
    }

    out.push({
      id:p.id,agent:p.agent_id,symbol:p.token_symbol,
      entry,current,pnl_pct:Number(pnlPct.toFixed(4)),
      approx_pnl_sol:Number(approxPnlSol.toFixed(8)),
      exit_reason:exitReason
    });
  }

  return {open:positions.length,updated:out.length,sell_signals:sellSignals,positions:out};
}
