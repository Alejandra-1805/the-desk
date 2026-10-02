import { readFileSync } from 'node:fs';
import { Interface, keccak256 } from 'ethers';
import { rpc, hex, checkNetwork } from './rpc.js';
const definition=JSON.parse(readFileSync(new URL('./test-token-runtime.json',import.meta.url),'utf8'));
export const launchInterface=new Interface([definition.event]);
export const launchTopic=launchInterface.getEvent('DotLabTestLaunch').topicHash;
export async function verifiedTestLaunch(log){
  const code=await rpc('testnet','eth_getCode',[log.address,'latest']);
  if(code==='0x'||keccak256(code)!==definition.hash)return null;
  let parsed;try{parsed=launchInterface.parseLog(log)}catch{return null}
  if(!parsed)return null;
  const a=parsed.args;
  return {address:log.address,creator:a.creator,name:a.name,symbol:a.symbol,description:a.description,logo:a.logo,website:a.website,dot:a.dot,chainId:46630,status:'confirmed',transactionHash:log.transactionHash,blockNumber:Number(BigInt(log.blockNumber))};
}
export async function readCatalog(cursor){
  await checkNetwork('testnet');
  const latest=Number(BigInt(await rpc('testnet','eth_blockNumber')));
  const stable=Math.max(0,latest-1);
  const to=cursor===undefined?stable:Math.min(cursor,stable),from=Math.max(0,to-4999);
  const ranges=[];for(let b=from;b<=to;b+=500)ranges.push([b,Math.min(to,b+499)]);
  const logs=[];
  // Bound concurrent calls so public RPC quotas do not cause a request storm.
  for(let i=0;i<ranges.length;i+=3){const sets=await Promise.all(ranges.slice(i,i+3).map(([f,t])=>rpc('testnet','eth_getLogs',[{fromBlock:hex(f),toBlock:hex(t),topics:[launchTopic]}])));for(const set of sets)logs.push(...set)}
  logs.sort((a,b)=>Number(BigInt(b.blockNumber)-BigInt(a.blockNumber)));
  const launches=[];const seen=new Set();
  for(const log of logs.slice(0,60)){if(log.removed||seen.has(log.address.toLowerCase()))continue;seen.add(log.address.toLowerCase());const t=await verifiedTestLaunch(log);if(t)launches.push(t)}
  return {network:'testnet',chainId:46630,launches,fromBlock:from,toBlock:to,nextCursor:from>0?from-1:null,latestBlock:latest};
}
export async function verifyReceipt(hash){
  await checkNetwork('testnet');
  const receipt=await rpc('testnet','eth_getTransactionReceipt',[hash]);
  if(!receipt)return {pending:true};
  if(BigInt(receipt.status)!==1n)return {pending:false,failed:true};
  const head=Number(BigInt(await rpc('testnet','eth_blockNumber')));
  if(head<Number(BigInt(receipt.blockNumber))+1)return {pending:true};
  if(!receipt.contractAddress)throw Error('This is not a token deployment');
  const event=receipt.logs.find(l=>l.address.toLowerCase()===receipt.contractAddress.toLowerCase()&&l.topics[0]===launchTopic);
  if(!event)throw Error('No DOT LAB test launch event found');
  const t=await verifiedTestLaunch(event);if(!t)throw Error('Token bytecode does not match DOT LAB test token');
  return {pending:false,launch:t};
}
