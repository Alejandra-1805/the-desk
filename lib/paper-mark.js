import { createClient } from "@supabase/supabase-js";

const JUPITER_KEY=process.env.JUPITER_API_KEY||"";
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const supabase=SUPABASE_URL&&SUPABASE_KEY?createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;

const RULES={
  bull:{tp:15,sl:-8,maxHours:6},
  degen:{tp:12,sl:-7,maxHours:2},
  quant:{tp:10,sl:-5,maxHours:8},
  bear:{tp:8,sl:-4,maxHours:4}
};

async function fetchPrices(mints){
  if(!JUPITER_KEY) throw new Error("JUPITER_API_KEY is not configured");
  const r=await fetch("https://api.jup.ag/price/v3?ids="+encodeURIComponent(mints.join(",")),{
    headers:{accept:"application/json","x-api-key":JUPITER_KEY},
    cache:"no-store"
  });
  const text=await r.text();
  if(!r.ok) throw new Error("Jupiter Price API failed ("+r.status+"): "+text.slice(0,250));
  const json=JSON.parse(text);
  return json.data||json;
}

export async function markPaperPositions(){
  if(!supabase) throw new Error("Supabase is not configured");
  const {data:positions,error}=await supabase.from("paper_positions").select("*").eq("status","OPEN").order("opened_at");
  if(error) throw error;
  if(!positions?.length) return {open:0,updated:0,closed:0,positions:[]};

  const mints=[...new Set(positions.map(p=>p.token_mint))];
  const prices=await fetchPrices(mints);
  const now=new Date();
  const out=[];

  for(const p of positions){
    const priceObj=prices[p.token_mint];
    const current=Number(priceObj?.usdPrice??priceObj?.price??0);
    if(!(current>0)){
      out.push({id:p.id,agent:p.agent_id,symbol:p.token_symbol,updated:false,reason:"PRICE_UNAVAILABLE"});
      continue;
    }
    const entry=Number(p.entry_price_usd);
    const pnl=((current/entry)-1)*100;
    const hours=(now-new Date(p.opened_at))/3600000;
    const rule=RULES[p.agent_id]||{tp:10,sl:-6,maxHours:6};
    let status="OPEN",exitReason=null;
    if(pnl>=rule.tp){status="CLOSED";exitReason="TAKE_PROFIT";}
    else if(pnl<=rule.sl){status="CLOSED";exitReason="STOP_LOSS";}
    else if(hours>=rule.maxHours){status="CLOSED";exitReason="MAX_HOLD";}

    const patch={
      current_price_usd:current,
      unrealized_pct:status==="OPEN"?pnl:null,
      realized_pct:status==="CLOSED"?pnl:null,
      status,
      exit_reason:exitReason,
      last_marked_at:now.toISOString(),
      ...(status==="CLOSED"?{closed_at:now.toISOString()}:{})
    };
    const {error:updateError}=await supabase.from("paper_positions").update(patch).eq("id",p.id);
    if(updateError) throw updateError;

    if(status==="CLOSED"){
      const won=pnl>0;
      const {data:a,error:aerr}=await supabase.from("agents").select("wins,losses").eq("id",p.agent_id).single();
      if(aerr) throw aerr;
      await supabase.from("agents").update({
        wins:Number(a.wins||0)+(won?1:0),
        losses:Number(a.losses||0)+(won?0:1),
        status:"SCANNING",
        updated_at:now.toISOString()
      }).eq("id",p.agent_id);
      await supabase.from("agent_events").insert({
        agent_id:p.agent_id,
        event_type:"PAPER_POSITION_CLOSED",
        token_mint:p.token_mint,
        token_symbol:p.token_symbol,
        decision:"CLOSE",
        confidence:null,
        reason:exitReason,
        reference_price_usd:current,
        payload:{entry_price_usd:entry,exit_price_usd:current,pnl_pct:pnl,exit_reason:exitReason,mode:"paper"}
      });
    }

    out.push({id:p.id,agent:p.agent_id,symbol:p.token_symbol,entry,current,pnl_pct:Number(pnl.toFixed(4)),status,exit_reason:exitReason});
  }

  return {
    open:out.filter(x=>x.status==="OPEN").length,
    updated:out.filter(x=>x.updated!==false).length,
    closed:out.filter(x=>x.status==="CLOSED").length,
    positions:out
  };
}
