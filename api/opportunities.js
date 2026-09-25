function headers(){
  const h={accept:"application/json"};
  if(process.env.JUPITER_API_KEY) h["x-api-key"]=process.env.JUPITER_API_KEY;
  return h;
}
function normalize(t){
  const liquidity=Number(t.liquidity||t.liquidityUsd||t.liquidityUSD||t.stats24h?.liquidity||0);
  const volume5m=Number(t.stats5m?.buyVolume||t.stats5m?.volume||t.volume5m||t.volume_5m||0);
  const organicScore=Number(t.organicScore??t.organic_score??0);
  const price=Number(t.usdPrice??t.price??t.priceUsd??0);
  const change5m=Number(t.stats5m?.priceChange??t.priceChange5m??0);
  const change1h=Number(t.stats1h?.priceChange??t.priceChange1h??0);
  return {
    mint:t.id||t.address||t.mint||"",
    symbol:t.symbol||"UNKNOWN",
    name:t.name||t.symbol||"Unknown",
    priceUsd:Number.isFinite(price)?price:0,
    organicScore:Number.isFinite(organicScore)?organicScore:0,
    organicLabel:t.organicScoreLabel||t.organic_score_label||null,
    liquidityUsd:Number.isFinite(liquidity)?liquidity:0,
    volume5mUsd:Number.isFinite(volume5m)?volume5m:0,
    priceChange5m:Number.isFinite(change5m)?change5m:0,
    priceChange1h:Number.isFinite(change1h)?change1h:0
  };
}

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    if(!process.env.JUPITER_API_KEY) return res.status(503).json({ok:false,error:"JUPITER_API_KEY is not configured"});
    const r=await fetch("https://api.jup.ag/tokens/v2/toporganicscore/5m",{
      headers:headers(),
      cache:"no-store"
    });
    const text=await r.text();
    if(!r.ok) return res.status(r.status).json({ok:false,error:"Jupiter token feed failed",provider_status:r.status,provider_body:text.slice(0,500)});
    let json;
    try{json=JSON.parse(text);}catch{return res.status(502).json({ok:false,error:"Jupiter returned non-JSON",provider_body:text.slice(0,500)});}
    const arr=Array.isArray(json)?json:(json.tokens||json.data||[]);
    const data=arr.map(normalize).filter(x=>x.mint).slice(0,20);
    return res.status(200).json({ok:true,count:data.length,data});
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"Opportunities request failed"});
  }
}