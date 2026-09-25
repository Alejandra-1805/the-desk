import { RUN_SECRET, runDeskScan } from "../lib/solana-core.js";
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const supplied=req.headers["x-run-secret"]||req.query.secret||"";
  if(!RUN_SECRET || supplied!==RUN_SECRET) return res.status(401).json({ok:false,error:"Unauthorized"});
  try{res.status(200).json({ok:true,data:await runDeskScan({save:true})});}
  catch(e){res.status(503).json({ok:false,error:e.message});}
}