import { Wallet, Contract, formatUnits } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { provider, walletForAgent, signerSecretForAgent } from "./evm-core.js";

export const CHAIN_ID=4663;
export const NATIVE="0x0000000000000000000000000000000000000000";
const API="https://trade-api.gateway.uniswap.org/v1";
const ROUTER_VERSION="2.1.2";

function db(){
  const url=process.env.SUPABASE_URL||"";
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key) throw new Error("Supabase not configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function headers(){
  return {
    "x-api-key":process.env.UNISWAP_API_KEY||"",
    "content-type":"application/json",
    "accept":"application/json",
    "x-universal-router-version":ROUTER_VERSION,
    "x-permit2-disabled":"true",
    "x-agent-info":JSON.stringify({decision_origin:"autonomous",integration_name:"Muse Agents",version:"1.0"})
  };
}
async function post(path,body){
  const r=await fetch(API+path,{method:"POST",headers:headers(),body:JSON.stringify(body),cache:"no-store"});
  const j=await r.json();
  if(!r.ok){
    const e=new Error(j?.detail||j?.errorCode||j?.error||`Uniswap ${path} failed (${r.status})`);
    e.status=r.status;e.payload=j;throw e;
  }
  return j;
}
export function signerForAgent(agentId){
  const pub=walletForAgent(agentId);
  const found=signerSecretForAgent(agentId);
  if(!pub||!found.value) throw new Error(`Signer not configured for ${agentId}`);
  const key=found.value.startsWith("0x")?found.value:"0x"+found.value;
  const w=new Wallet(key,provider());
  if(w.address.toLowerCase()!==pub.toLowerCase()) throw new Error(`Signer mismatch for ${agentId}`);
  return w;
}
export async function tokenMeta(token){
  const c=new Contract(token,[
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)"
  ],provider());
  const [decimals,symbol]=await Promise.all([c.decimals(),c.symbol()]);
  return {decimals:Number(decimals),symbol};
}
export async function tokenBalance(token,address){
  const c=new Contract(token,["function balanceOf(address) view returns (uint256)"],provider());
  return c.balanceOf(address);
}
export async function checkApproval({walletAddress,token,amount,tokenOut=NATIVE}){
  return post("/check_approval",{walletAddress,token,amount:String(amount),chainId:CHAIN_ID,tokenOut,tokenOutChainId:CHAIN_ID,includeGasInfo:true});
}
export async function getQuote({swapper,tokenIn,tokenOut,amount,slippageTolerance=0.8}){
  return post("/quote",{
    tokenIn,tokenOut,tokenInChainId:CHAIN_ID,tokenOutChainId:CHAIN_ID,
    amount:String(amount),type:"EXACT_INPUT",swapper,slippageTolerance,
    routingPreference:"BEST_PRICE",protocols:["V2","V3","V4"]
  });
}
export async function buildSwap({quoteResponse}){
  const body={quote:quoteResponse.quote,simulateTransaction:true,safetyMode:"SAFE",refreshGasPrice:true};
  return post("/swap",body);
}
function txFromApi(tx){
  if(!tx?.to||!tx?.data||tx.data==="0x") throw new Error("Invalid transaction returned by Uniswap");
  const out={to:tx.to,data:tx.data,value:BigInt(tx.value||"0")};
  if(tx.gasLimit) out.gasLimit=BigInt(tx.gasLimit);
  if(tx.maxFeePerGas) out.maxFeePerGas=BigInt(tx.maxFeePerGas);
  if(tx.maxPriorityFeePerGas) out.maxPriorityFeePerGas=BigInt(tx.maxPriorityFeePerGas);
  if(tx.gasPrice && !out.maxFeePerGas) out.gasPrice=BigInt(tx.gasPrice);
  return out;
}
export async function prepareSwap({agentId,tokenIn,tokenOut,amount,slippageTolerance=0.8}){
  const wallet=signerForAgent(agentId);
  let approval=null;
  if(tokenIn.toLowerCase()!==NATIVE){
    approval=await checkApproval({walletAddress:wallet.address,token:tokenIn,amount,tokenOut});
  }
  const quote=await getQuote({swapper:wallet.address,tokenIn,tokenOut,amount,slippageTolerance});
  let swap=null;
  let buildDeferred=false;
  if(approval?.approval){
    buildDeferred=true;
  }else{
    swap=await buildSwap({quoteResponse:quote});
  }
  return {
    agentId,wallet:wallet.address,chainId:CHAIN_ID,tokenIn,tokenOut,amount:String(amount),
    approvalRequired:Boolean(approval?.approval),approvalCancelRequired:Boolean(approval?.cancel),
    approval,quote,swap,buildDeferred,
    note:buildDeferred?"Approval must confirm before swap simulation/build.":"Swap transaction prepared and simulated; nothing broadcast."
  };
}
async function sendAndWait(wallet,tx,label){
  const sent=await wallet.sendTransaction(txFromApi(tx));
  const receipt=await sent.wait();
  if(!receipt || receipt.status!==1) throw new Error(`${label} transaction failed`);
  return {hash:sent.hash,blockNumber:receipt.blockNumber,status:receipt.status};
}
export async function executePreparedSwap({agentId,tokenIn,tokenOut,amount,slippageTolerance=0.8,allowBroadcast=false}){
  if(!allowBroadcast || process.env.EVM_EXECUTION_ENABLED!=="true"){
    return {ok:true,broadcast:false,prepared:await prepareSwap({agentId,tokenIn,tokenOut,amount,slippageTolerance})};
  }
  const wallet=signerForAgent(agentId);
  let approval=tokenIn.toLowerCase()===NATIVE?null:await checkApproval({walletAddress:wallet.address,token:tokenIn,amount,tokenOut});
  const approvalTxs=[];
  if(approval?.cancel) approvalTxs.push(await sendAndWait(wallet,approval.cancel,"approval cancel"));
  if(approval?.approval) approvalTxs.push(await sendAndWait(wallet,approval.approval,"approval"));
  const quote=await getQuote({swapper:wallet.address,tokenIn,tokenOut,amount,slippageTolerance});
  const built=await buildSwap({quoteResponse:quote});
  const swapReceipt=await sendAndWait(wallet,built.swap,"swap");
  return {ok:true,broadcast:true,approvalTxs,swap:swapReceipt,quoteRequestId:quote.requestId,swapRequestId:built.requestId};
}
export async function prepareSellAll({agentId,token,slippageTolerance=1}){
  const wallet=signerForAgent(agentId);
  const meta=await tokenMeta(token);
  const balance=await tokenBalance(token,wallet.address);
  if(balance<=0n) throw new Error("No token balance to sell");
  const prepared=await prepareSwap({agentId,tokenIn:token,tokenOut:NATIVE,amount:balance.toString(),slippageTolerance});
  return {...prepared,tokenSymbol:meta.symbol,tokenDecimals:meta.decimals,tokenBalanceRaw:balance.toString(),tokenBalance:formatUnits(balance,meta.decimals)};
}


