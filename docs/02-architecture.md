# Odds Intelligence: technical architecture

*Find the edge. Understand the odds.* This is an analytical decision-support tool. It does **not** place bets and promises no profit.

## 1. System overview

```
                ┌──────────────────────────── server side only (API keys) ───────────────────────────┐
 odds-api.io ──►│ OddsProvider adapters ─► Normaliser ─► Ingest worker ─► Postgres (Supabase)        │
 (REST/WS)      │  (odds-api-io, demo, …)   canonical     upsert_odds()     odds_current / changes   │
 API-Football ─►│ StatsProvider adapter     markets       closing capture   closing_lines            │
 football-data ►│ (Phase 4)                                lag detector      lag_observations         │
                │                                           value engine ──► recommendations (immutable)│
                │                                           settlement   ──► recommendation_results   │
                └────────────────────────────────────────────────────────────────────────────────────┘
                                                   │  Next.js route handlers / server components
                                                   ▼
                                     Next.js UI (Vercel). Supabase Auth, RLS
```

| Layer | Tech | Notes |
|---|---|---|
| UI | Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui, Recharts | Dark theme. Times shown in `Europe/Oslo` |
| API | Next.js route handlers (server only) | Never exposes provider keys. Reads from Postgres, not from providers |
| Worker | Node/TypeScript process (same repo, `src/worker`) | Hosted on Fly.io / Railway / Render. **Not Vercel functions**: polling is long-running. Supabase cron + Edge Functions is the fallback |
| DB | Supabase Postgres + Auth + RLS | Migrations in `supabase/migrations` |
| Core | `src/lib/core`: pure, framework-free, fully unit-tested | Shared by worker, API and scripts |

## 2. Repository layout

```
src/lib/core/        probability.ts  ev.ts  consensus.ts  confidence.ts  value-finder.ts  clv.ts  stats.ts  pipeline.ts
src/lib/markets/     types.ts (canonical market model)  derived.ts (double chance)
src/lib/providers/   types.ts (OddsProvider contract)
                     odds-api-io/{client,parse,mapping}.ts
                     demo/demo-provider.ts (synthetic, labelled DEMO)
scripts/             probe-odds-api-io.ts (Phase-1 gate)  demo-value-finder.ts
supabase/migrations/ 20261101000000_init.sql
tests/               unit + adapter integration (mocked HTTP) + migration (PGlite)
fixtures/            synthetic/ (hand-written, labelled)  recorded/ (probe output, gitignored)
```

## 3. Provider independence

`OddsProvider` (src/lib/providers/types.ts):

```ts
getEvents(q) · getOdds(eventIds, bookmakers) · getHistoricalOdds(eventId, bookmakers)
subscribeToUpdates?(…)   // optional, only implemented once verified per bookmaker
getProviderStatus()
```

- Adapters output **canonical** `OddsQuote`s: provider, event id, bookmaker, raw market name (for audit), `CanonicalMarket`, prices, `providerUpdatedAt`, `fetchedAt`, `settlementVerified`, `origin` (`LIVE_PROVIDER` | `DEMO`).
- Markets an adapter can't map are **returned as `unmapped`, never dropped silently**.
- Adding a provider means writing a new adapter plus mapping table. Nothing downstream changes.
- Cross-provider event identity goes through `event_provider_ids` (with `match_confidence`) and `team_aliases`. With Odds-API.io as the single source for Norsk Tipping and references, the core comparison shares one event ID, so fuzzy matching is only needed for the stats provider. Matching rule: normalised team names plus kick-off within ±15 min. Ambiguous matches are rejected, not guessed.

## 4. Canonical market model

`marketKey = sport|TYPE|PERIOD|line|team`, e.g. `football|TOTAL_GOALS|FT_REGULAR|2.5|-`.

