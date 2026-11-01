# ODDS INTELLIGENCE
*Find the edge. Understand the odds.*

Compares Norsk Tipping (Oddsen) odds with a margin-free consensus of international bookmakers. It shows where Norsk Tipping's price looks better than the market implies, and records every evaluation so you can measure over time whether those flags hold up.

> Decision support only. No automated betting. No profit guarantees. No Norsk Tipping credentials are stored.

## How it works now (option A: free)

| Data | Source |
|---|---|
| Norsk Tipping odds | **Typed in by you** from the Oddsen app or site. Norsk Tipping has no public API, and the site is not scraped |
| Reference odds | **The Odds API**, free plan (500 credits/month). One league fetch = 2 credits (`eu` region × `h2h,totals`), cached for 90 s |
| Database | Local **PGlite** (real Postgres, in `./data/pglite`) by default, or Supabase/Postgres via `DATABASE_URL`. Same migrations |

Without `THE_ODDS_API_KEY`, the app runs on clearly labelled **DEMO** data.

## Run it

```bash
npm install
cp .env.example .env.local   # add THE_ODDS_API_KEY (free at https://the-odds-api.com)
npm run dev                  # http://localhost:3000
```

```bash
npm test          # math, adapters, settlement, DB migration, end-to-end service on PGlite
npm run typecheck
```

### Workflow
1. **Value Finder**: pick a league and match (lists are free, no credits), then type Norsk Tipping's odds for HUB, Over/Under and/or Double chance. Click **Evaluate**.
2. Read EV, fair odds, confidence and category, and open **Why?** for the full calculation.
3. **Settings**: once you have checked that a market settles the same way at Norsk Tipping and at The Odds API (90 minutes, push rules), tick it. Until then, results are capped at WATCHLIST.
4. **Historical Performance**: after the match, enter the 90-minute score. Every recorded evaluation is settled, and you get ROI and hit rate with confidence intervals, broken down by category, EV range and confidence.

## Pages

| Page | Status |
|---|---|
| Dashboard, Value Finder, Watchlist, Historical Performance, Settings | ✅ working |
| Odds Movement | ✅ log of price changes captured during evaluations (charts need continuous data) |
| Match Analyzer | Phase 4 (statistical model). Shows an explanation, no fake output |
| Coupon Builder | Phase 5. Shows an explanation, no fake output |

## Docs
- [Research](docs/01-research.md) · [Architecture](docs/02-architecture.md) · [Roadmap](docs/03-roadmap.md)
- Screenshots (demo data): [value finder](docs/screenshots/value-finder-demo.png), [dashboard](docs/screenshots/dashboard-demo.png), [history](docs/screenshots/history-demo.png), [mobile](docs/screenshots/mobile-value-finder.png)

## Hosting note
PGlite needs a persistent disk, so it works locally or on a VM, but not on Vercel serverless. To deploy on Vercel, set `DATABASE_URL` to a Supabase Postgres connection string. The migrations apply automatically on first start.
