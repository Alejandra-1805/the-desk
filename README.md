# DOT LAB

Token launch workspace for Robinhood Chain. The original office/PC design is preserved.

## Current release

- The public website launches through Pons V2 on Robinhood mainnet (4663) only, requiring live permission (`canLaunch`) and successful simulation before signing. Test contracts and tests remain development tools and are not exposed in the public launch flow. Permission is read live. The docs mention restricted access, but live checks on two probe addresses returned true on 2026-10-02. Each actual visitor still needs a successful preflight.
- A test deployment is signed by the visitor's browser wallet. No private key, custody or server-side signing is used.
- Test tokens have fixed supply (1 billion), go to their creator, and have no Pons market. The Solidity constructor rejects every other chain, including mainnet.
- The public catalog reads `DotLabTestLaunch` events and verifies the contract's deployed bytecode. Anyone can view confirmed deployments without localStorage.
- Catalog pages cover 5,000 blocks, with "Load older launches" for earlier history. There is no off-chain launch database.
- Drafts stay in localStorage. Submitted transaction hashes are retained for recovery after a refresh; only network-confirmed deployments enter the public list.
- Test cards link to the testnet explorer. Mainnet cards open GMGN. Mainnet catalog verifies documented factory events and transaction inputs marked with the DOT LAB salt prefix; no draft is presented as a confirmed token.

## Pons mainnet integration

`lib/launch/pons.js` implements read-only Pons V2 preflight using the documented mainnet factory. It checks chain, deployed code, launch gate and enabled config, reads the current fee, pins economics, simulates and estimates gas. Default parameters use native ETH, no extra creator tax, no buyback, and the creator's wallet as fee recipient.

`POST /api/pons-preflight` performs a read-only simulation. It **cannot sign or send a transaction**. The visitor explicitly selects mainnet and signs through `assets/launch/mainnet.js`; browser-side validation checks destination, reviewed metadata, fee recipient, zero tax and no buyback. Automated mainnet-path tests use a local factory double, not the live Pons protocol. A live authorized-wallet launch and external GMGN indexing are not yet verified. No Pons testnet deployment has been verified; the test ERC20 is not represented as a Pons test launch.

Sources: https://docs.ponsfamily.com/v2 and https://docs.robinhood.com/chain/ .

## Development and tests

```
npm install
npm run build:token
npm test
```

The Solidity artifact is compiled with Solidity 0.8.30, OpenZeppelin 5.4.0, optimizer 200 and Paris EVM target. The artifact includes its runtime hash for catalog verification.

Optional dedicated RPC settings are listed in `.env.example`. Public RPCs are rate limited; production needs an appropriate RPC plan. Never put private keys in these settings.

## User test

1. Open Create your token and connect an EVM test wallet.
2. Switch/add Robinhood testnet through the wallet prompt and claim test ETH from https://faucet.testnet.chain.robinhood.com/ .
3. Choose a Dot, fill in details and select Review token.
4. Estimate test launch; inspect the displayed test ETH cost.
5. Sign the test deployment. Wait for confirmation, check the CA/explorer and open the site from another browser to verify the public listing.

Uploaded images are draft previews only. On-chain logo metadata uses a public HTTPS URL or the selected hosted Dot artwork. IPFS/custom image hosting is not configured.

Live launch validation requires successful preflight for the actual creator, a signed launch, receipt/catalog verification and external GMGN indexing. No live mainnet launch was sent during development.
