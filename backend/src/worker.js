import { WATCHLIST, initDb, analyzeTicker } from "./core.js";

await initDb();
let failed=false;

for(const ticker of WATCHLIST){
  try{
    const result=await analyzeTicker(ticker,{save:true});
    console.log(JSON.stringify({
      ok:true,ticker,run_id:result.run_id,consensus:result.desk_consensus
    }));
  }catch(e){
    failed=true;
    console.error(JSON.stringify({ok:false,ticker,error:e.message}));
  }
}

process.exit(failed?1:0);
