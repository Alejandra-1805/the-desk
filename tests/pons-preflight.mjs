import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,ContractFactory,Interface,parseEther} from 'ethers';
import {preparePonsLaunch,PONS_ABI,PONS_FACTORY} from '../lib/launch/pons.js';
// An explicit test double verifies ABI encoding and the preflight gates; this is not a deployed Pons protocol.
const source=`pragma solidity ^0.8.30;
contract FactoryDouble {
 struct Socials{string twitter;string telegram;string discord;string website;string farcaster;}
 struct Params{string name;string symbol;string logo;string description;Socials socials;address creatorFeeRecipient;uint16 creatorTaxBps;bool buybackEnabled;bytes32 expectedEconomics;bytes32 salt;}
 struct Config{uint256 supply;uint256 curveFeeBps;uint256 phantomQuote;uint256 graduationThreshold;uint24 poolFee;int24 tickSpacing;bool enabled;}
 function canLaunch(address) external pure returns(bool){return true;}
 function launchFee() external pure returns(uint256){return 0.0005 ether;}
 function launchConfigCount() external pure returns(uint256){return 1;}
 function getLaunchConfig(uint256) external pure returns(Config memory){return Config(1e27,100,1 ether,4.2 ether,0,60,true);}
 function previewLaunchEconomics(uint256,address) external pure returns(bytes32){return bytes32(uint256(42));}
 function launchToken(Params calldata p,uint256,address) external payable returns(address,address){require(msg.value==0.0005 ether);require(p.expectedEconomics==bytes32(uint256(42)));return(address(1),address(2));}
}`;
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'D.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
const c=output.contracts['D.sol'].FactoryDouble;
const chain=ganache.provider({logging:{quiet:true},chain:{chainId:4663,hardfork:'shanghai'}});
await chain.request({method:'evm_setAccountCode',params:[PONS_FACTORY,'0x'+c.evm.deployedBytecode.object]});
const provider=new BrowserProvider(chain);const creator=await (await provider.getSigner()).getAddress();
const details={name:'Test',symbol:'TEST',description:'Test only',logo:'https://example.com/dot.webp',social:''};
const p=await preparePonsLaunch(provider,creator,details);
assert.equal(p.fee,parseEther('0.0005'));assert(p.gas>0n);assert.equal(p.transaction.to,PONS_FACTORY);
const decoded=new Interface(PONS_ABI).decodeFunctionData('launchToken',p.transaction.data);
assert.equal(decoded.params.creatorFeeRecipient,creator);assert.equal(decoded.params.creatorTaxBps,0n);assert.equal(decoded.params.buybackEnabled,false);assert.equal(decoded.params.expectedEconomics,'0x'+'0'.repeat(62)+'2a');assert.equal(decoded.pairToken,'0x'+'0'.repeat(40));
const wrong={getNetwork:async()=>({chainId:46630n})};await assert.rejects(preparePonsLaunch(wrong,creator,details),/mainnet required/);
await chain.request({method:'evm_setAccountCode',params:[PONS_FACTORY,'0x']});const fresh=new BrowserProvider(chain);await assert.rejects(preparePonsLaunch(fresh,creator,details),/no deployed code/);
await chain.disconnect();console.log('PASS: Pons ABI preflight, live fee read, economics pin, explicit payout, zero tax, no buyback, no funds sent and wrong-chain gate (test double only)');
