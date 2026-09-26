import { JsonRpcProvider, Wallet, isAddress } from "ethers";

export const ROBINHOOD_CHAIN_ID=4663;
export const ROBINHOOD_EXPLORER="https://robinhoodchain.blockscout.com";

export const DEFAULT_EVM_WALLETS={
  bull:"0xC88A0304BB0c669Dc1773eD0A90627A741b1acD5",
  degen:"0xfDBCDaA586E8D051c1BDAD29Af9aB8305CB435C4",
  quant:"0xc402fd2594a9e131933A174BCb5864A208b5cc90",
  bear:"0xF929c477D8b63e119BD24e8946B824271567D39f"
};

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
  const id=String(agentId||"").toLowerCase();
  const key="AGENT_"+id.toUpperCase()+"_EVM_WALLET";
  const address=process.env[key]||DEFAULT_EVM_WALLETS[id]||"";
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


export function signerEnvForAgent(agentId){
  return "AGENT_"+String(agentId||"").toUpperCase()+"_EVM_SECRET_KEY";
}

export function walletEnvForAgent(agentId){
  return "AGENT_"+String(agentId||"").toUpperCase()+"_EVM_WALLET";
}

export function verifyAgentSigner(agentId){
  const secret=process.env[signerEnvForAgent(agentId)]||"";
  const configured=walletForAgent(agentId)||"";
  if(!secret) return {configured:false,address:null,matches:false};
  try{
    const wallet=new Wallet(secret);
    const matches=!configured || wallet.address.toLowerCase()===configured.toLowerCase();
    return {configured:true,address:wallet.address,matches};
  }catch{
    return {configured:false,address:null,matches:false};
  }
}
