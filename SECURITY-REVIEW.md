# DOT LAB — request for domain security-classification review

Please investigate the warning shown when connecting a wallet to https://the-desk-zeta-liart.vercel.app/ . We are not asking users to bypass it. We are requesting a review, not asserting that the classification is false.

- Project: independent token launch frontend, DOT LAB.
- Network: Robinhood Chain, chain ID 4663.
- Source: https://github.com/Alejandra-1805/the-desk .
- Launch factory: 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e.
- Factory documentation: https://docs.ponsfamily.com/v2 .
- Connecting requests a public account and network selection. It does not request a token approval, Permit, private key, seed phrase, or transaction signature.
- Launching requires a separate estimate followed by an explicit user signature. Destination and reviewed parameters are validated against the documented Pons factory.
- Creator fee recipient is the user's wallet; extra creator tax is zero and buyback is off. Transaction value is the fee read from the factory.
- The pinned ethers 6.15.0 dependency is served from the application origin. No external script CDN is required by the public wallet module.
- Browser security headers restrict script origins, frames, forms and object embeds. These measures do not constitute an independent security audit.
- Automated checks use a local EVM and a Pons factory double. A live mainnet launch has not yet been verified.
- The public MetaMask phishing configuration did not contain an exact domain entry for this hostname when checked on 2026-10-02. This does not rule out fuzzy matches or other security providers.

Evidence: attach the wallet warning screenshot supplied by the owner. Please identify the affected provider/classification, assess the site and update the classification only if appropriate.

This request has been prepared but has not been submitted to wallet support or a security provider.
