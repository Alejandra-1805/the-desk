import express from "express";
import cors from "cors";
import pg from "pg";
import OpenAI from "openai";

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "256kb" }));

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({ origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN }));

const PORT = Number(process.env.PORT || 3000);
const MARKET_KEY = process.env.TWELVE_DATA_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const RUN_SECRET = process.env.RUN_SECRET || "";
const WATCHLIST = (process.env.WATCHLIST || "AAPL,TSLA,NVDA,META")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } })
  : null;

const openai = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

const AGENTS = [
  {
    id: "bull",
    name: "BULL",
    color: "blue",
    mission: "Look for upside, trend continuation, improving momentum and bullish catalysts. Do not ignore risks."
  },
  {
    id: "degen",
    name: "DEGEN",
    color: "orange",
    mission: "Focus on short-term momentum, velocity, abnormal volume, volatility expansion and fast asymmetric setups."
  },
  {
    id: "quant",
    name: "QUANT",
    color: "green",
    mission: "Be evidence-first and numerical. Prioritize indicator alignment, probability, signal quality and contradictions."
  },
  {
    id: "bear",
    name: "BEAR",
    color: "purple",
    mission: "Look for downside, overextension, weak structure, reversal risk and evidence that invalidates bullish narratives."
  }
];

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS desk_runs (
      id BIGSERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      reference_price NUMERIC NOT NULL,
      market_timestamp TIMESTAMPTZ NOT NULL,
      consensus TEXT NOT NULL,
      consensus_confidence NUMERIC NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_calls (
      id BIGSERIAL PRIMARY KEY,
      desk_run_id BIGINT NOT NULL REFERENCES desk_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      bias TEXT NOT NULL,
      confidence NUMERIC NOT NULL,
      reasons JSONB NOT NULL,
      risks JSONB NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS call_results (
      id BIGSERIAL PRIMARY KEY,
      desk_run_id BIGINT NOT NULL REFERENCES desk_runs(id) ON DELETE CASCADE,
      horizon TEXT NOT NULL,
      observed_price NUMERIC,
      return_pct NUMERIC,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      observed_at TIMESTAMPTZ,
      UNIQUE(desk_run_id, horizon)
    );
    CREATE INDEX IF NOT EXISTS idx_desk_runs_ticker_created ON desk_runs(ticker, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_calls_agent ON agent_calls(agent_id, created_at DESC);
  `);
}

function sma(values, n) {
  if (values.length < n) return null;
  return values.slice(-n).reduce((a,b)=>a+b,0) / n;
}
function calcRsi(values, n=14) {
  if (values.length < n+1) return null;
  let gains=0, losses=0;
  for (let i=values.length-n; i<values.length; i++) {
    const d = values[i] - values[i-1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs=(gains/n)/(losses/n);
  return 100-(100/(1+rs));
}
function calcVol(values, n=20) {
  if (values.length < n+1) return null;
  const rets=[];
  for (let i=values.length-n; i<values.length; i++) rets.push((values[i]-values[i-1])/values[i-1]);
  const mean=rets.reduce((a,b)=>a+b,0)/rets.length;
  const variance=rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
  return Math.sqrt(variance)*Math.sqrt(252)*100;
}
function pct(a,b){ return ((a/b)-1)*100; }

async function fetchMarket(ticker) {
  if (!MARKET_KEY) throw new Error("TWELVE_DATA_API_KEY is not configured");
  const qs = new URLSearchParams({ symbol:ticker, interval:"1day", outputsize:"120", apikey:MARKET_KEY, format:"JSON" });
  const [seriesRes, quoteRes] = await Promise.all([
    fetch("https://api.twelvedata.com/time_series?" + qs.toString()),
    fetch("https://api.twelvedata.com/quote?" + new URLSearchParams({ symbol:ticker, apikey:MARKET_KEY }).toString())
  ]);
  if (!seriesRes.ok || !quoteRes.ok) throw new Error("Market data provider request failed");
  const series = await seriesRes.json();
  const quote = await quoteRes.json();
  if (series.status === "error") throw new Error(series.message || "Time series unavailable");
  if (quote.status === "error") throw new Error(quote.message || "Quote unavailable");

  const rows = (series.values || []).slice().reverse();
  if (rows.length < 55) throw new Error("Not enough market history");
  const closes = rows.map(r => Number(r.close)).filter(Number.isFinite);
  const latest = rows.at(-1);
  const price = Number(quote.close || quote.price || latest.close);
  const prevClose = Number(quote.previous_close || rows.at(-2).close);
  const high20 = Math.max(...rows.slice(-20).map(r=>Number(r.high)));
  const low20 = Math.min(...rows.slice(-20).map(r=>Number(r.low)));
  const volume = Number(quote.volume || latest.volume || 0);
  const avgVolume20 = rows.slice(-20).map(r=>Number(r.volume||0)).reduce((a,b)=>a+b,0)/20;

  return {
    ticker,
    timestamp: quote.datetime || latest.datetime || new Date().toISOString(),
    price,
    open: Number(quote.open || latest.open),
    high: Number(quote.high || latest.high),
    low: Number(quote.low || latest.low),
    previousClose: prevClose,
    changePct: pct(price, prevClose),
    volume,
    avgVolume20,
    volumeVsAvgPct: avgVolume20 ? pct(volume, avgVolume20) : null,
    sma20: sma(closes,20),
    sma50: sma(closes,50),
    rsi14: calcRsi(closes,14),
    volatility20: calcVol(closes,20),
    momentum5: pct(price, closes.at(-6)),
    momentum20: pct(price, closes.at(-21)),
    distanceHigh20Pct: pct(price, high20),
    distanceLow20Pct: pct(price, low20),
    candles: rows.slice(-60).map(r => ({
      datetime:r.datetime, open:Number(r.open), high:Number(r.high),
      low:Number(r.low), close:Number(r.close), volume:Number(r.volume||0)
    }))
  };
}

function deterministicQuant(snapshot) {
  let score=0;
  score += snapshot.changePct > 0 ? 1 : -1;
  score += snapshot.price > snapshot.sma20 ? 1 : -1;
  score += snapshot.price > snapshot.sma50 ? 1 : -1;
  if (snapshot.rsi14 >= 55 && snapshot.rsi14 <= 72) score += 1;
  if (snapshot.rsi14 > 76) score -= 1;
  if (snapshot.rsi14 < 34) score += 1;
  if (snapshot.momentum5 > 0) score += 1; else score -= 1;
  if (snapshot.volatility20 > 75) score -= 1;
  const bias = score >= 3 ? "LONG" : score <= -3 ? "SHORT" : "WAIT";
  const confidence = Math.max(50, Math.min(88, 50 + Math.abs(score)*6));
  return { bias, confidence, score };
}

async function runAgent(agent, snapshot) {
  const quant = deterministicQuant(snapshot);
  if (agent.id === "quant" && !openai) {
    return {
      agent_id:agent.id, agent_name:agent.name, bias:quant.bias, confidence:quant.confidence,
      reasons:["Deterministic signal engine used because AI is not configured."],
      risks:["AI narrative unavailable until OPENAI_API_KEY is configured."],
      comment:"Signal engine ready; AI layer waiting for configuration."
    };
  }
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");

  const input = {
    ticker:snapshot.ticker,
    price:snapshot.price,
    change_pct:snapshot.changePct,
    volume:snapshot.volume,
    volume_vs_avg_pct:snapshot.volumeVsAvgPct,
    sma20:snapshot.sma20,
    sma50:snapshot.sma50,
    rsi14:snapshot.rsi14,
    volatility20:snapshot.volatility20,
    momentum_5d:snapshot.momentum5,
    momentum_20d:snapshot.momentum20,
    distance_high20_pct:snapshot.distanceHigh20Pct,
    distance_low20_pct:snapshot.distanceLow20Pct,
    deterministic_signal:quant
  };

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role:"system",
        content:[{type:"input_text",text:`You are ${agent.name}, one of four competing market agents in THE DESK. ${agent.mission}
You receive verified numeric market data. Never invent prices, news, fundamentals, trades, fills, or events not present in the input.
Return only a structured market opinion. This is analysis, not execution.`}]
      },
      { role:"user", content:[{type:"input_text",text:JSON.stringify(input)}] }
    ],
    text: {
      format: {
        type:"json_schema",
        name:"agent_call",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          properties:{
            bias:{type:"string",enum:["LONG","SHORT","WAIT"]},
            confidence:{type:"number",minimum:0,maximum:100},
            reasons:{type:"array",items:{type:"string"},minItems:2,maxItems:3},
            risks:{type:"array",items:{type:"string"},minItems:1,maxItems:2},
            comment:{type:"string"}
          },
          required:["bias","confidence","reasons","risks","comment"]
        }
      }
    }
  });
  const parsed = JSON.parse(response.output_text);
  return { agent_id:agent.id, agent_name:agent.name, ...parsed };
}

function consensus(calls) {
  const score = calls.reduce((sum,c)=>{
    const d = c.bias==="LONG" ? 1 : c.bias==="SHORT" ? -1 : 0;
    return sum + d*(Number(c.confidence)||0);
  },0);
  const denom = calls.reduce((sum,c)=>sum+(Number(c.confidence)||0),0) || 1;
  const normalized = score/denom;
  const label = normalized > 0.18 ? "LONG" : normalized < -0.18 ? "SHORT" : "WAIT";
  return { label, confidence:Math.round(Math.abs(normalized)*100) };
}

async function analyzeTicker(ticker, save=true) {
  const snapshot = await fetchMarket(ticker);
  const calls = [];
  for (const agent of AGENTS) calls.push(await runAgent(agent,snapshot));
  const desk = consensus(calls);

  let runId = null;
  if (save && pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const run = await client.query(
        `INSERT INTO desk_runs(ticker,reference_price,market_timestamp,consensus,consensus_confidence,snapshot)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ticker,snapshot.price,new Date(snapshot.timestamp),desk.label,desk.confidence,snapshot]
      );
      runId = run.rows[0].id;
      for (const c of calls) {
        await client.query(
          `INSERT INTO agent_calls(desk_run_id,agent_id,agent_name,bias,confidence,reasons,risks,comment)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [runId,c.agent_id,c.agent_name,c.bias,c.confidence,JSON.stringify(c.reasons),JSON.stringify(c.risks),c.comment]
        );
      }
      for (const horizon of ["1H","1D","1W"]) {
        await client.query(`INSERT INTO call_results(desk_run_id,horizon) VALUES($1,$2) ON CONFLICT DO NOTHING`,[runId,horizon]);
      }
      await client.query("COMMIT");
    } catch(e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  }
  return { run_id:runId, snapshot, agents:calls, desk_consensus:desk };
}

function requireRunSecret(req,res,next) {
  if (!RUN_SECRET) return res.status(503).json({ok:false,error:"RUN_SECRET not configured"});
  const supplied = req.get("x-run-secret") || req.query.secret;
  if (supplied !== RUN_SECRET) return res.status(401).json({ok:false,error:"Unauthorized"});
  next();
}

app.get("/health", async (_req,res) => {
  let db=false;
  if (pool) { try { await pool.query("SELECT 1"); db=true; } catch {} }
  res.json({
    ok:true,
    service:"the-desk-api",
    market_data_configured:Boolean(MARKET_KEY),
    ai_configured:Boolean(OPENAI_KEY),
    database_configured:Boolean(pool),
    database_reachable:db,
    watchlist:WATCHLIST
  });
});

app.get("/api/agents", (_req,res) => res.json({ok:true,agents:AGENTS.map(({mission,...a})=>a)}));

app.get("/api/market/:ticker", async (req,res) => {
  try {
    const ticker=req.params.ticker.toUpperCase();
    if (!WATCHLIST.includes(ticker)) return res.status(400).json({ok:false,error:"Ticker not in watchlist"});
    res.json({ok:true,data:await fetchMarket(ticker)});
  } catch(e) { res.status(503).json({ok:false,error:e.message}); }
});

app.post("/api/run/:ticker", requireRunSecret, async (req,res) => {
  try {
    const ticker=req.params.ticker.toUpperCase();
    if (!WATCHLIST.includes(ticker)) return res.status(400).json({ok:false,error:"Ticker not in watchlist"});
    res.json({ok:true,data:await analyzeTicker(ticker,true)});
  } catch(e) { res.status(503).json({ok:false,error:e.message}); }
});

app.get("/api/latest/:ticker", async (req,res) => {
  if (!pool) return res.status(503).json({ok:false,error:"Database not configured"});
  const ticker=req.params.ticker.toUpperCase();
  const q = await pool.query(`
    SELECT dr.*, COALESCE(json_agg(json_build_object(
      'agent_id',ac.agent_id,'agent_name',ac.agent_name,'bias',ac.bias,'confidence',ac.confidence,
      'reasons',ac.reasons,'risks',ac.risks,'comment',ac.comment
    ) ORDER BY ac.id) FILTER (WHERE ac.id IS NOT NULL),'[]') AS agents
    FROM desk_runs dr LEFT JOIN agent_calls ac ON ac.desk_run_id=dr.id
    WHERE dr.ticker=$1 GROUP BY dr.id ORDER BY dr.created_at DESC LIMIT 1`, [ticker]);
  if (!q.rows.length) return res.json({ok:true,data:null});
  res.json({ok:true,data:q.rows[0]});
});

app.get("/api/leaderboard", async (_req,res) => {
  if (!pool) return res.status(503).json({ok:false,error:"Database not configured"});
  const q = await pool.query(`
    SELECT ac.agent_id, ac.agent_name,
      COUNT(*)::int AS calls,
      COUNT(cr.id) FILTER (WHERE cr.resolved)::int AS resolved,
      ROUND(AVG(CASE
        WHEN cr.resolved AND ac.bias='LONG' AND cr.return_pct>0 THEN 1
        WHEN cr.resolved AND ac.bias='SHORT' AND cr.return_pct<0 THEN 1
        WHEN cr.resolved AND ac.bias='WAIT' AND ABS(cr.return_pct)<1 THEN 1
        WHEN cr.resolved THEN 0
      END)*100,1) AS accuracy_pct
    FROM agent_calls ac
    LEFT JOIN call_results cr ON cr.desk_run_id=ac.desk_run_id AND cr.horizon='1D'
    GROUP BY ac.agent_id,ac.agent_name ORDER BY accuracy_pct DESC NULLS LAST, calls DESC`);
  res.json({ok:true,data:q.rows});
});

app.get("/api/watchlist", (_req,res)=>res.json({ok:true,data:WATCHLIST}));

await initDb();
app.listen(PORT, ()=>console.log(`THE DESK API listening on ${PORT}`));

export { analyzeTicker, WATCHLIST, initDb };
