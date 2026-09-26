import { isAddress } from "ethers";

const UNI="https://trade-api.gateway.uniswap.org/v1";
const DEX="https://api.dexscreener.com";

function uniHeaders(){
  return {
    "x-api-key":process.env.UNISWAP_API_KEY||"",
    "accept":"application/json",
    "x-agent-info":JSON.stringify({decision_origin:"autonomous",integration_name:"Muse Agents",version:"1.0"})
  };
}

async function getJson(url,headers={}){
  const r=await fetch(url,{headers,cache:"no-store"});
  const j=await r.json();
  if(!r.ok) throw new Error(`${url} failed (${r.status}): ${j?.detail||j?.error||"request failed"}`);
  return j;
}

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function bestPair(pairs=[]){
  return [...pairs].filter(p=>String(p.chainId||"").toLowerCase()==="robinhood")
    .sort((a,b)=>n(b?.liquidity?.usd)-n(a?.liquidity?.usd))[0]||null;
}
function normalize(token,pair){
  const tx5=pair?.txns?.m5||{};
  const tx1h=pair?.txns?.h1||{};
  const buys5=n(tx5.buys), sells5=n(tx5.sells);
  const buys1h=n(tx1h.buys), sells1h=n(tx1h.sells);
  const created=n(pair?.pairCreatedAt);
  return {
    address:token.address,
    symbol:token.symbol||pair?.baseToken?.symbol||"UNKNOWN",
    name:token.name||pair?.baseToken?.name||"Unknown",
    decimals:n(token.decimals)||18,
    safetyLevel:token?.extensions?.safetyInfo?.safetyLevel||null,
    safetyDescription:token?.extensions?.safetyInfo?.safetyDescription||null,
    buyFee:n(token?.extensions?.safetyInfo?.buyFee),
    sellFee:n(token?.extensions?.safetyInfo?.sellFee),
    pairAddress:pair?.pairAddress||null,
    dexId:pair?.dexId||null,
    priceUsd:n(pair?.priceUsd),
    liquidityUsd:n(pair?.liquidity?.usd),
    volume5mUsd:n(pair?.volume?.m5),
    volume1hUsd:n(pair?.volume?.h1),
    volume24hUsd:n(pair?.volume?.h24),
    priceChange5m:n(pair?.priceChange?.m5),
    priceChange1h:n(pair?.priceChange?.h1),
    priceChange6h:n(pair?.priceChange?.h6),
    priceChange24h:n(pair?.priceChange?.h24),
    buys5m:buys5,sells5m:sells5,
    buys1h:buys1h,sells1h:sells1h,
    buySellRatio5m:sells5>0?buys5/sells5:(buys5>0?99:0),
    buySellRatio1h:sells1h>0?buys1h/sells1h:(buys1h>0?99:0),
    pairAgeMinutes:created?Math.max(0,(Date.now()-created)/60000):null,
    url:pair?.url||null
  };
}

export async function fetchRobinhoodUniverse(limit=40){
  if(!process.env.UNISWAP_API_KEY) throw new Error("UNISWAP_API_KEY is not configured");
  const u=new URL(UNI+"/tokens");
  u.searchParams.set("sort","volume_24h");
  u.searchParams.set("limit",String(Math.min(100,Math.max(10,limit))));
  u.searchParams.set("chainId","4663");
  const j=await getJson(u.toString(),uniHeaders());
  const tokens=(j.tokens||[]).filter(t=>Number(t.chainId)===4663 && isAddress(t.address));
  if(!tokens.length) return [];

  const byAddress=new Map(tokens.map(t=>[t.address.toLowerCase(),t]));
  const addresses=tokens.map(t=>t.address);
  const pairs=[];
  for(let i=0;i<addresses.length;i+=30){
    const chunk=addresses.slice(i,i+30).join(",");
    try{
      const batch=await getJson(`${DEX}/tokens/v1/robinhood/${chunk}`);
      if(Array.isArray(batch)) pairs.push(...batch);
    }catch{}
  }

  const pairMap=new Map();
  for(const p of pairs){
    const base=p?.baseToken?.address?.toLowerCase();
    const quote=p?.quoteToken?.address?.toLowerCase();
    for(const addr of [base,quote]){
      if(!addr||!byAddress.has(addr)) continue;
      if(!pairMap.has(addr)) pairMap.set(addr,[]);
      pairMap.get(addr).push(p);
    }
  }

  return tokens.map(t=>normalize(t,bestPair(pairMap.get(t.address.toLowerCase())||[])))
    .filter(t=>t.priceUsd>0 && t.liquidityUsd>0)
    .sort((a,b)=>b.volume24hUsd-a.volume24hUsd);
}

export async function fetchEthUsd(){
  try{
    const j=await getJson(DEX+"/latest/dex/search?q=WETH");
    const pairs=(j.pairs||[]).filter(p=>
      String(p.chainId||"").toLowerCase()==="robinhood" &&
      ["WETH","ETH"].includes(String(p?.baseToken?.symbol||"").toUpperCase()) &&
      ["USDC","USDT","USD"].includes(String(p?.quoteToken?.symbol||"").toUpperCase()) &&
      n(p.priceUsd)>0
    ).sort((a,b)=>n(b?.liquidity?.usd)-n(a?.liquidity?.usd));
    if(pairs[0]) return n(pairs[0].priceUsd);
  }catch{}
  return null;
}

export function riskScore(t){
  let s=0;
  if(t.liquidityUsd>=250000) s+=3; else if(t.liquidityUsd>=50000) s+=2; else if(t.liquidityUsd>=10000) s+=1;
  if(t.volume1hUsd>=100000) s+=3; else if(t.volume1hUsd>=20000) s+=2; else if(t.volume1hUsd>=3000) s+=1;
  if(t.buys1h+t.sells1h>=100) s+=2; else if(t.buys1h+t.sells1h>=20) s+=1;
  if(t.buySellRatio1h>1.15 && t.buySellRatio1h<5) s+=1;
  if(t.priceChange5m>40 || t.priceChange1h>120) s-=3;
  if(t.sellFee>5 || t.buyFee>5) s-=4;
  if(t.pairAgeMinutes!=null && t.pairAgeMinutes<10) s-=3;
  return s;
}

export async function scanRobinhoodOpportunities({limit=16}={}){
  const universe=await fetchRobinhoodUniverse(60);
  const safe=universe
    .map(t=>({...t,riskScore:riskScore(t)}))
    .filter(t=>t.liquidityUsd>=5000)
    .filter(t=>t.buyFee<=5 && t.sellFee<=5)
    .filter(t=>t.riskScore>=2)
    .sort((a,b)=>(b.riskScore-a.riskScore)||(b.volume1hUsd-a.volume1hUsd))
    .slice(0,Math.min(24,Math.max(4,limit)));
  return {source:"Uniswap token rankings + DEX Screener market metrics",chainId:4663,candidates:safe,scanned:universe.length,createdAt:new Date().toISOString()};
}
