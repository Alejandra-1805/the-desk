import { markPaperPositions } from "../lib/paper-mark.js";
import { paperScan } from "../lib/paper-core.js";

export default async function handler(req,res){
  const secret=process.env.CRON_SECRET||"";
  const auth=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!secret || auth!==secret) return res.status(401).json({ok:false,error:"Unauthorized"});
  try{
    const marked=await markPaperPositions();
    let scanned=null;
    if((process.env.TRADING_MODE||"paper").toLowerCase()==="paper"){
      try{ scanned=await paperScan(); }
      catch(e){ scanned={ok:false,error:e?.message||"Scan skipped"}; }
    }
    return res.status(200).json({ok:true,mode:(process.env.TRADING_MODE||"paper").toLowerCase(),marked,scanned});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"System cycle failed"});
  }
}