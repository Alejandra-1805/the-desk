// Official Pons V2 integration. Every launch checks live wallet permission and pins economics.
import { Contract, Interface, ZeroAddress, hexlify, randomBytes, parseEther } from 'ethers';
export const PONS_FACTORY='0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const PONS_ROUTER='0xe33E9E479dF8802cb0866d5d05258bEc4cF62948';
export const TOKEN_PARAMS='(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)';
export const PONS_ABI=[
 `function launchToken(${TOKEN_PARAMS} params,uint256 launchConfigId,address pairToken) payable returns (address token,address curve)`,
 'function launchFee() view returns (uint256)',
 'function canLaunch(address account) view returns (bool)',
 'function launchConfigCount() view returns (uint256)',
 'function getLaunchConfig(uint256 id) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))',
 'function previewLaunchEconomics(uint256 launchConfigId,address pairToken) view returns (bytes32)'
];
export const ROUTER_ABI=[`function launchAndBuy(${TOKEN_PARAMS} params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve,uint256 tokensOut)`];
export async function preparePonsLaunch(provider,creator,details){
 const network=await provider.getNetwork();if(network.chainId!==4663n)throw Error('Robinhood mainnet required for Pons preflight');
 if(await provider.getCode(PONS_FACTORY)==='0x')throw Error('Pons factory has no deployed code');
 const factory=new Contract(PONS_FACTORY,PONS_ABI,provider);
 const [allowed,count,fee]=await Promise.all([factory.canLaunch(creator),factory.launchConfigCount(),factory.launchFee()]);
 if(!allowed)throw Error('Pons is not accepting launches from this wallet');
 let configId=null,config;for(let i=0;i<Math.min(Number(count),32);i++){const c=await factory.getLaunchConfig(i);if(c.enabled){configId=i;config=c;break}}
 if(configId===null)throw Error('No enabled Pons launch configuration');
 const expectedEconomics=await factory.previewLaunchEconomics(configId,ZeroAddress);
 const params={name:details.name,symbol:details.symbol,logo:details.logo,description:details.description,socials:{twitter:'',telegram:'',discord:'',website:details.social||'',farcaster:''},creatorFeeRecipient:creator,creatorTaxBps:0,buybackEnabled:false,expectedEconomics,salt:'0x444f544c41420001'+hexlify(randomBytes(24)).slice(2)};
 const buyText=String(details.initialBuy||'0');if(!/^\d+(\.\d{1,18})?$/.test(buyText))throw Error('Enter the initial buy in ETH, with at most 18 decimals.');
 const initialBuyWei=parseEther(buyText);let minTokensOut=0n,estimatedTokensOut=0n,data,to=PONS_FACTORY;
 if(initialBuyWei>0n){
  if(initialBuyWei>=config.graduationThreshold)throw Error('Initial buy must be below the curve graduation threshold.');
  if(await provider.getCode(PONS_ROUTER)==='0x')throw Error('Pons launch-and-buy router is unavailable');
  const net=initialBuyWei-initialBuyWei*config.curveFeeBps/10000n;
  estimatedTokensOut=net*config.supply/(config.phantomQuote+net);minTokensOut=estimatedTokensOut*99n/100n;
  if(minTokensOut<=0n)throw Error('Initial buy is too small to quote safely');
  to=PONS_ROUTER;data=new Interface(ROUTER_ABI).encodeFunctionData('launchAndBuy',[params,configId,ZeroAddress,initialBuyWei,minTokensOut,creator,[]]);
 }else data=new Interface(PONS_ABI).encodeFunctionData('launchToken',[params,configId,ZeroAddress]);
 const transaction={from:creator,to,data,value:fee+initialBuyWei};
 // A read-only simulation does not grant a signature or send funds.
 await provider.call(transaction);
 const gas=await provider.estimateGas(transaction);
 return {transaction,fee,gas,configId,expectedEconomics,initialBuyWei,minTokensOut,estimatedTokensOut};
}
