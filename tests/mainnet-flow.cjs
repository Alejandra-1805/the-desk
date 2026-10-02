const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),ganache=require('ganache'),ethers=require('ethers'),solc=require('solc');
(async()=>{
const {preparePonsLaunch,PONS_FACTORY}=await import('../lib/launch/pons.js');
const {verifyMainnetReceipt,readMainnetCatalog}=await import('../lib/launch/mainnet-catalog.js');
const source=`pragma solidity ^0.8.30; contract Double {
 struct Socials{string twitter;string telegram;string discord;string website;string farcaster;}
 struct Params{string name;string symbol;string logo;string description;Socials socials;address creatorFeeRecipient;uint16 creatorTaxBps;bool buybackEnabled;bytes32 expectedEconomics;bytes32 salt;}
 struct Config{uint256 supply;uint256 curveFeeBps;uint256 phantomQuote;uint256 graduationThreshold;uint24 poolFee;int24 tickSpacing;bool enabled;}
 event TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold);
 function canLaunch(address) external view returns(bool){return block.chainid==4663;}
 function launchFee() external pure returns(uint256){return 0.0005 ether;}
 function launchConfigCount() external pure returns(uint256){return 1;}
 function getLaunchConfig(uint256) external pure returns(Config memory){return Config(1e27,100,1 ether,4.2 ether,0,60,true);}
 function previewLaunchEconomics(uint256,address) external pure returns(bytes32){return bytes32(uint256(42));}
 function launchToken(Params calldata p,uint256 config,address pair) external payable returns(address,address){require(msg.value==0.0005 ether);require(p.expectedEconomics==bytes32(uint256(42)));emit TokenLaunched(address(123),address(456),msg.sender,pair,config,4.2 ether);return(address(123),address(456));}}
`;
const c=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'D.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}}))).contracts['D.sol'].Double;
const chain=ganache.provider({logging:{quiet:true},chain:{chainId:4663,hardfork:'shanghai'}});await chain.request({method:'evm_setAccountCode',params:[PONS_FACTORY,'0x'+c.evm.deployedBytecode.object]});
const provider=new ethers.BrowserProvider(chain),originalFetch=global.fetch;
global.fetch=async(url,o)=>{const r=JSON.parse(o.body);return {ok:true,json:async()=>({result:await chain.request({method:r.method,params:r.params})})}};
let sends=0,blocked=false,tamper=false;
const wallet={on(){},removeListener(){},async request(r){if(r.method==='eth_requestAccounts')return chain.request({method:'eth_accounts'});if(r.method==='eth_sendTransaction'){assert(r.params[0].gasPrice);assert.equal(r.params[0].maxPriorityFeePerGas,undefined);sends++;const hash=await chain.request(r);setTimeout(()=>chain.request({method:'evm_mine'}),300);return hash}return chain.request(r)}};
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://example.com'}),w=dom.window;w.ethers=ethers;w.requestAnimationFrame=()=>0;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.fetch=async(url,o)=>{if(url==='/api/pons-preflight'){if(blocked)return {ok:false,json:async()=>({error:'Pons is not accepting launches from this wallet'})};const d=JSON.parse(o.body),r=await preparePonsLaunch(provider,d.creator,d);if(tamper)r.transaction.to='0x'+'a'.repeat(40);return {ok:true,json:async()=>({chainId:4663,feeWei:r.fee.toString(),transaction:{...r.transaction,value:r.transaction.value.toString()}})}}if(String(url).startsWith('/api/launch-status'))return {ok:true,json:async()=>verifyMainnetReceipt(String(url).split('hash=')[1])};return {ok:true,json:async()=>({launches:[],nextCursor:null})}};
w.eval(fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);w.dotLabNetwork='mainnet';const d={id:'x',name:'NOVA',symbol:'NOVA',description:'Test mainnet integration',dot:'green',social:''};w.eval('drawReview('+JSON.stringify(d)+')');
let module=fs.readFileSync('assets/launch/mainnet.js','utf8').replace(/^import .*?;\n/,'const {BrowserProvider,Interface,getAddress,formatEther}=window.ethers;\n').replace(/export /g,'');w.eval('(async()=>{'+module+';window.mainnetTest={connect,estimate,sign,checkPending};})()');const m=w.mainnetTest;
await m.connect({provider:wallet});blocked=true;await m.estimate(d,{provider:wallet});assert(w.document.querySelector('#signLaunch').disabled);assert.equal(sends,0);assert(w.document.querySelector('#launchStatus').textContent.includes('not accepting'));
blocked=false;tamper=true;await m.estimate(d,{provider:wallet});assert(w.document.querySelector('#signLaunch').disabled);assert.equal(sends,0);
tamper=false;await m.estimate(d,{provider:wallet});assert(!w.document.querySelector('#signLaunch').disabled);assert(w.document.querySelector('#launchCost').textContent.includes('Maximum gas allowance'));assert.equal(sends,0);await m.sign(d);assert.equal(sends,1);assert(w.document.querySelector('#launchContract').href.includes('gmgn.ai/robinhood/token/'));assert.equal(w.localStorage.getItem('dotlab.pendingMainnetLaunch.v1'),null);
const catalog=await readMainnetCatalog();assert.equal(catalog.launches.length,1);assert.equal(catalog.launches[0].name,'NOVA');assert.equal(catalog.launches[0].chainId,4663);
console.log('PASS: real-launch frontend, permission rejection without sending, destination tamper rejection, fee estimate, one explicit signature, receipt verification and public mainnet catalog (Pons test double only)');global.fetch=originalFetch;await chain.disconnect();dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1});