export async function executeBuyAndRecord({agentId,tokenOut,amountWei,amountUsd=null,referencePriceUsd=null,allowBroadcast=false}){
  const supabase=db();
  const wallet=signerForAgent(agentId);
  const meta=await tokenMeta(tokenOut);
  const beforeToken=await tokenBalance(tokenOut,wallet.address);
  const beforeEth=await provider().getBalance(wallet.address);

  const result=await executePreparedSwap({
    agentId,tokenIn:NATIVE,tokenOut,amount:String(amountWei),
    slippageTolerance:0.8,allowBroadcast
  });
  if(!result.broadcast) return {...result,mode:"dry_run",amountUsd,referencePriceUsd};

  const afterToken=await tokenBalance(tokenOut,wallet.address);
  const afterEth=await provider().getBalance(wallet.address);
  const qtyRaw=afterToken-beforeToken;
  const qty=Number(formatUnits(qtyRaw,meta.decimals));
  const costEth=Number(formatUnits(BigInt(amountWei),18));
  const txHash=result.swap.hash;

  const {data:position,error:pErr}=await supabase.from("positions").insert({
    agent_id:agentId,token_mint:tokenOut,token_symbol:meta.symbol,
    entry_price_usd:referencePriceUsd,current_price_usd:referencePriceUsd,
    quantity:qty,cost_eth:costEth,entry_value_usd:amountUsd,
    current_value_usd:amountUsd,status:"OPEN",tx_open:txHash,chain_id:CHAIN_ID,
    metadata:{quantity_raw:qtyRaw.toString(),decimals:meta.decimals,balance_eth_before:formatUnits(beforeEth,18),balance_eth_after:formatUnits(afterEth,18)}
  }).select("*").single();
  if(pErr) throw pErr;

  const {error:eErr}=await supabase.from("agent_events").insert({
    agent_id:agentId,event_type:"BUY_EXECUTED",token_mint:tokenOut,token_symbol:meta.symbol,
    decision:"BUY",tx_signature:txHash,tx_hash:txHash,chain_id:CHAIN_ID,
    reference_price_usd:referencePriceUsd,
    payload:{amount_eth:costEth,amount_usd:amountUsd,quantity:qty,position_id:position.id,chain:"robinhood"}
  });
  if(eErr) throw eErr;

  return {...result,position};
}

