import { createClient } from "@supabase/supabase-js";

function db(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) throw new Error("Supabase not configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}

async function pricesFor(addresses){
  const out=new Map();
  for(let i=0;i<addresses.length;i+=30){
    const chunk=addresses.slice(i,i+30).join(",");
    const r=await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${chunk}`,{cache:"no-store"});
    if(!r.ok) continue;
    const pairs=await r.json();
    for(const p of Array.isArray(pairs)?pairs:[]){
      const addr=p?.baseToken?.address?.toLowerCase();
      if(!addr) continue;
      const price=n(p.priceUsd),liq=n(p?.liquidity?.usd);
      if(price<=0) continue;
      const prev=out.get(addr);
      if(!prev||liq>prev.liquidityUsd) out.set(addr,{priceUsd:price,liquidityUsd:liq});
    }
  }
  return out;
}

export async function markRobinhoodPositions(){
  const supabase=db();
  const {data:rows,error}=await supabase.from("positions").select("*")
    .eq("status","OPEN").eq("chain_id",4663);
  if(error) throw error;
  const positions=(rows||[]).filter(p=>/^0x[a-fA-F0-9]{40}$/.test(String(p.token_mint||"")));
  if(!positions.length) return {ok:true,marked:0,positions:[]};

  const priceMap=await pricesFor([...new Set(positions.map(p=>p.token_mint.toLowerCase()))]);
  const result=[];
  const agentPnl=new Map();
  for(const p of positions){
    const m=priceMap.get(p.token_mint.toLowerCase());
    if(!m) continue;
    const qty=n(p.quantity);
    const currentValueUsd=qty*m.priceUsd;
    const entryValueUsd=n(p.entry_value_usd)||(n(p.entry_price_usd)*qty);
    const unrealizedUsd=entryValueUsd?currentValueUsd-entryValueUsd:null;
    const unrealizedPct=entryValueUsd?((currentValueUsd-entryValueUsd)/entryValueUsd)*100:null;
    const metadata={...(p.metadata||{}),unrealized_usd:unrealizedUsd,unrealized_pct:unrealizedPct,last_liquidity_usd:m.liquidityUsd,last_marked_at:new Date().toISOString()};
    const {error:uErr}=await supabase.from("positions").update({
      current_price_usd:m.priceUsd,current_value_usd:currentValueUsd,metadata
    }).eq("id",p.id);
    if(uErr) throw uErr;
    agentPnl.set(p.agent_id,(agentPnl.get(p.agent_id)||0)+(unrealizedUsd||0));
    result.push({id:p.id,agent:p.agent_id,token:p.token_mint,priceUsd:m.priceUsd,currentValueUsd,unrealizedUsd,unrealizedPct});
  }
  for(const [agentId,pnlUsd] of agentPnl){
    await supabase.from("agents").update({unrealized_pnl_eth:0,updated_at:new Date().toISOString()}).eq("id",agentId);
    await supabase.from("agent_events").insert({
      agent_id:agentId,event_type:"EVM_POSITION_MARK",decision:"HOLD",chain_id:4663,
      payload:{unrealized_pnl_usd:pnlUsd,positions:result.filter(x=>x.agent===agentId)}
    });
  }
  return {ok:true,marked:result.length,positions:result};
}
