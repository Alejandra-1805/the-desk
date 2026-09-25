import { createClient } from "@supabase/supabase-js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const required=[
      "SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","HELIUS_API_KEY","JUPITER_API_KEY",
      "OPENAI_API_KEY","RUN_SECRET","CRON_SECRET",
      "AGENT_BULL_WALLET","AGENT_BULL_SECRET_KEY",
      "AGENT_DEGEN_WALLET","AGENT_DEGEN_SECRET_KEY",
      "AGENT_QUANT_WALLET","AGENT_QUANT_SECRET_KEY",
      "AGENT_BEAR_WALLET","AGENT_BEAR_SECRET_KEY"
    ];
    const missing=required.filter(k=>!process.env[k]);
    let feeWallet=process.env.CREATOR_FEE_WALLET||null;
    let projectMint=process.env.PROJECT_TOKEN_MINT||null;
    if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
      const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await supabase.from("system_state").select("key,value").in("key",["creator_fee_wallet","project_token_mint"]);
      for(const row of data||[]){
        if(row.key==="creator_fee_wallet"&&!feeWallet) feeWallet=typeof row.value==="string"?row.value:row.value?.value||row.value;
        if(row.key==="project_token_mint"&&!projectMint) projectMint=typeof row.value==="string"?row.value:row.value?.value||row.value;
      }
    }
    const launchMissing=[];
    if(!projectMint) launchMissing.push("PROJECT_TOKEN_MINT");
    if(!feeWallet) launchMissing.push("CREATOR_FEE_WALLET");
    if(!process.env.HELIUS_WEBHOOK_SECRET) launchMissing.push("HELIUS_WEBHOOK_SECRET");

    return res.status(200).json({
      ok:true,
      infrastructure_ready:missing.length===0,
      current_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
      live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
      max_trade_sol:Math.min(Number(process.env.MAX_TRADE_SOL||"0.002"),0.002),
      live_agent_allowlist:(process.env.LIVE_AGENT_ALLOWLIST||"bull").split(",").map(x=>x.trim()).filter(Boolean),
      fee_wallet_configured:Boolean(feeWallet),
      fee_wallet:feeWallet,
      project_token_configured:Boolean(projectMint),
      launch_ready:missing.length===0&&launchMissing.length===0,
      missing,
      launch_missing:launchMissing
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Readiness check failed"});
  }
}