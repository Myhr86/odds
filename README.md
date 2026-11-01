# ODDS INTELLIGENCE
*Find the edge. Understand the odds.*

An analytics platform that compares Norsk Tipping (Oddsen) pre-match odds with a margin-free consensus of international bookmakers. It flags prices that look better than the market implies, and tracks over time whether those flags hold up (CLV, ROI, calibration).

> Decision support only. No automated betting. No profit guarantees. Norsk Tipping prices come from an independent third-party aggregator, not from an official Norsk Tipping API.

## Status: Phase 1 (research and validation)

| | |
|---|---|
| Research | [docs/01-research.md](docs/01-research.md) |
| Architecture | [docs/02-architecture.md](docs/02-architecture.md) |
| Roadmap | [docs/03-roadmap.md](docs/03-roadmap.md) |

Live provider data is **not yet verified**. Run the probe first (below).

## Quick start

```bash
npm install
npm test            # math core, adapter (mocked HTTP), migration on real Postgres (PGlite)
npm run typecheck
npm run demo:value  # full pipeline on clearly labelled SYNTHETIC data
```

### Verify Odds-API.io coverage (Phase 2 gate)

```bash
cp .env.example .env   # add ODDS_API_IO_KEY
set -a; . ./.env; set +a
npm run probe:odds-api-io -- --events 5
```

The probe answers Q1–Q7 in `docs/01-research.md` §6. It writes raw responses to `fixtures/recorded/`, which is gitignored. The test suite then parses every recorded response automatically.
