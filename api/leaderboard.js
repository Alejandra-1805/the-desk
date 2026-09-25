import { supabase } from "../lib/solana-core.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  if(!supabase) return res.status(503).json({ok:false,error:"Supabase is not configured"});
  try{
    const { data,error }=await supabase.from("agents").select("*");
    if(error) throw error;
    const ranked=(data||[]).map(a=>({
      id:a.id,
      name:a.name,
      color:a.color,
      generation:Number(a.generation||0),
      bankrollSol:Number(a.bankroll_sol||0),
      realizedPnlSol:Number(a.realized_pnl_sol||0),
      unrealizedPnlSol:Number(a.unrealized_pnl_sol||0),
      totalPnlSol:Number(a.realized_pnl_sol||0)+Number(a.unrealized_pnl_sol||0),
      wins:Number(a.wins||0),
      losses:Number(a.losses||0),
      status:a.status,
      wallet:a.wallet_address
    })).sort((a,b)=>b.totalPnlSol-a.totalPnlSol || b.wins-a.wins);
    res.status(200).json({ok:true,data:ranked});
  }catch(e){
    res.status(503).json({ok:false,error:e.message});
  }
}