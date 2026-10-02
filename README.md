# DOT LAB — Pump.fun token launch workspace

The original office / PC layout now presents a token launchpad with four supplied Dot illustrations.

## Current working flow

1. Select a Dot theme.
2. Enter token name, ticker, description and optional social link.
3. Optionally upload square token artwork (PNG/JPG/WebP, max 2 MB).
4. Save a device-local launch draft and review it.
5. Copy fields, download artwork / launch brief and continue to https://pump.fun/create.
6. Complete creation and sign with your own Solana wallet on Pump.fun.

Fields are not automatically prefilled on Pump.fun. Saving a draft does not mint a token. No direct token creation, wallet custody, bot execution, reward distribution or market trading occurs in this app.

The old agent execution endpoints, wallet scripts, trading backend and artwork have been retired from this repository. Existing hosted environment variables and external databases have not been modified.

## Direct launch integration still required

Creating / signing inside DOT LAB requires a verified Solana transaction flow, permanent token image / metadata storage, a configured RPC and wallet integration. This is not implemented in the current external handoff version.

## Validation

Validated: four Dot assets, dot selection, token field validation, escaped descriptions, local draft save, review, clipboard copy, artwork download destination, PC navigation and official Pump.fun create destination. No mainnet mint or wallet signature was tested.

## Run locally

Serve the repository root with any static HTTP server. No API keys are required for the current handoff flow.
