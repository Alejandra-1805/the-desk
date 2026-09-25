const required=[
  "SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","HELIUS_API_KEY","JUPITER_API_KEY",
  "OPENAI_API_KEY","RUN_SECRET","CRON_SECRET",
  "AGENT_BULL_WALLET","AGENT_BULL_SECRET_KEY",
  "AGENT_DEGEN_WALLET","AGENT_DEGEN_SECRET_KEY",
  "AGENT_QUANT_WALLET","AGENT_QUANT_SECRET_KEY",
  "AGENT_BEAR_WALLET","AGENT_BEAR_SECRET_KEY"
];
const launchOnly=["PROJECT_TOKEN_MINT","CREATOR_FEE_WALLET","HELIUS_WEBHOOK_SECRET"];

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  const missing=required.filter(k=>!process.env[k]);
  const launchMissing=launchOnly.filter(k=>!process.env[k]);
  const mode=(process.env.TRADING_MODE||"paper").toLowerCase();
  return res.status(200).json({
    ok:true,
    infrastructure_ready:missing.length===0,
    paper_ready:missing.filter(k=>k.includes("WALLET")||k.includes("SECRET_KEY")).length===0 || missing.length===0,
    live_mode:mode==="live" && process.env.LIVE_TRADING_ENABLED==="true",
    launch_ready:missing.length===0 && launchMissing.length===0,
    current_mode:mode,
    live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
    max_trade_sol:Math.min(Number(process.env.MAX_TRADE_SOL||"0.002"),0.002),
    live_agent_allowlist:(process.env.LIVE_AGENT_ALLOWLIST||"bull").split(",").map(x=>x.trim()).filter(Boolean),
    missing,
    launch_missing:launchMissing,
    next:"Set PROJECT_TOKEN_MINT, CREATOR_FEE_WALLET and HELIUS_WEBHOOK_SECRET only after the token/fee wallet exists."
  });
}