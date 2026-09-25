import { createClient } from "@supabase/supabase-js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  const url=process.env.SUPABASE_URL||"", key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return res.status(503).json({ok:false,error:"Supabase is not configured"});
  try{
    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const [{data:agents,error:aerr},{data:positions,error:perr}]=await Promise.all([
      supabase.from("agents").select("*"),
      supabase.from("paper_positions").select("*")
    ]);
    if(aerr) throw aerr;
    if(perr) throw perr;
    const ranked=(agents||[]).map(a=>{
      const ps=(positions||[]).filter(p=>p.agent_id===a.id);
      const open=ps.filter(p=>p.status==="OPEN");
      const closed=ps.filter(p=>p.status==="CLOSED");
      const realized=closed.reduce((s,p)=>s+Number(p.realized_pct||0),0);
      const unrealized=open.reduce((s,p)=>s+Number(p.unrealized_pct||0),0);
      const wins=closed.filter(p=>Number(p.realized_pct||0)>0).length;
      const losses=closed.filter(p=>Number(p.realized_pct||0)<=0).length;
      return {
        id:a.id,name:a.name,color:a.color,generation:Number(a.generation||0),
        wallet:a.wallet_address,status:a.status,
        openPositions:open.length,closedPositions:closed.length,
        wins,losses,
        accuracyPct:(wins+losses)?Number((wins/(wins+losses)*100).toFixed(1)):null,
        realizedPct:Number(realized.toFixed(4)),
        unrealizedPct:Number(unrealized.toFixed(4)),
        scorePct:Number((realized+unrealized).toFixed(4))
      };
    }).sort((a,b)=>b.scorePct-a.scorePct||b.wins-a.wins);
    return res.status(200).json({ok:true,mode:"paper",data:ranked});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Leaderboard failed"});
  }
}