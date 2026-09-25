import { createClient } from "@supabase/supabase-js";

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
    const [{data:agents,error:aerr},{data:events,error:eerr}] = await Promise.all([
      supabase.from("agents").select("*"),
      supabase.from("agent_events").select("*").order("created_at",{ascending:false}).limit(100)
    ]);
    if(aerr) throw aerr;
    if(eerr) throw eerr;
    const latest=new Map();
    for(const e of events||[]) if(!latest.has(e.agent_id)) latest.set(e.agent_id,e);
    const byId=new Map((agents||[]).map(x=>[x.id,x]));
    const data=configs.map(c=>{
      const row=byId.get(c.id)||{};
      const wallet=row.wallet_address||process.env["AGENT_"+c.id.toUpperCase()+"_WALLET"]||null;
      return {
        ...c,
        wallet,
        balanceSol:null,
        generation:Number(row.generation||0),
        bankrollSol:Number(row.bankroll_sol||0),
        realizedPnlSol:Number(row.realized_pnl_sol||0),
        unrealizedPnlSol:Number(row.unrealized_pnl_sol||0),
        wins:Number(row.wins||0),
        losses:Number(row.losses||0),
        status:wallet?"WALLET READY":"WAITING WALLET",
        openPositions:0,
        latestEvent:latest.get(c.id)||null,
        recentTransactions:[]
      };
    });
    return res.status(200).json({ok:true,data});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Agent status failed"});
  }
}