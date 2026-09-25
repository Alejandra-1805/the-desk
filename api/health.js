import { TRADING_MODE, supabase, getAgentsStatus } from "../lib/solana-core.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  let agents=[];
  try{agents=await getAgentsStatus();}catch{}
  res.status(200).json({
    ok:true,
    service:"the-desk-solana",
    trading_mode:TRADING_MODE,
    helius_configured:Boolean(process.env.HELIUS_API_KEY),
    jupiter_configured:Boolean(process.env.JUPITER_API_KEY),
    ai_configured:Boolean(process.env.OPENAI_API_KEY),
    database_configured:Boolean(supabase),
    wallets_configured:agents.filter(x=>x.wallet).length
  });
}