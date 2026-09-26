import { JsonRpcProvider, isAddress } from "ethers";

export const ROBINHOOD_CHAIN_ID=4663;
export const ROBINHOOD_EXPLORER="https://robinhoodchain.blockscout.com";

export function rpcUrl(){
  return process.env.ALCHEMY_RPC_URL || "";
}

export function provider(){
  const url=rpcUrl();
  if(!url) throw new Error("ALCHEMY_RPC_URL is not configured");
  return new JsonRpcProvider(url,ROBINHOOD_CHAIN_ID,{staticNetwork:true});
}

export function explorerAddress(address){
  return `${ROBINHOOD_EXPLORER}/address/${address}`;
}

export function explorerTx(hash){
  return `${ROBINHOOD_EXPLORER}/tx/${hash}`;
}

export function walletForAgent(agentId){
  const key="AGENT_"+String(agentId||"").toUpperCase()+"_EVM_WALLET";
  const address=process.env[key]||"";
  return isAddress(address)?address:null;
}

export async function getNativeBalanceEth(address){
  if(!isAddress(address)) return null;
  const wei=await provider().getBalance(address);
  return Number(wei)/1e18;
}

export async function getChainStatus(){
  const p=provider();
  const [network,blockNumber,feeData]=await Promise.all([
    p.getNetwork(),
    p.getBlockNumber(),
    p.getFeeData()
  ]);
  return {
    chainId:Number(network.chainId),
    blockNumber,
    gasPriceWei:feeData.gasPrice?.toString()||null,
    explorer:ROBINHOOD_EXPLORER
  };
}
