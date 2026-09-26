import { getChainStatus } from "../lib/evm-core.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  let chain=null;
  try{
    if(process.env.ALCHEMY_RPC_URL) chain=await getChainStatus();
  }catch{}
  return res.status(200).json({
    ok:true,
    service:"muse-agents-robinhood",
    chain:"robinhood",
    chain_id:4663,
    trading_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
    live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
    alchemy_configured:Boolean(process.env.ALCHEMY_RPC_URL),
    ai_configured:Boolean(process.env.OPENAI_API_KEY),
    database_configured:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    wallets_configured:4,
    chain_status:chain,
    version:"robinhood-v1.0.0"
  });
}