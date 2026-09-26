import { createClient } from "@supabase/supabase-js";
import { getChainStatus, verifyAgentSigner } from "../lib/evm-core.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const required=[
      "SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ALCHEMY_RPC_URL",
      "OPENAI_API_KEY","RUN_SECRET","CRON_SECRET",
      "AGENT_BULL_EVM_WALLET","AGENT_BULL_EVM_SECRET_KEY",
      "AGENT_DEGEN_EVM_WALLET","AGENT_DEGEN_EVM_SECRET_KEY",
      "AGENT_QUANT_EVM_WALLET","AGENT_QUANT_EVM_SECRET_KEY",
      "AGENT_BEAR_EVM_WALLET","AGENT_BEAR_EVM_SECRET_KEY"
    ];
    const missing=required.filter(k=>!process.env[k]);

    let projectToken=process.env.PROJECT_TOKEN_ADDRESS||null;
    let creatorFeeWallet=process.env.CREATOR_FEE_EVM_WALLET||null;
    let botPaused=true;

    if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
      const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data}=await supabase.from("system_state").select("key,value").in("key",[
        "project_token_address","creator_fee_evm_wallet","bot_paused"
      ]);
      for(const row of data||[]){
        const v=typeof row.value==="string"?row.value:(row.value?.value??row.value);
        if(row.key==="project_token_address"&&!projectToken) projectToken=v||null;
        if(row.key==="creator_fee_evm_wallet"&&!creatorFeeWallet) creatorFeeWallet=v||null;
        if(row.key==="bot_paused") botPaused=(v===true||v==="true");
      }
    }

    let chainStatus=null;
    try{ if(process.env.ALCHEMY_RPC_URL) chainStatus=await getChainStatus(); }catch{}

    const launchMissing=[];
    if(!projectToken) launchMissing.push("PROJECT_TOKEN_ADDRESS");
    if(!creatorFeeWallet) launchMissing.push("CREATOR_FEE_EVM_WALLET");
    if(!process.env.UNISWAP_API_KEY) launchMissing.push("UNISWAP_API_KEY");

    const signerChecks=["bull","degen","quant","bear"].map(id=>({agent:id,...verifyAgentSigner(id)}));
    const signerMismatch=signerChecks.filter(x=>x.configured&&!x.matches).map(x=>x.agent);
    const signerMissing=signerChecks.filter(x=>!x.configured).map(x=>x.agent);

    return res.status(200).json({
      ok:true,
      project:"MUSE AGENTS",
      chain:"Robinhood Chain",
      chain_id:4663,
      explorer:"https://robinhoodchain.blockscout.com",
      infrastructure_ready:missing.length===0,
      chain_connected:Boolean(chainStatus&&chainStatus.chainId===4663),
      chain_status:chainStatus,
      bot_paused:botPaused,
      current_mode:(process.env.TRADING_MODE||"paper").toLowerCase(),
      live_trading_enabled:process.env.LIVE_TRADING_ENABLED==="true",
      auto_execution_requested:process.env.AUTO_EXECUTION_ENABLED==="true",
      auto_sell_requested:process.env.AUTO_SELL_ENABLED==="true",
      signer_checks:signerChecks,
      signer_mismatch:signerMismatch,
      signer_missing:signerMissing,
      evm_execution_ready:false,
      execution_note:"Alchemy/EVM read layer is ready. Robinhood swap execution remains disabled until router integration is completed.",
      project_token_configured:Boolean(projectToken),
      project_token_address:projectToken,
      creator_fee_wallet_configured:Boolean(creatorFeeWallet),
      creator_fee_wallet:creatorFeeWallet,
      missing,
      launch_missing:launchMissing
    });
  }catch(e){
    return res.status(503).json({ok:false,error:e?.message||"Readiness check failed"});
  }
}