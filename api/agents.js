import { createClient } from "@supabase/supabase-js";

async function heliusBalance(address){
  const key=process.env.HELIUS_API_KEY||"";
  if(!key||!address) return null;
  const r=await fetch("https://mainnet.helius-rpc.com/?api-key="+encodeURIComponent(key),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:"agents",method:"getBalance",params:[address,{commitment:"confirmed"}]})
  });
  const j=await r.json();
  if(!r.ok||j.error) return null;
  return Number(j.result?.value||0)/1e9;
}

const configs=[
  {id:"bull",name:"BULL",color:"blue",style:"trend continuation + bullish confirmation"},
  {id:"degen",name:"DEGEN",color:"orange",style:"momentum + volatility + fast trades"},
  {id:"quant",name:"QUANT",color:"green",style:"systematic multi-signal confirmation"},
  {id:"bear",name:"BEAR",color:"purple",style:"risk-first + reversal detection"}
];

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const url=process.env.SUPABASE_URL||"";
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
    if(!url||!key) return res.status(503).json({ok:false,error:"Supabase is not configured"});
    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const [{data:agents,error:aerr},{data:events,error:eerr},{data:txEvents,error:txerr},{data:positions,error:perr},{data:livePositions,error:lperr}] = await Promise.all([
      supabase.from("agents").select("*"),
      supabase.from("agent_events").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("agent_events")
        .select("agent_id,event_type,token_mint,token_symbol,decision,tx_signature,created_at")
        .not("tx_signature","is",null)
        .order("created_at",{ascending:false})
        .limit(100),
      supabase.from("paper_positions").select("*").order("opened_at",{ascending:false}),
      supabase.from("positions").select("*").order("opened_at",{ascending:false})
    ]);
    if(aerr) throw aerr;
    if(eerr) throw eerr;
    if(txerr) throw txerr;
    if(perr) throw perr;
    if(lperr) throw lperr;
    const latest=new Map();
    const txByAgent=new Map();
    for(const e of events||[]) if(!latest.has(e.agent_id)) latest.set(e.agent_id,e);
    for(const e of txEvents||[]){
      if(!txByAgent.has(e.agent_id)) txByAgent.set(e.agent_id,[]);
      txByAgent.get(e.agent_id).push({
        signature:e.tx_signature,
        err:null,
        confirmationStatus:"confirmed",
        eventType:e.event_type,
        decision:e.decision,
        tokenSymbol:e.token_symbol,
        tokenMint:e.token_mint,
        createdAt:e.created_at
      });
    }
    const byId=new Map((agents||[]).map(x=>[x.id,x]));
    const byAgentPositions=new Map();
    for(const p of positions||[]){
      if(!byAgentPositions.has(p.agent_id)) byAgentPositions.set(p.agent_id,[]);
      byAgentPositions.get(p.agent_id).push(p);
    }
    const liveByAgent=new Map();
    for(const p of livePositions||[]){
      if(!liveByAgent.has(p.agent_id)) liveByAgent.set(p.agent_id,[]);
      liveByAgent.get(p.agent_id).push(p);
    }
    const data=await Promise.all(configs.map(async c=>{
      const row=byId.get(c.id)||{};
      const wallet=row.wallet_address||process.env["AGENT_"+c.id.toUpperCase()+"_WALLET"]||null;
      const ps=byAgentPositions.get(c.id)||[];
      const open=ps.filter(p=>p.status==="OPEN");
      const closed=ps.filter(p=>p.status==="CLOSED");
      const realizedPct=closed.reduce((s,p)=>s+Number(p.realized_pct||0),0);
      const unrealizedPct=open.reduce((s,p)=>s+Number(p.unrealized_pct||0),0);
      const balanceSol=await heliusBalance(wallet);
      const livePs=liveByAgent.get(c.id)||[];
      const liveOpen=livePs.filter(p=>p.status==="OPEN");
      const liveClosed=livePs.filter(p=>p.status==="CLOSED");
      const lastTx=(txByAgent.get(c.id)||[])[0]||null;
      const liveRealizedSol=liveClosed.reduce((s,p)=>s+Number(p.realized_pnl_sol||0),0);
      return {
        ...c,
        wallet,
        balanceSol,
        generation:Number(row.generation||0),
        bankrollSol:Number(row.bankroll_sol||0),
        realizedPnlSol:Number(row.realized_pnl_sol||0),
        unrealizedPnlSol:Number(row.unrealized_pnl_sol||0),
        paperRealizedPct:Number(realizedPct.toFixed(4)),
        paperUnrealizedPct:Number(unrealizedPct.toFixed(4)),
        paperScorePct:Number((realizedPct+unrealizedPct).toFixed(4)),
        wins:closed.filter(p=>Number(p.realized_pct||0)>0).length,
        losses:closed.filter(p=>Number(p.realized_pct||0)<=0).length,
        status:liveOpen.length?"LIVE POSITION":(wallet?"WALLET READY":"PAPER READY"),
        openPositions:liveOpen.length,
        paperOpenPositions:open.length,
        liveRealizedPnlSol:Number(liveRealizedSol.toFixed(8)),
        latestPosition:liveOpen[0]||livePs[0]||null,
        latestEvent:latest.get(c.id)||null,
        latestExecution:lastTx,
        recentTransactions:(txByAgent.get(c.id)||[]).slice(0,8)
      };
    }));
    return res.status(200).json({ok:true,data});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Agent status failed"});
  }
}