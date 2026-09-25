import { runBullScan } from "../lib/solana-core.js";

const WSOL="So11111111111111111111111111111111111111112";

async function balance(address){
  const key=process.env.HELIUS_API_KEY||"";
  if(!key) throw new Error("HELIUS_API_KEY missing");
  const r=await fetch("https://mainnet.helius-rpc.com/?api-key="+encodeURIComponent(key),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:"preflight",method:"getBalance",params:[address,{commitment:"confirmed"}]})
  });
  const j=await r.json();
  if(!r.ok||j.error) throw new Error(j.error?.message||"Helius balance failed");
  return Number(j.result?.value||0)/1e9;
}

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const wallet=process.env.AGENT_BULL_WALLET||"";
    if(!wallet) throw new Error("BULL wallet missing");
    const bal=await balance(wallet);

    const scan=await runBullScan({save:true});
    const d=scan?.decision||{};
    if(d.error) throw new Error(d.error);
    if(d.decision!=="BUY" || !d.mint){
      return res.status(200).json({
        ok:true,
        mode:"PREVIEW_ONLY",
        live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
        trading_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
        agent:"bull",
        wallet,
        balance_sol:bal,
        decision:"WAIT",
        confidence:d.confidence??null,
        reason:d.comment||"BULL found no current candidate worth buying.",
        route_ready:false,
        note:"Fresh BULL scan completed. No transaction was signed or sent."
      });
    }

    const amountSol=Math.min(0.002,Math.max(0,Number(process.env.MAX_TRADE_SOL||"0.002")));
    const amountLamports=Math.floor(amountSol*1e9);
    const key=process.env.JUPITER_API_KEY||"";
    if(!key) throw new Error("JUPITER_API_KEY missing");
    const url="https://api.jup.ag/ultra/v1/order?"+new URLSearchParams({
      inputMint:WSOL,
      outputMint:d.mint,
      amount:String(amountLamports),
      taker:wallet
    });
    const r=await fetch(url,{headers:{accept:"application/json","x-api-key":key},cache:"no-store"});
    const text=await r.text();
    let order={};
    try{order=JSON.parse(text);}catch{}
    if(!r.ok) throw new Error("Jupiter order preflight failed ("+r.status+"): "+text.slice(0,300));

    return res.status(200).json({
      ok:true,
      mode:"PREVIEW_ONLY",
      live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
      trading_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
      agent:"bull",
      wallet,
      balance_sol:bal,
      decision:"BUY",
      confidence:d.confidence??null,
      reason:d.comment||null,
      intended_amount_sol:amountSol,
      token:{symbol:d.symbol,mint:d.mint},
      route_ready:Boolean(order.transaction&&order.requestId),
      estimated_output:order.outAmount||order.outputAmount||null,
      price_impact_pct:order.priceImpactPct??null,
      request_id_present:Boolean(order.requestId),
      transaction_present:Boolean(order.transaction),
      note:"Fresh BULL scan + Jupiter route. No transaction was signed or sent."
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Preflight failed"});
  }
}