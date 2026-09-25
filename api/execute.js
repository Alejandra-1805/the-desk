export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const mod=await import("../lib/solana-core.js");
    const supplied=req.headers["x-run-secret"]||req.query.secret||"";
    if(!mod.RUN_SECRET || supplied!==mod.RUN_SECRET){
      return res.status(401).json({ok:false,error:"Unauthorized"});
    }
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    const data=await mod.executeBuy({
      agentId:body.agent_id,
      mint:body.mint,
      amountSol:body.amount_sol
    });
    return res.status(200).json({ok:true,data});
  }catch(e){
    return res.status(500).json({
      ok:false,
      error:e?.message||"Execute failed",
      name:e?.name||null,
      stage:"execute"
    });
  }
}