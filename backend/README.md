# THE DESK backend

Railway-ready backend for THE DESK.

## Services
- API: `npm start`
- Worker/cron: `npm run worker`

## Required environment variables
- `TWELVE_DATA_API_KEY`
- `OPENAI_API_KEY`
- `DATABASE_URL` (Railway Postgres reference)
- `RUN_SECRET`

## Optional
- `OPENAI_MODEL=gpt-5.6-luna`
- `WATCHLIST=AAPL,TSLA,NVDA,META`
- `FRONTEND_ORIGIN=https://<your-vercel-domain>`
- `PGSSLMODE=require`

## API
- `GET /health`
- `GET /api/market/AAPL`
- `GET /api/agents`
- `GET /api/latest/AAPL`
- `GET /api/leaderboard`
- `POST /api/run/AAPL` with header `x-run-secret`
