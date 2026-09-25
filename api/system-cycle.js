import { createClient } from "@supabase/supabase-js";
import { markPaperPositions } from "../lib/paper-mark.js";
import { paperScan } from "../lib/paper-core.js";

async function schedulerSecret(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return "";
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data}=await supabase.from("system_state").select("value").eq("key","scheduler_secret").maybeSingle();
  const v=data?.value;
  return typeof v==="string"?v:(v?.value||"");
}

export default async function handler(req,res){
  const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const envSecret=process.env.CRON_SECRET||"";
  const dbSecret=await schedulerSecret();
  if(!supplied || (supplied!==envSecret && supplied!==dbSecret)){
    return res.status(401).json({ok:false,error:"Unauthorized"});
  }
  try{
    const mode=(process.env.TRADING_MODE||"paper").toLowerCase();
    let marked=null;
    try{marked=await markPaperPositions();}catch(e){marked={ok:false,error:e?.message||"Mark skipped"};}
    let scanned=null;
    if(mode==="paper"){
      try{scanned=await paperScan();}
      catch(e){scanned={ok:false,error:e?.message||"Scan skipped"};}
    }
    return res.status(200).json({ok:true,mode,marked,scanned});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"System cycle failed"});
  }
}