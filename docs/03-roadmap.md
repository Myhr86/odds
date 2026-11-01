# Roadmap

## Phase 1: Research and validation (this delivery)

- [x] Provider research: Odds-API.io, The Odds API, OddsPapi, SportsDataIO, API-Football, football-data.co.uk (`01-research.md`)
- [x] Technical architecture (`02-architecture.md`)
- [x] Math core with tests: implied probability, overround, margin removal (proportional / power / Shin), weighted consensus with outlier rejection, EV, push-adjusted EV, double-chance derivation, confidence score, categories, CLV, Wilson CI, ROI CI, Brier, log-loss, calibration/ECE
- [x] Provider contract + Odds-API.io adapter (tolerant parser, batching, retry/back-off, key redaction) + DEMO provider
- [x] Supabase migration, tested on real Postgres (PGlite)
- [x] Verification probe script
- [ ] **GATE: run `npm run probe:odds-api-io` with a real key on a machine with network access**, then review answers Q1–Q7
- [ ] **GATE: manual settlement check (Q8)** for each market to be enabled. Set `verified: true` in `mapping.ts` only for those that pass
- [ ] Buy the plan (expected: Odds-API.io Growth) after the probe confirms Norsk Tipping coverage

## Phase 2: Functional MVP (starts after the gate)

1. Next.js app shell (dark theme, navigation for all 8 sections, Supabase Auth)
2. Ingest worker: event discovery and tiered odds polling, then `upsert_odds`, plus `sync_runs` health
3. Value Finder page: filters (league, date, min EV, min confidence, market, odds range), ranked list with the "why" panel, EV and confidence shown separately, provider and age badges, DEMO banner when applicable
4. Recommendation recording (immutable)
5. Watchlist
6. Dashboard: today's matches, top opportunities, provider health, last successful sync
7. Playwright smoke tests. Recorded-fixture parser tests

## Phase 3: Odds intelligence

Odds-movement charts (Recharts), closing-line capture, Market Lag Detector (§8), freshness monitoring, retention job.

## Phase 4: Statistical intelligence

API-Football adapter, football-data.co.uk loader, Poisson to Dixon–Coles with walk-forward validation and calibration, Match Analyzer, model components in the confidence score.

## Phase 5: Performance and optimisation

Settlement, CLV, performance dashboard with CIs by segment, model evaluation versus the closing market, Coupon Builder (correlation-aware, warns on same-match selections), PWA.
