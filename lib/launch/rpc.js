const URLS={testnet:'https://rpc.testnet.chain.robinhood.com',mainnet:'https://rpc.mainnet.chain.robinhood.com'};
const IDS={testnet:46630,mainnet:4663};
export async function rpc(network,method,params=[]){
  if(!URLS[network])throw Error('Unsupported network');
  const endpoint=process.env[network==='testnet'?'DOTLAB_TESTNET_RPC_URL':'DOTLAB_MAINNET_RPC_URL']||URLS[network];
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Network RPC unavailable ('+response.status+')');
  const data=await response.json();
  if(data.error)throw Error('Network RPC: '+String(data.error.message||'request failed').slice(0,180));
  if(!Object.hasOwn(data,'result'))throw Error('Invalid RPC response');
  return data.result;
}
export async function checkNetwork(network){const actual=Number(BigInt(await rpc(network,'eth_chainId')));if(actual!==IDS[network])throw Error('RPC is connected to the wrong chain');return actual}
export function send(res,status,data){res.setHeader('Cache-Control','no-store');return res.status(status).json(data)}
export function hex(n){return '0x'+BigInt(n).toString(16)}
