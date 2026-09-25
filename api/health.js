export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  return res.status(200).json({
    ok:true,
    service:"market-agents-solana",
    trading_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
    live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
    helius_configured:Boolean(process.env.HELIUS_API_KEY),
    jupiter_configured:Boolean(process.env.JUPITER_API_KEY),
    ai_configured:Boolean(process.env.OPENAI_API_KEY),
    database_configured:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    wallets_configured:[
      process.env.AGENT_BULL_WALLET,
      process.env.AGENT_DEGEN_WALLET,
      process.env.AGENT_QUANT_WALLET,
      process.env.AGENT_BEAR_WALLET
    ].filter(Boolean).length,
    version:"solana-v0.7.1"
  });
}