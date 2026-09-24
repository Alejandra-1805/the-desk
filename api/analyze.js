import { runDesk } from "../lib/desk-core.js";
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const expected=process.env.RUN_SECRET||"";
  const supplied=req.headers["x-run-secret"]||req.query.secret||"";
  if(!expected || supplied!==expected) return res.status(401).json({ok:false,error:"Unauthorized"});
  try{ res.status(200).json({ok:true,data:await runDesk(req.query.ticker,{save:true})}); }
  catch(e){ res.status(503).json({ok:false,error:e.message}); }
}