import { readCatalog } from '../lib/launch/catalog.js';
import { send } from '../lib/launch/rpc.js';
export default async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Use GET'});
  if(req.query.network&&req.query.network!=='testnet')return send(res,409,{error:'Mainnet catalog is not enabled yet'});
  const raw=req.query.cursor;
  if(raw!==undefined&&(!/^\d{1,12}$/.test(String(raw))||!Number.isSafeInteger(Number(raw))))return send(res,400,{error:'Invalid block cursor'});
  try{return send(res,200,await readCatalog(raw===undefined?undefined:Number(raw)))}catch(e){return send(res,503,{error:'Could not read the public testnet catalog. '+e.message})}
}
