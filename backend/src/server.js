import express from "express";
import cors from "cors";
import {
  AGENTS, WATCHLIST, MARKET_KEY, OPENAI_KEY, RUN_SECRET, pool,
  initDb, fetchMarket, analyzeTicker
} from "./core.js";

const app=express();
const PORT=Number(process.env.PORT||3000);
const FRONTEND_ORIGIN=process.env.FRONTEND_ORIGIN||"*";

app.use(express.json({limit:"256kb"}));
app.use(cors({origin:FRONTEND_ORIGIN==="*" ? true : FRONTEND_ORIGIN}));

function requireRunSecret(req,res,next){
  if(!RUN_SECRET) return res.status(503).json({ok:false,error:"RUN_SECRET not configured"});
  const supplied=req.get("x-run-secret")||req.query.secret;
  if(supplied!==RUN_SECRET) return res.status(401).json({ok:false,error:"Unauthorized"});
  next();
}

app.get("/health",async(_req,res)=>{
  let db=false;
  if(pool){try{await pool.query("SELECT 1");db=true}catch{}}
  res.json({
    ok:true,service:"the-desk-api",
    market_data_configured:Boolean(MARKET_KEY),
    ai_configured:Boolean(OPENAI_KEY),
    database_configured:Boolean(pool),
    database_reachable:db,
    watchlist:WATCHLIST
  });
});

app.get("/api/agents",(_req,res)=>res.json({
  ok:true,
  agents:AGENTS.map(({mission,...a})=>a)
}));

app.get("/api/watchlist",(_req,res)=>res.json({ok:true,data:WATCHLIST}));

app.get("/api/market/:ticker",async(req,res)=>{
  try{
    const ticker=req.params.ticker.toUpperCase();
    if(!WATCHLIST.includes(ticker)) return res.status(400).json({ok:false,error:"Ticker not in watchlist"});
    res.json({ok:true,data:await fetchMarket(ticker)});
  }catch(e){res.status(503).json({ok:false,error:e.message})}
});

app.post("/api/run/:ticker",requireRunSecret,async(req,res)=>{
  try{
    const ticker=req.params.ticker.toUpperCase();
    if(!WATCHLIST.includes(ticker)) return res.status(400).json({ok:false,error:"Ticker not in watchlist"});
    res.json({ok:true,data:await analyzeTicker(ticker,{save:true})});
  }catch(e){res.status(503).json({ok:false,error:e.message})}
});

app.get("/api/latest/:ticker",async(req,res)=>{
  if(!pool) return res.status(503).json({ok:false,error:"Database not configured"});
  const ticker=req.params.ticker.toUpperCase();
  const q=await pool.query(`
    SELECT dr.*, COALESCE(json_agg(json_build_object(
      'agent_id',ac.agent_id,'agent_name',ac.agent_name,'bias',ac.bias,'confidence',ac.confidence,
      'reasons',ac.reasons,'risks',ac.risks,'comment',ac.comment
    ) ORDER BY ac.id) FILTER (WHERE ac.id IS NOT NULL),'[]') AS agents
    FROM desk_runs dr
    LEFT JOIN agent_calls ac ON ac.desk_run_id=dr.id
    WHERE dr.ticker=$1
    GROUP BY dr.id
    ORDER BY dr.created_at DESC
    LIMIT 1
  `,[ticker]);
  res.json({ok:true,data:q.rows[0]||null});
});

app.get("/api/leaderboard",async(_req,res)=>{
  if(!pool) return res.status(503).json({ok:false,error:"Database not configured"});
  const q=await pool.query(`
    SELECT ac.agent_id,ac.agent_name,
      COUNT(*)::int AS calls,
      COUNT(cr.id) FILTER(WHERE cr.resolved)::int AS resolved,
      ROUND(AVG(CASE
        WHEN cr.resolved AND ac.bias='LONG' AND cr.return_pct>0 THEN 1
        WHEN cr.resolved AND ac.bias='SHORT' AND cr.return_pct<0 THEN 1
        WHEN cr.resolved AND ac.bias='WAIT' AND ABS(cr.return_pct)<1 THEN 1
        WHEN cr.resolved THEN 0 END)*100,1) AS accuracy_pct
    FROM agent_calls ac
    LEFT JOIN call_results cr ON cr.desk_run_id=ac.desk_run_id AND cr.horizon='1D'
    GROUP BY ac.agent_id,ac.agent_name
    ORDER BY accuracy_pct DESC NULLS LAST,calls DESC
  `);
  res.json({ok:true,data:q.rows});
});

await initDb();
app.listen(PORT,()=>console.log(`THE DESK API listening on ${PORT}`));
