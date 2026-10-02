import { verifyMainnetReceipt } from '../lib/launch/mainnet-catalog.js';
import { verifyReceipt } from '../lib/launch/catalog.js';
import { send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Use GET'});
  if(!/^0x[0-9a-fA-F]{64}$/.test(String(req.query.hash||'')))return send(res,400,{error:'Invalid transaction hash'});
  if(req.query.network&&!['mainnet','testnet'].includes(req.query.network))return send(res,400,{error:'Unsupported network'});
  try{return send(res,200,await (req.query.network==='mainnet'?verifyMainnetReceipt:verifyReceipt)(req.query.hash))}catch(e){return send(res,503,{error:e.message})}
}
