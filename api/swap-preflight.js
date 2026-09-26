import { parseEther, isAddress } from "ethers";
import { provider, walletForAgent } from "../lib/evm-core.js";

const NATIVE="0x0000000000000000000000000000000000000000";

function headers(){
  return {
    "x-api-key":process.env.UNISWAP_API_KEY||"",
    "Content-Type":"application/json",
    "Accept":"application/json",
    "x-agent-info":JSON.stringify({
      decision_origin:"human_mediated",
      integration_name:"Muse Agents",
      version:"1.0"
    }),
    "x-erc20eth-enabled":"true"
  };
}

export default async function handler(req,res){
  try{
    if(req.method!=="GET" && req.method!=="POST"){
      return res.status(405).json({ok:false,error:"method_not_allowed"});
    }

    const src=req.method==="GET"?req.query:(req.body||{});
    const agent=String(src.agent||"bull").toLowerCase();
    const tokenOut=String(src.tokenOut||"");
    const amountEth=String(src.amountEth||"0.0001");

    if(!["bull","degen","quant","bear"].includes(agent)){
      return res.status(400).json({ok:false,error:"invalid_agent"});
    }
    if(!isAddress(tokenOut)){
      return res.status(400).json({ok:false,error:"invalid_token_out"});
    }

    let amount;
    try{ amount=parseEther(amountEth); }
    catch{ return res.status(400).json({ok:false,error:"invalid_amount_eth"}); }

    if(amount<=0n) return res.status(400).json({ok:false,error:"amount_must_be_positive"});

    const swapper=walletForAgent(agent);
    if(!swapper) return res.status(400).json({ok:false,error:"agent_wallet_not_configured"});

    const p=provider();
    const balance=await p.getBalance(swapper);
    const feeData=await p.getFeeData();

    const quoteResp=await fetch("https://trade-api.gateway.uniswap.org/v1/quote",{
      method:"POST",
      headers:headers(),
      body:JSON.stringify({
        tokenIn:NATIVE,
        tokenOut,
        tokenInChainId:4663,
        tokenOutChainId:4663,
        amount:amount.toString(),
        type:"EXACT_INPUT",
        swapper,
        slippageTolerance:0.5
      })
    });
    const quoteJson=await quoteResp.json();

    if(!quoteResp.ok){
      return res.status(quoteResp.status).json({
        ok:false,
        stage:"quote",
        agent,
        swapper,
        tokenOut,
        amountEth,
        balanceWei:balance.toString(),
        quote_error:quoteJson
      });
    }

    const q=quoteJson.quote||quoteJson;
    const gasFeeWei=q.gasFeeWei||q.gasFee||quoteJson.gasFeeWei||null;
    const gasFee=gasFeeWei?BigInt(String(gasFeeWei)):0n;
    const enoughForAmount=balance>=amount;
    const enoughForAmountAndQuotedGas=balance>=(amount+gasFee);

    return res.status(200).json({
      ok:true,
      mode:"preflight_only",
      chain:"Robinhood Chain",
      chain_id:4663,
      agent,
      swapper,
      tokenIn:NATIVE,
      tokenOut,
      amountEth,
      amountWei:amount.toString(),
      balanceWei:balance.toString(),
      gasPriceWei:feeData.gasPrice?.toString()||null,
      enoughForAmount,
      enoughForAmountAndQuotedGas,
      routing:quoteJson.routing||q.routing||null,
      outputAmount:q.output?.amount||q.amountOut||q.quote||null,
      gasFeeWei:gasFeeWei?String(gasFeeWei):null,
      requestId:quoteJson.requestId||null,
      note:"No transaction was signed or broadcast."
    });
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||"preflight_failed"});
  }
}
