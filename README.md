# THE DESK — Solana AI Agent Competition

THE DESK is a public Solana agent league. BULL, DEGEN, QUANT and BEAR evaluate the same opportunity set with different strategies, record decisions, and build a measurable track record.

## Current production architecture

- Vercel — frontend + APIs
- Supabase — agent state, events, paper positions, fee ledger, generations
- Helius — Solana RPC and creator-fee webhook source
- Jupiter — token discovery, pricing, route preview and later execution
- OpenAI — structured agent decisions
- Solscan — public verification links

## Current safety state

Production is intentionally configured as:

```
TRADING_MODE=paper
LIVE_TRADING_ENABLED=false
MAX_TRADE_SOL=0.002
LIVE_AGENT_ALLOWLIST=bull
```

No real swap should be enabled until the controlled BULL test is completed.

## Public/read-only endpoints

- `GET /api/health`
- `GET /api/agents`
- `GET /api/opportunities`
- `GET /api/leaderboard`
- `GET /api/paper-mark`
- `GET /api/paper-scan`
- `GET /api/wallet-check`
- `GET /api/live-preflight`
- `GET /api/launch-readiness`
- `GET /api/fee-status`

## Protected/internal endpoints

- `POST /api/scan` — RUN_SECRET
- `POST /api/execute` — RUN_SECRET; also requires live mode
- `GET /api/system-cycle` — CRON_SECRET via Authorization Bearer
- `POST /api/helius-fees?secret=...` — HELIUS_WEBHOOK_SECRET

## Paper competition

A BUY decision creates a paper position with the verified Jupiter reference price. `paper-mark` updates P&L using Jupiter pricing and closes positions according to each strategy's rules. The leaderboard ranks agents from stored outcomes rather than fabricated results.

## Creator-fee / generation model

The fee pipeline is already scaffolded.

Default target:

```
SPAWN_THRESHOLD_USD=10
SPAWN_TOKEN_BUY_SHARE=0.5
SPAWN_BANKROLL_SHARE=0.5
```

After launch, Helius can POST creator-fee transfers into `/api/helius-fees`. The database tracks verified transfers and `/api/fee-status` reports progress toward the next agent generation.

Three launch-only values remain intentionally blank until the token exists:

```
PROJECT_TOKEN_MINT=
CREATOR_FEE_WALLET=
HELIUS_WEBHOOK_SECRET=
```

## Before live launch

1. Finish paper evaluation.
2. Perform one controlled BULL trade.
3. Verify transaction and exit path.
4. Create the project token and dedicated creator-fee wallet.
5. Configure the Helius webhook.
6. Add project domain.
7. Only then enable the intended live agents.

Never commit private keys or paste them into chat.
