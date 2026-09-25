import { createClient } from "@supabase/supabase-js";

async function ensureHeliusWebhook({feeWallet,authSecret}){
  const apiKey=process.env.HELIUS_API_KEY||"";
  if(!apiKey||!feeWallet||!authSecret) return {configured:false};
  const webhookURL="https://the-desk-zeta-liart.vercel.app/api/helius-fees";
  const endpoint="https://api.helius.xyz/v0/webhooks?api-key="+encodeURIComponent(apiKey);
  try{
    const listRes=await fetch(endpoint,{headers:{accept:"application/json"},cache:"no-store"});
    const listJson=listRes.ok?await listRes.json():[];
    const rows=Array.isArray(listJson)?listJson:(listJson?.data||listJson?.webhooks||[]);
    const existing=(rows||[]).find(w=>{
      const addresses=w.accountAddresses||w.account_addresses||[];
      const url=w.webhookURL||w.webhookUrl||w.webhook_url||"";
      return url===webhookURL && addresses.includes(feeWallet);
    });
    if(existing) return {configured:true,created:false};
    const createRes=await fetch(endpoint,{
      method:"POST",
      headers:{"content-type":"application/json",accept:"application/json"},
      body:JSON.stringify({
        webhookURL,
        transactionTypes:["ANY"],
        accountAddresses:[feeWallet],
        webhookType:"enhanced",
        authHeader:authSecret
      })
    });
    return {configured:createRes.ok,created:createRes.ok};
  }catch{return {configured:false,created:false};}
}


export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const required=[
      "SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","HELIUS_API_KEY","JUPITER_API_KEY",
      "OPENAI_API_KEY","RUN_SECRET","CRON_SECRET",
      "AGENT_BULL_WALLET","AGENT_BULL_SECRET_KEY",
      "AGENT_DEGEN_WALLET","AGENT_DEGEN_SECRET_KEY",
      "AGENT_QUANT_WALLET","AGENT_QUANT_SECRET_KEY",
      "AGENT_BEAR_WALLET","AGENT_BEAR_SECRET_KEY"
    ];
    const missing=required.filter(k=>!process.env[k]);
    let feeWallet=process.env.CREATOR_FEE_WALLET||null;
    let projectMint=process.env.PROJECT_TOKEN_MINT||null;
    if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
      const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await supabase.from("system_state").select("key,value").in("key",["creator_fee_wallet","project_token_mint","scheduler_secret"]);
      let schedulerSecret="";
      for(const row of data||[]){
        if(row.key==="creator_fee_wallet"&&!feeWallet) feeWallet=typeof row.value==="string"?row.value:row.value?.value||row.value;
        if(row.key==="project_token_mint"&&!projectMint) projectMint=typeof row.value==="string"?row.value:row.value?.value||row.value;
        if(row.key==="scheduler_secret") schedulerSecret=typeof row.value==="string"?row.value:row.value?.value||row.value||"";
      }
    }
    const webhook=await ensureHeliusWebhook({feeWallet,authSecret:typeof schedulerSecret!=="undefined"?schedulerSecret:""});
    const launchMissing=[];
    if(!projectMint) launchMissing.push("PROJECT_TOKEN_MINT");
    if(!feeWallet) launchMissing.push("CREATOR_FEE_WALLET");
    if(!webhook.configured) launchMissing.push("HELIUS_WEBHOOK");

    return res.status(200).json({
      ok:true,
      infrastructure_ready:missing.length===0,
      current_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
      live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
      auto_execution_requested:process.env.AUTO_EXECUTION_ENABLED==="true",
      auto_sell_requested:process.env.AUTO_SELL_ENABLED==="true",
      unattended_execution_enabled:false,
      execution_policy:"manual_confirmation_required",
      max_trade_sol:Math.min(Number(process.env.MAX_TRADE_SOL||"0.002"),0.002),
      live_agent_allowlist:(process.env.LIVE_AGENT_ALLOWLIST||"bull").split(",").map(x=>x.trim()).filter(Boolean),
      fee_wallet_configured:Boolean(feeWallet),
      fee_wallet:feeWallet,
      webhook_ready:Boolean(webhook.configured),
      webhook_created:Boolean(webhook.created),
      project_token_configured:Boolean(projectMint),
      launch_ready:missing.length===0&&launchMissing.length===0,
      missing,
      launch_missing:launchMissing
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Readiness check failed"});
  }
}