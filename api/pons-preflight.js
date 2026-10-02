import { JsonRpcProvider, FetchRequest, isAddress } from 'ethers';
import { preparePonsLaunch } from '../lib/launch/pons.js';
import { checkNetwork, send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
 if(req.method!=='POST')return send(res,405,{error:'Use POST for a read-only Pons preflight. No transaction is sent by this endpoint.'});
 const d=req.body;
 if(!d||!isAddress(d.creator||'')||typeof d.name!=='string'||d.name.length<1||d.name.length>32||typeof d.symbol!=='string'||!/^[A-Z][A-Z0-9]{1,9}$/.test(d.symbol)||typeof d.description!=='string'||!d.description||d.description.length>500||typeof d.logo!=='string'||d.logo.length>2048||!/^https:\/\//.test(d.logo)||typeof d.social!=='string'||d.social.length>200)return send(res,400,{error:'Invalid launch details'});
 let provider;
 try{
  await checkNetwork('mainnet');
  const request=new FetchRequest(process.env.DOTLAB_MAINNET_RPC_URL||'https://rpc.mainnet.chain.robinhood.com');request.timeout=10000;
  provider=new JsonRpcProvider(request,4663,{staticNetwork:true});
  const result=await preparePonsLaunch(provider,d.creator,d);
  return send(res,200,{mainnetEnabled:true,simulated:true,chainId:4663,feeWei:result.fee.toString(),initialBuyWei:result.initialBuyWei.toString(),minTokensOut:result.minTokensOut.toString(),estimatedTokensOut:result.estimatedTokensOut.toString(),gas:result.gas.toString(),configId:result.configId,expectedEconomics:result.expectedEconomics,transaction:{...result.transaction,value:result.transaction.value.toString()},notice:'Read-only simulation. No transaction was sent. Your wallet must explicitly sign to launch.'});
 }catch(e){return send(res,503,{mainnetEnabled:false,error:String(e.shortMessage||e.message).slice(0,240)})}finally{provider?.destroy()}
}
