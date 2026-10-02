// Official Pons V2 integration. Every launch checks live wallet permission and pins economics.
import { Contract, Interface, ZeroAddress, hexlify, randomBytes } from 'ethers';
export const PONS_FACTORY='0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const TOKEN_PARAMS='(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)';
export const PONS_ABI=[
 `function launchToken(${TOKEN_PARAMS} params,uint256 launchConfigId,address pairToken) payable returns (address token,address curve)`,
 'function launchFee() view returns (uint256)',
 'function canLaunch(address account) view returns (bool)',
 'function launchConfigCount() view returns (uint256)',
 'function getLaunchConfig(uint256 id) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))',
 'function previewLaunchEconomics(uint256 launchConfigId,address pairToken) view returns (bytes32)'
];
export async function preparePonsLaunch(provider,creator,details){
 const network=await provider.getNetwork();if(network.chainId!==4663n)throw Error('Robinhood mainnet required for Pons preflight');
 if(await provider.getCode(PONS_FACTORY)==='0x')throw Error('Pons factory has no deployed code');
 const factory=new Contract(PONS_FACTORY,PONS_ABI,provider);
 const [allowed,count,fee]=await Promise.all([factory.canLaunch(creator),factory.launchConfigCount(),factory.launchFee()]);
 if(!allowed)throw Error('Pons is not accepting launches from this wallet');
 let configId=null;for(let i=0;i<Math.min(Number(count),32);i++){const c=await factory.getLaunchConfig(i);if(c.enabled){configId=i;break}}
 if(configId===null)throw Error('No enabled Pons launch configuration');
 const expectedEconomics=await factory.previewLaunchEconomics(configId,ZeroAddress);
 const params={name:details.name,symbol:details.symbol,logo:details.logo,description:details.description,socials:{twitter:'',telegram:'',discord:'',website:details.social||'',farcaster:''},creatorFeeRecipient:creator,creatorTaxBps:0,buybackEnabled:false,expectedEconomics,salt:'0x444f544c41420001'+hexlify(randomBytes(24)).slice(2)};
 const data=new Interface(PONS_ABI).encodeFunctionData('launchToken',[params,configId,ZeroAddress]);
 const transaction={from:creator,to:PONS_FACTORY,data,value:fee};
 // A read-only simulation does not grant a signature or send funds.
 await provider.call(transaction);
 const gas=await provider.estimateGas(transaction);
 return {transaction,fee,gas,configId,expectedEconomics};
}
