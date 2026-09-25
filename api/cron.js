import { runDeskScan } from "../lib/solana-core.js";
export default async function handler(req,res){
  const bearer=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const secret=process.env.CRON_SECRET||"";
  if(!secret || bearer!==secret) return res.status(401).json({ok:false,error:"Unauthorized"});
  try{res.status(200).json({ok:true,data:await runDeskScan({save:true})});}
  catch(e){res.status(503).json({ok:false,error:e.message});}
}