import { createClient } from "@supabase/supabase-js";

const WSOL="So11111111111111111111111111111111111111112";

async function solUsd(){
  const key=process.env.JUPITER_API_KEY||"";
  if(!key) return null;
  const r=await fetch("https://api.jup.ag/price/v3?ids="+WSOL,{headers:{accept:"application/json","x-api-key":key},cache:"no-store"});
  if(!r.ok) return null;
  const j=await r.json();
  const d=(j.data||j)[WSOL];
  const p=Number(d?.usdPrice??d?.price??0);
  return p>0?p:null;
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const expected=process.env.HELIUS_WEBHOOK_SECRET||"";
  const supplied=String(req.query.secret||"");
  if(!expected || supplied!==expected) return res.status(401).json({ok:false,error:"Unauthorized"});

  const feeWallet=process.env.CREATOR_FEE_WALLET||"";
  if(!feeWallet) return res.status(503).json({ok:false,error:"CREATOR_FEE_WALLET is not configured"});
  const url=process.env.SUPABASE_URL||"", key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) return res.status(503).json({ok:false,error:"Supabase is not configured"});
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const payload=Array.isArray(req.body)?req.body:[req.body];
    const px=await solUsd();
    let inserted=0, totalSol=0, totalUsd=0;

    for(const tx of payload){
      if(!tx) continue;
      const signature=tx.signature||tx.transactionSignature||tx?.transaction?.signatures?.[0]||null;
      const transfers=Array.isArray(tx.nativeTransfers)?tx.nativeTransfers:[];
      const incoming=transfers.filter(t=>t?.toUserAccount===feeWallet);
      const lamports=incoming.reduce((s,t)=>s+Number(t.amount||0),0);
      if(!(lamports>0)||!signature) continue;
      const amountSol=lamports/1e9;
      const amountUsd=px?amountSol*px:null;
      const {error}=await supabase.from("creator_fee_events").upsert({
        source_wallet:incoming[0]?.fromUserAccount||null,
        source_tx_signature:signature,
        fee_wallet:feeWallet,
        token_mint:process.env.PROJECT_TOKEN_MINT||null,
        amount_sol:amountSol,
        amount_usd:amountUsd,
        processed:false,
        payload:tx,
        received_at:new Date().toISOString()
      },{onConflict:"source_tx_signature",ignoreDuplicates:true});
      if(error) throw error;
      inserted++; totalSol+=amountSol; totalUsd+=Number(amountUsd||0);
    }

    return res.status(200).json({ok:true,inserted,total_sol:Number(totalSol.toFixed(9)),total_usd:Number(totalUsd.toFixed(4))});
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Fee webhook failed"});
  }
}