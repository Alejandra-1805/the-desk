import { readMainnetCatalog } from '../lib/launch/mainnet-catalog.js';
import { readCatalog } from '../lib/launch/catalog.js';
import { send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Use GET'});
  if(req.query.network&&!['testnet','mainnet'].includes(req.query.network))return send(res,400,{error:'Unsupported network'});
  const raw=req.query.cursor;
  if(raw!==undefined&&(!/^\d{1,12}$/.test(String(raw))||!Number.isSafeInteger(Number(raw))))return send(res,400,{error:'Invalid block cursor'});
  try{return send(res,200,await (req.query.network==='mainnet'?readMainnetCatalog:readCatalog)(raw===undefined?undefined:Number(raw)))}catch(e){return send(res,503,{error:'Could not read the public launch catalog. '+e.message})}
}
