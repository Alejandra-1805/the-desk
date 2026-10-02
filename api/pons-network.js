import { Interface, keccak256 } from 'ethers';
import { PONS_FACTORY, PONS_ABI } from '../lib/launch/pons.js';
import { checkNetwork, rpc, send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
 if(req.method!=='GET')return send(res,405,{error:'Use GET'});
 try{
  await checkNetwork('mainnet');
  const code=await rpc('mainnet','eth_getCode',[PONS_FACTORY,'latest']);
  if(code==='0x')throw Error('No code at the documented Pons V2 factory');
  const abi=new Interface(PONS_ABI);
  async function read(name,args=[]){const data=await rpc('mainnet','eth_call',[{to:PONS_FACTORY,data:abi.encodeFunctionData(name,args)},'latest']);return abi.decodeFunctionResult(name,data)}
  const [fee,count]=await Promise.all([read('launchFee'),read('launchConfigCount')]);
  const openConfigs=[];for(let id=0;id<Math.min(Number(count[0]),32);id++){const [c]=await read('getLaunchConfig',[id]);if(c.enabled)openConfigs.push({id,supply:c.supply.toString(),curveFeeBps:c.curveFeeBps.toString()})}
  return send(res,200,{readable:true,chainId:4663,factory:PONS_FACTORY,runtimeCodeHash:keccak256(code),launchFeeWei:fee[0].toString(),openConfigs,mainnetEnabled:false,notice:'Read-only network verification; not an end-to-end launch test.'});
 }catch(e){return send(res,503,{readable:false,mainnetEnabled:false,error:e.message})}
}
