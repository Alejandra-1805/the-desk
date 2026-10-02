import { Interface } from 'ethers';
import { PONS_ABI, PONS_FACTORY } from './pons.js';
import { rpc, hex, checkNetwork } from './rpc.js';
export const DOTLAB_SALT_PREFIX='0x444f544c41420001';
export const mainnetInterface=new Interface([...PONS_ABI,'event TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold)']);
const topic=mainnetInterface.getEvent('TokenLaunched').topicHash;
export async function decodeMainnetLaunch(log){
 if(log.removed||log.address.toLowerCase()!==PONS_FACTORY.toLowerCase()||log.topics[0]!==topic)return null;
 const tx=await rpc('mainnet','eth_getTransactionByHash',[log.transactionHash]);
 if(!tx?.to||tx.to.toLowerCase()!==PONS_FACTORY.toLowerCase())return null;
 let event,call;try{event=mainnetInterface.parseLog(log);call=mainnetInterface.decodeFunctionData('launchToken',tx.input)}catch{return null}
 if(!call.params.salt.startsWith(DOTLAB_SALT_PREFIX)||event.args.deployer.toLowerCase()!==tx.from.toLowerCase())return null;
 const p=call.params;
 return {address:event.args.token,curve:event.args.curve,creator:event.args.deployer,name:p.name,symbol:p.symbol,description:p.description,logo:p.logo,website:p.socials.website,dot:'green',chainId:4663,status:'confirmed',transactionHash:log.transactionHash,blockNumber:Number(BigInt(log.blockNumber))};
}
export async function readMainnetCatalog(cursor){
 await checkNetwork('mainnet');const latest=Number(BigInt(await rpc('mainnet','eth_blockNumber'))),stable=Math.max(0,latest-1),to=cursor===undefined?stable:Math.min(cursor,stable),from=Math.max(0,to-4999);
 const logs=[];for(let b=from;b<=to;b+=1000)logs.push(...await rpc('mainnet','eth_getLogs',[{address:PONS_FACTORY,fromBlock:hex(b),toBlock:hex(Math.min(to,b+999)),topics:[topic]}]));
 logs.sort((a,b)=>Number(BigInt(b.blockNumber)-BigInt(a.blockNumber)));const launches=[];for(const log of logs.slice(0,40)){const launch=await decodeMainnetLaunch(log);if(launch)launches.push(launch)}
 return {network:'mainnet',chainId:4663,launches,fromBlock:from,toBlock:to,nextCursor:from>0?from-1:null,latestBlock:latest};
}
export async function verifyMainnetReceipt(hash){
 await checkNetwork('mainnet');const receipt=await rpc('mainnet','eth_getTransactionReceipt',[hash]);if(!receipt)return {pending:true};if(BigInt(receipt.status)!==1n)return {pending:false,failed:true};
 const head=Number(BigInt(await rpc('mainnet','eth_blockNumber')));if(head<Number(BigInt(receipt.blockNumber))+1)return {pending:true};
 const event=receipt.logs.find(l=>l.address.toLowerCase()===PONS_FACTORY.toLowerCase()&&l.topics[0]===topic);if(!event)throw Error('No Pons V2 launch event found');
 const launch=await decodeMainnetLaunch(event);if(!launch)throw Error('This transaction is not a DOT LAB launch');return {pending:false,launch};
}
