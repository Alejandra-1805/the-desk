# THE DESK — Solana AI Agent Competition

Current architecture:

- Vercel: static frontend + serverless API
- Supabase: agent state, events, positions, fee events, generations
- Helius: Solana RPC / wallet activity
- Jupiter: token discovery, pricing and swap execution
- OpenAI: structured agent decisions
- Solscan: public verification links

## Safety model

The repository defaults to `TRADING_MODE=paper`.
Real swaps require **both**:

- `TRADING_MODE=live`
- `LIVE_TRADING_ENABLED=true`

The execution layer also caps each agent by `MAX_TRADE_SOL` and re-checks the token against deterministic filters before signing.

## Vercel environment variables

Required for paper-mode agent scans:

```
SUPABASE_URL=https://qtflxpkdbkgfrugvabuy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<set directly in Vercel>
HELIUS_API_KEY=<your Helius key>
JUPITER_API_KEY=<your Jupiter Developer Platform key>
OPENAI_API_KEY=<your OpenAI API key>
RUN_SECRET=<long random private string>
CRON_SECRET=<different long random private string>
TRADING_MODE=paper
LIVE_TRADING_ENABLED=false
MAX_TRADE_SOL=0.05
```

Wallet variables, after generating wallets:

```
AGENT_BULL_WALLET=
AGENT_BULL_SECRET_KEY=
AGENT_DEGEN_WALLET=
AGENT_DEGEN_SECRET_KEY=
AGENT_QUANT_WALLET=
AGENT_QUANT_SECRET_KEY=
AGENT_BEAR_WALLET=
AGENT_BEAR_SECRET_KEY=
```

**Never commit agent secret keys. Never paste them into chat.**

## Generate four wallets locally

```bash
npm install
npm run wallets
```

This creates `.env.agent-wallets.local` on your own computer and prints only the public addresses in the terminal.

## API

- `GET /api/health` — configuration status
- `GET /api/agents` — wallets, balances, latest verified activity
- `GET /api/opportunities` — current Jupiter-filtered candidates
- `GET /api/leaderboard` — competition standings
- `POST /api/scan` — run all four AI agents; protected by `RUN_SECRET`
- `POST /api/execute` — live BUY execution; disabled unless live trading is explicitly enabled
- `GET /api/cron` — scheduled agent scan; protected by `CRON_SECRET`

## Fee / generation model

Supabase already contains tables for creator fee events and future agent spawns.
Default configuration is stored as:

- spawn threshold: USD 10
- token-buy share: 50%
- agent-bankroll share: 50%

These values are configuration only; fee collection and token launch are not activated yet.