export async function executeSellAndRecord({agentId,token,referencePriceUsd=null,allowBroadcast=false}){
  const supabase=db();
  const wallet=signerForAgent(agentId);
  const meta=await tokenMeta(token);
  const beforeToken=await tokenBalance(token,wallet.address);
  if(beforeToken<=0n) throw new Error("No token balance to sell");
  const beforeEth=await provider().getBalance(wallet.address);

  const result=await executePreparedSwap({
    agentId,tokenIn:token,tokenOut:NATIVE,amount:beforeToken.toString(),
    slippageTolerance:1,allowBroadcast
  });
  if(!result.broadcast) return {...result,mode:"dry_run",referencePriceUsd,tokenBalanceRaw:beforeToken.toString()};

  const afterEth=await provider().getBalance(wallet.address);
  const ethReceived=afterEth>beforeEth?Number(formatUnits(afterEth-beforeEth,18)):0;
  const {data:open,error:oErr}=await supabase.from("positions").select("*")
    .eq("agent_id",agentId).eq("token_mint",token).eq("status","OPEN").eq("chain_id",CHAIN_ID)
    .order("opened_at",{ascending:false}).limit(1).maybeSingle();
  if(oErr) throw oErr;
  const realizedEth=open?ethReceived-Number(open.cost_eth||0):null;
  const realizedPct=open && Number(open.cost_eth||0)>0 ? (realizedEth/Number(open.cost_eth))*100 : null;
  const txHash=result.swap.hash;

  if(open){
    const {error:pErr}=await supabase.from("positions").update({
      status:"CLOSED",closed_at:new Date().toISOString(),tx_close:txHash,
      current_price_usd:referencePriceUsd,realized_pnl_eth:realizedEth,
      metadata:{...(open.metadata||{}),exit_eth_received:ethReceived,realized_pct:realizedPct}
    }).eq("id",open.id);
    if(pErr) throw pErr;
  }

  const {error:eErr}=await supabase.from("agent_events").insert({
    agent_id:agentId,event_type:"SELL_EXECUTED",token_mint:token,token_symbol:meta.symbol,
    decision:"SELL",tx_signature:txHash,tx_hash:txHash,chain_id:CHAIN_ID,
    reference_price_usd:referencePriceUsd,
    payload:{eth_received:ethReceived,realized_pnl_eth:realizedEth,realized_pct:realizedPct,position_id:open?.id||null,chain:"robinhood"}
  });
  if(eErr) throw eErr;

  return {...result,closedPositionId:open?.id||null,ethReceived,realizedEth,realizedPct};
}