- **Period encodes settlement scope.** `FT_REGULAR` (90' + stoppage) and `FT_INCL_ET` never share a key, so they can't be compared.
- AH lines are stored from the home team's perspective.
- Line types: `.5` is clean. Whole lines (push) and quarter lines (split stake) are flagged *approximate*. For those, the de-vigged two-way probability is P(win | no push), and the EV shown is conditional (same sign, magnitude overstated). See `expectedValueWithPush`.
- **Double chance** has overlapping outcomes and is *never* de-vigged directly. The fair DC probability is the sum of fair 1X2 probabilities (`markets/derived.ts`).
- Each provider mapping rule carries `verified`. It flips to `true` only after a human has compared the provider's settlement rules with Norsk Tipping's rules for that market.

## 5. Value engine (mathematics)

All of this is implemented in `src/lib/core` and covered by tests (`tests/*.test.ts`).

| Step | Formula / rule |
|---|---|
| Implied probability | `q = 1 / odds` (odds > 1 enforced) |
| Overround | `Σq − 1` |
| Margin removal (default) | Proportional: `p_i = q_i / Σq`. Power and Shin are available for research (they correct the favourite–longshot bias). The method is a config value and is stored with each recommendation |
| Reference filtering | Drop: the target book (Norsk Tipping), stale quotes (`age > maxAge`, default 120 s), incomplete or invalid price sets, overround > 15%, duplicates. With ≥4 books, also drop outliers: `|p − median| > max(4 pp, 4·MAD)` (catches line or market mismatches) |
| Weights | `w = reliability × 0.5^(age / 300 s)`. Reliability defaults: Pinnacle 3, Betfair Exchange 2.5, SBOBet/Singbet 2, others 1 (starting values) |
| Consensus | Linear opinion pool `p_j = Σ w_i p_ij / Σ w_i`, renormalised. Reported with n, Kish effective n `(Σw)²/Σw²`, weighted SD per outcome |
| Fair odds | `1 / p` |
| EV | `EV = odds_NT × p − 1` (spec example: 2.20 × 0.49 − 1 = **+7.8%**, which is a unit test) |
| Plausibility guard | EV > 25% is treated as a probable mismatch: INSUFFICIENT_DATA |

### 5.1 Confidence score (0–100): data reliability, not win probability

`score = 100 × Σ wᵢ·cᵢ / Σ wᵢ` over the components that are available:

| Component | Weight | cᵢ |
|---|---|---|
| coverage | 0.30 | `min(1, effectiveBooks / 6)` |
| freshness | 0.20 | `1 − worstAge / 120 s` |
| agreement | 0.25 | `1 − SD_selection / 3 pp` |
| sharpAnchor | 0.15 | 1 if Pinnacle/Betfair Exchange/… contributed, else 0.4 |
| marketClean | 0.10 | 1 clean · 0.6 push/quarter line · 0.5 unverified settlement |
| modelCalibration (Phase 4) | 0.15 | `1 − ECE / 0.10` |
| trackRecord (Phase 5) | 0.10 | `min(1, n/500) × clamp(0.5 + 10·meanCLV)` |

Without the model components, the score is labelled **"data-quality only"**. The breakdown is stored with each recommendation.

### 5.2 Categories (configurable starting thresholds, not proven optima)

| Category | Rule |
|---|---|
| INSUFFICIENT_DATA | < 3 reference books, stale target or reference, missing price, or EV > 25% |
| EXCELLENT_VALUE | EV ≥ 6% and confidence ≥ 80 |
| POTENTIAL_VALUE | EV ≥ 3% and confidence ≥ 65 |
| WATCHLIST | EV ≥ 1%, **or** any EV ≥ 1% on an unverified mapping (hard cap) |
| NO_VALUE | otherwise |

Every evaluation includes data-derived `reasons[]`: the price, the consensus and which books it came from, the EV arithmetic, the disagreement, the data age and any exclusions. No generated prose.

## 6. Odds storage and retention

- `odds_current`: one row per (event, book, market_key, outcome), upserted every poll.
- `odds_changes`: append-only, written by `upsert_odds()` **only when the price changes**. No duplicate snapshots. Each row stores `previous_odds`, `new_odds`, `provider_updated_at`, `observed_at` and `data_age_seconds`.
- `closing_lines`: captured at kick-off (last Norsk Tipping price plus margin-free consensus). Kept forever.
- `recommendations`: **immutable** (a trigger blocks UPDATE and DELETE). Unique per (selection, price, algorithm_version), so re-polls don't create duplicates. This includes recommendations nobody bet on, and losing ones.
- Retention: `prune_odds_changes('90 days')` keeps history only for events that have a recommendation. Run it daily.
- Indexes on (event, market, outcome, observed_at), starts_at, status, created_at.
- Partitioning `odds_changes` by month is deferred until volume calls for it (the probe will estimate it).

**Data age.** `age = now − providerUpdatedAt`. Open issue Q5: if `updatedAt` means *last change* rather than *last check*, an unchanged price that is still valid would look stale. In that case, age switches to *time since the provider last confirmed the price* (our `fetchedAt` from a successful poll that included that book). Every evaluation records which age source was used (`ageSource`).

## 7. Scheduling (worker)

| Job | Cadence | Notes |
|---|---|---|
| discover events | 15 min | `/events?sport=football&bookmaker=<NT>&status=pending` |
| odds poll, kick-off ≤ 3 h | 60 s | `/odds/multi` batches of 10 |
| odds poll, ≤ 24 h | 5 min | |
| odds poll, later | 30 min | |
| closing capture | at kick-off −1 min, then on status change | freezes `closing_lines` |
| evaluate & record | after every poll batch | writes `recommendations` when category ≥ WATCHLIST |
| settle | hourly | results from the stats provider, then `recommendation_results` (CLV, P/L) |
| health | every run | `sync_runs` (requests used, rate-limit headers, errors) |

Back-off: respect `Retry-After`. Exponential 2/4/8/16 s. A circuit breaker marks the provider unhealthy in the UI.

## 8. Market Lag Detector (Phase 3 design)

Built from `odds_changes`:

1. For each (event, market), keep a rolling margin-free reference consensus.
2. A **reference move** is a consensus change ≥ X% (relative, default 3%) within ≤ Y min (default 5). Record the first book to move and the time.
3. If the Norsk Tipping price hasn't moved in the same direction, open a `lag_observations` row and compute live EV against the new consensus.
4. Close it when Norsk Tipping adjusts (`target_adjusted_at`, generated `lag_seconds`) or the event starts.
5. Report lag distributions **per league, market and time-to-kick-off**, with n and quantiles. Make no claim from fewer than about 30 observations in a segment. This avoids "Norsk Tipping is slow" conclusions from single cases.

Caveat: lag is measured at our polling resolution (60 s at best). Lags shorter than the poll interval can't be observed.

## 9. Statistical models (Phase 4 design)

- Baseline: **independent Poisson** fitted to team attack and defence with home advantage, using time-decayed likelihood. Then **Dixon–Coles** with low-score correction (τ) and decay ξ.
- Elo as an interpretable team-strength feature. Logistic regression or GBM only once enough data exists **and** they beat Dixon–Coles out of sample.
- Training data: football-data.co.uk results (multi-season). Injuries and lineups from API-Football as adjustments, **only when the data exists**. Missing data is shown as missing.
- Validation: strictly chronological, walk-forward (refit weekly, predict the next round). Metrics: log-loss, Brier, calibration curve and ECE, all compared with the **closing market** (the benchmark to beat).
- Calibration: isotonic or Platt, fitted only on out-of-sample folds, and only if it improves held-out log-loss.
- Model and market disagreement is shown separately from market-consensus EV. The model never overrides the market silently.

## 10. Performance and CLV (Phase 5)

- CLV = `odds_taken × p_close − 1`, where `p_close` is the margin-free closing consensus (not Norsk Tipping's own close).
- Dashboards: n, hit rate (Wilson CI), P/L, ROI (CI), mean EV, mean odds, mean CLV, Brier and calibration. Split by league, market, EV bucket and confidence bucket. **Losing and non-bet recommendations are always included.** Demo data is excluded (`is_demo`).
- Interpretation rules shown in the UI: CLV is not profit. ROI CIs on small n are wide, and that's the honest picture.

## 11. Security, privacy, responsibility

- Provider keys live only in server env vars (`.env.example`). No `NEXT_PUBLIC_` prefix. Error messages are redacted (tested).
- Supabase RLS: user tables are owner-only. Market tables are read-only for `authenticated`. Writes happen only with the service role.
- No Norsk Tipping credentials, no automation against Norsk Tipping, no auto-betting.
- Optional spending and exposure limits (`user_settings`).
- Time: UTC everywhere in storage and logic. `Europe/Oslo` only at render time.

## 12. Testing strategy

| Layer | Tooling | Current |
|---|---|---|
| Math core | Vitest. Hand-computed reference values and property checks | ✅ |
| Adapter | Vitest. Mocked `fetch`, synthetic fixture (labelled), retry, 429, redaction, batching | ✅ |
| Recorded responses | Every file in `fixtures/recorded/odds-*.json` must parse | Activates after the probe |
| DB | PGlite (real Postgres in WASM) applies the migration and tests functions, triggers, views and constraints | ✅ |
| UI / e2e | Playwright | Phase 2 |

## 13. Known unknowns and risks

1. Norsk Tipping coverage depth on Odds-API.io (markets, lines, latency). **Probe.**
2. Meaning of `updatedAt`. **Probe.**
3. Settlement equivalence of each market mapping. **Manual check against Norsk Tipping rules.**
4. Odds-API.io terms on storage and display; Norwegian marketing rules for showing foreign odds. **Legal review before any public use.**
5. Reference-book selection is capped by the plan size. Consensus quality depends on buying enough slots.
6. Norsk Tipping may price some markets very differently because of its monopoly margin structure. Most evaluations will be NO_VALUE, and that's an expected, honest result.
