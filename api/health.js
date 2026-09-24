import { WATCHLIST, supabase } from "../lib/desk-core.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  res.status(200).json({
    ok:true,
    service:"the-desk-vercel-api",
    market_data_configured:Boolean(process.env.TWELVE_DATA_API_KEY),
    ai_configured:Boolean(process.env.OPENAI_API_KEY),
    database_configured:Boolean(supabase),
    watchlist:WATCHLIST
  });
}