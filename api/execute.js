import { RUN_SECRET, executeBuy } from "../lib/solana-core.js";
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const supplied=req.headers["x-run-secret"]||req.query.secret||"";
  if(!RUN_SECRET || supplied!==RUN_SECRET) return res.status(401).json({ok:false,error:"Unauthorized"});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
    res.status(200).json({ok:true,data:await executeBuy({
      agentId:body.agent_id,
      mint:body.mint,
      amountSol:body.amount_sol
    })});
  }catch(e){res.status(503).json({ok:false,error:e.message});}
}