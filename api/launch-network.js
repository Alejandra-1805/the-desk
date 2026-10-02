import { checkNetwork, rpc, send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Use GET'});
  try{const chainId=await checkNetwork('testnet');const [block,gasPrice]=await Promise.all([rpc('testnet','eth_blockNumber'),rpc('testnet','eth_gasPrice')]);return send(res,200,{ready:true,chainId,blockNumber:Number(BigInt(block)),gasPrice,mainnetEnabled:true})}catch(e){return send(res,503,{ready:false,error:e.message,mainnetEnabled:true})}
}
