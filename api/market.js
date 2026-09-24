import { fetchMarket } from "../lib/desk-core.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{ res.status(200).json({ok:true,data:await fetchMarket(req.query.ticker)}); }
  catch(e){ res.status(503).json({ok:false,error:e.message}); }
}