async function rpc(method,params=[]){
  const key=process.env.HELIUS_API_KEY||"";
  if(!key) throw new Error("HELIUS_API_KEY is not configured");
  const r=await fetch("https://mainnet.helius-rpc.com/?api-key="+encodeURIComponent(key),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:"wallet-check",method,params})
  });
  const j=await r.json();
  if(!r.ok||j.error) throw new Error(j.error?.message||"Helius RPC failed");
  return j.result;
}

const defs=[
  ["bull","BULL","AGENT_BULL_WALLET"],
  ["degen","DEGEN","AGENT_DEGEN_WALLET"],
  ["quant","QUANT","AGENT_QUANT_WALLET"],
  ["bear","BEAR","AGENT_BEAR_WALLET"]
];

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const data=[];
    for(const [id,name,key] of defs){
      const address=process.env[key]||null;
      let balanceSol=null;
      if(address){
        const result=await rpc("getBalance",[address,{commitment:"confirmed"}]);
        balanceSol=Number(result?.value||0)/1e9;
      }
      data.push({id,name,address,balanceSol});
    }
    return res.status(200).json({
      ok:true,
      trading_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
      live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
      max_trade_sol:Math.min(Number(process.env.MAX_TRADE_SOL||"0.002"),0.002),
      live_agent_allowlist:(process.env.LIVE_AGENT_ALLOWLIST||"bull").split(",").map(x=>x.trim()).filter(Boolean),
      data
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Wallet check failed"});
  }
}