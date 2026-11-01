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

## Decision (2026-11-01): option A, free data

Odds-API.io (the only automated Norsk Tipping source) costs at least $65/month, so the MVP uses **manual Norsk Tipping entry plus The Odds API free plan** for reference odds. The provider architecture is unchanged, so switching to odds-api.io later is a configuration and adapter change.

## Phase 2A: MVP with manual Norsk Tipping entry (done)

- [x] The Odds API adapter (references), synthetic-fixture tests, credit tracking
- [x] Manual Norsk Tipping entry with typo detection (an implied total under 100% is rejected)
- [x] Value Finder: league → match → Norsk Tipping prices → EV / fair odds / confidence / category with "Why?"
- [x] Double chance calculated from the 1X2 consensus
- [x] Every evaluation recorded (immutable); odds history stored only on change
- [x] Watchlist; settlement from the 90-minute score; ROI / hit rate with CIs by category, EV range and confidence
- [x] Settings: thresholds; per-market settlement verification (caps at WATCHLIST until ticked)
- [x] Local PGlite DB (zero setup) or Postgres/Supabase via DATABASE_URL
- [x] Browser test of the full flow (Playwright, demo mode)
- [x] Run with a real THE_ODDS_API_KEY (2026-11-01): 47 active football leagues; EPL call returned 13 events, up to 24 bookmakers (Pinnacle, Betfair Exchange, Matchbook included), 2 credits per call, as documented. Response shape matched the parser. Regional duplicates (Unibet FR/NL/SE, Winamax FR/DE) are now collapsed. The recorded response is kept locally only (gitignored, licensed data)
- [ ] Verify The Odds API soccer h2h/totals settlement (90 min) → tick in Settings
- [ ] Optional "capture closing line" button (2 credits) to enable CLV in manual mode
- [ ] Supabase Auth when more than one user needs access

## Phase 2: Functional MVP with an automated Norsk Tipping feed (only if a paid feed is bought)

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
