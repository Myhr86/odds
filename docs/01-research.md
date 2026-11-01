# Phase 1: Data source research and validation

**Date:** 2026-11-01. **Status:** desk research done. Live verification has started (§0.1). Calls that need a key are still open.

> **Evidence levels used in this document**
> - **[DOC]**: stated in the provider's own documentation, seen through search-engine extracts of their pages.
> - **[3P]**: stated by a third party, often a competing vendor, so possibly biased.
> - **[PRIOR]**: from the author's prior knowledge. Not re-checked this session.
> - **[UNVERIFIED]**: unknown until we make a real API call.
>
> No API capability below is marked as verified, because no live call could be made (§0).

## 0. Verification constraint (read first)

The build environment's network policy blocked outbound HTTPS to every data provider: `odds-api.io`, `api.odds-api.io`, `docs.odds-api.io`, `v3.football.api-sports.io`, `api.the-odds-api.com` and `football-data.co.uk`. Only the npm registry was reachable at first. So:

- the research below comes from web-search extracts of provider pages, not from direct page loads or API calls;
- a ready-to-run **verification probe** (`npm run probe:odds-api-io`) records real responses and answers the open questions Q1–Q7. Run it on a machine with network access and an API key. **Phase 2 must not start until it has passed.**

### 0.1 Live verification log

After the network policy was opened (2026-11-01), these **keyless** endpoints were called for real. They are marked **[LIVE]**:

| Check | Result |
|---|---|
| `GET /v3/bookmakers` | 488 bookmakers. Objects have `name`, `active`, `createdAt`, `status`, `reason` |
| **Q1: Norsk Tipping** | ✅ **`"Norsk Tipping"`**, `active: true`, `status: "ok"` |
| **Q2: reference books** | ✅ `Betfair Exchange`, `Sbobet`, `SingBet` (plus `SingBet A–D`), `Bet365`, `Unibet`, `William Hill`, `Marathonbet`, `1xbet`, `Bwin`, `Betsson`, `NordicBet`, `Coolbet`, `Interwetten`, `Polymarket`. ❌ **Pinnacle is not offered by Odds-API.io** |
| `GET /v3/sports` | Football slug `football` |

**Consequence:** the sharp anchors are **Betfair Exchange (weight 3), Sbobet (2.5) and SingBet (2.5)**, and the defaults have been updated. Pinnacle remains a candidate through a second, reference-only provider (The Odds API, EU region) if the consensus turns out weak.

Still open: Q3–Q7 need an API key.

## 1. Norsk Tipping: is there an official API?

- **No public developer API for Oddsen was found.** [3P] A third-party scraper listing (parse.bot) says outright that Norsk Tipping "does not publish a documented public developer API" for Oddsen. A Norwegian open-source project discussion (GitHub `runevangen/sb#194`, Sept 2026) reached the same conclusion.
- **Consequence:** every Norsk Tipping price we use will come through a third-party aggregator. That source is **independent and unofficial**, and the UI must say so.
- **Scraping norsk-tipping.no ourselves: not recommended.** I could not find Norsk Tipping's terms on automated access in this session. The site is also a frequent DDoS target, so it is likely to have strong bot protection. Scraping would conflict with the brief ("never bypass platform protections"). The parse.bot "Norsk Tipping Oddsen API" is scraper-based and covers 1X2 only. It is rejected for the same reason.

## 2. Odds providers

### 2.1 Odds-API.io (primary candidate)

| Item | Finding | Evidence |
|---|---|---|
| Norsk Tipping listed | Exact name `Norsk Tipping`, active | **[LIVE]** |
| Dedicated Norsk Tipping page (markets, pre-match or live) | **Not retrievable.** No per-market coverage confirmed | [UNVERIFIED] |
| Base URL / auth | `https://api.odds-api.io/v3`, `apiKey` query parameter | [DOC] |
| Endpoints | `/bookmakers`, `/sports` (usable without a key), `/events` (`sport`, `league`, `status`, `bookmaker`, `limit`), `/odds?eventId=&bookmakers=`, `/odds/multi?eventIds=` (≤10 events, billed as one request), `/historical/events`, `/historical/odds`, `/historical/closing-lines` (paid) | [DOC] |
| Response shape | Markets nested under `bookmakers.<Name>[]` with `name`, `updatedAt`, `odds[]`. Lines in `hdp`. Fields are `home/draw/away` and `over/under` | [DOC]; field types differ between examples |
| Market names | `ML`, `Spread`, `Totals`, `Spread HT`, `Totals HT`, `Team Total Home/Away`, plus corners, cards and props | [DOC] |
| `updatedAt` format | ISO string in some examples, epoch-ms in others | [DOC]. Parser handles both |
| **Does `updatedAt` mean last price *change* or last *check*?** | Unknown. This decides how "data age" is computed | [UNVERIFIED], **critical** |
| Settlement scope of football `ML` (90 min or incl. extra time) | Unknown | [UNVERIFIED], **critical** |
| Handicap sign convention of `hdp` in `Spread` | Unknown | [UNVERIFIED] |
| BTTS / Double Chance market names | Not found in docs | [UNVERIFIED] |
| `markets` parameter | An SDK note says it became required on odds endpoints from 15 Oct 2026 | [DOC-SDK], unconfirmed |
| WebSocket | `wss://api.odds-api.io/v3/ws`. Paid plans only, at 2× the REST price. Only pushes the bookmakers selected on the account | [DOC]. **Norsk Tipping availability on WS unverified** |
| Plans | Priced by **number of selected bookmakers**: Solo 2, Starter 5, Growth 10, Pro 15. Paid plans: 5,000 requests/hour, no monthly cap | [DOC/3P] |
| Prices | Conflicting: "from £49/mo", "from $65/mo", and Starter £99 / Growth £179 / Pro £229 | [DOC/3P]. **Check the live pricing page** |
| Free tier | **New free keys paused since 27 Aug 2026.** Existing ones: 100 req/h, 2 bookmakers | [DOC] |

**Key design implication:** the bookmaker cap **counts Norsk Tipping itself**. The brief requires at least 3 independent reference books, so we need at least 4 slots, which means **Starter (5) or more**. A solid consensus with sharp anchors needs **Growth (10)**: Norsk Tipping + Betfair Exchange + Sbobet + SingBet + Bet365 + Unibet + 3–4 others. Pinnacle is not available here [LIVE].

### 2.2 Alternatives considered

| Provider | Norsk Tipping? | Role | Notes |
|---|---|---|---|
| **The Odds API** (the-odds-api.com) | Not confirmed | Reference-only fallback | Regions us/uk/eu/au. The EU region includes `pinnacle` and `betfair_ex_eu` [DOC]. Their docs note Pinnacle odds come from the public website and may lag. Credit-based billing (markets × regions per call; historical 10×) [3P] |
| **OddsPapi** (oddspapi.io) | Not confirmed | Reference / historical | Claims 348–370 books including Pinnacle, and historical odds on a free tier (~250 req/month) [vendor blog] |
| **SportsDataIO** | Unlikely | Not suitable | Focused on US sportsbooks. No public pricing (sales-gated) [3P] |
| **Sportradar / OpticOdds / BoltOdds** | Unknown | Enterprise only | Cost is out of scope for the MVP |
| **parse.bot Norsk Tipping scraper** | Yes (1X2 only) | **Rejected** | Scraping-based, unofficial, too narrow |
| **API-Football odds** | Unknown | Not for value finding | [3P, competitor] Pre-match only, refreshed about daily, limited bookmakers. Too slow for EV |

## 3. Football statistics providers

| Source | Use | Findings |
|---|---|---|
| **API-Football** (api-sports.io) | Fixtures, results, lineups, injuries, H2H, standings | [3P] Free 100 req/day. Pro ~$19 (7,500/day), Ultra ~$29 (75k/day), Mega ~$39 (150k/day). All endpoints on all plans. Auth header `x-apisports-key`. **xG availability unconfirmed** |
| **football-data.co.uk** | Free historical results + odds CSVs (model training, CLV backtests) | [3P] FT/HT results, match stats, 1X2/OU/AH odds for major leagues. [PRIOR] includes Pinnacle opening and closing columns, which makes it a good closing-line benchmark. Verify the column list |
| **SportMonks** | Possible xG source | [PRIOR] Offers xG as an add-on. Pricing unverified |

**Phase 4 plan:** API-Football supplies fixtures, injuries and lineups. football-data.co.uk supplies multi-season results plus closing odds to train and walk-forward-validate the Poisson / Dixon-Coles models. xG is optional until we confirm a licensed source.

## 4. Legal and terms considerations (not legal advice)

1. **Norwegian gambling law.** Norsk Tipping holds the state monopoly. [PRIOR] The Gambling Act (*pengespilloven*) bans marketing gambling that isn't licensed in Norway. If we **display foreign bookmakers' names, odds or links publicly**, that could count as marketing. **Mitigation for the MVP:** private, authenticated use only. Show the *consensus/fair* price. Never link to foreign bookmakers. Make individual reference-book names an admin-only setting. **Get Norwegian legal advice before any public launch.**
2. **Provider terms.** Odds-API.io's terms (odds-api.io/terms) must be checked for display and redistribution rights, and for caching and retention limits, before storing historical odds long-term.
3. **No automation against Norsk Tipping.** No login and no stored credentials. No automated bet placement or deep-linked coupons that bypass the user. This is per the brief.
4. **Responsible gambling.** Optional limits are in the schema (`user_settings`). No "chase" features.

## 5. Recommended provider combination

| Need | Recommendation | Why |
|---|---|---|
| Norsk Tipping + reference odds | **Odds-API.io, Growth plan (10 books)**, REST polling via `/odds/multi` | The only provider that lists Norsk Tipping. One event ID across all books means no cross-provider matching is needed for the core comparison |
| Reference odds fallback | The Odds API (EU region), only if Odds-API.io's reference coverage is weak | Pinnacle and Betfair Exchange available |
| Stats (fixtures, injuries, lineups) | API-Football Pro (~$19/mo) | Cheap and broad. Free tier for development |
| Historical training data | football-data.co.uk CSVs | Free. Includes closing odds |

**Estimated MVP data cost:** about £180–230/month for odds (Growth), plus about $19/month for stats. Confirm before buying.

**Polling budget (5,000 req/h):** one `/odds/multi` call covers 10 events. Say Norsk Tipping lists N football events (N is unknown, so the probe measures it). Tiered polling, with K₃ events kicking off within 3 h and K₂₄ within 24 h:
- kick-off within 3 h: every 60 s → `60 × ceil(K₃/10)` req/h
- kick-off within 24 h: every 5 min → `12 × ceil(K₂₄/10)` req/h
- later: every 30 min → `2 × ceil(N/10)` req/h

With K₃=60, K₂₄=300, N=800: 360 + 360 + 160 = **880 req/h**, well within budget. WebSocket costs 2× and isn't needed at this scale. Revisit it only if Norsk Tipping is confirmed on the socket **and** latency matters for the Market Lag Detector.

## 6. Open questions the probe must answer (Phase 2 gate)

| # | Question | Blocks |
|---|---|---|
| Q1 | Exact Norsk Tipping bookmaker name in `/bookmakers` | Everything |
| Q2 | Which reference books (Pinnacle, Betfair Exchange, …) are available on our plan | Consensus quality |
| Q3 | Count of upcoming football events Norsk Tipping prices | Cost / polling plan |
| Q4 | Norsk Tipping markets and lines and their field names (incl. BTTS, Double Chance) | Market support list |
| Q5 | `updatedAt` presence and meaning (last change or last check); typical ages | Staleness rules |
| Q6 | Market names our adapter doesn't map | Mapping table |
| Q7 | Rate-limit headers | Scheduler back-off |
| Q8 (manual) | Settlement of `ML` (90 min?), `hdp` sign convention, push rules, compared with Norsk Tipping's own rules on norsk-tipping.no | Setting `verified: true` on mappings |

Until Q8 is resolved, every mapping is `verified: false`, and the Value Finder caps results at **WATCHLIST**. This is enforced in code and covered by tests.

## Sources

- [Odds-API.io bookmaker directory](https://odds-api.io/sportsbooks) · [Pricing](https://odds-api.io/pricing) · [Free tier notice](https://odds-api.io/pricing/free) · [Terms](https://odds-api.io/terms)
- [Odds-API.io API reference](https://docs.odds-api.io/api-reference/introduction) · [WebSockets](https://docs.odds-api.io/guides/websockets) · [Historical](https://docs.odds-api.io/guides/historical) · [Best practices](https://docs.odds-api.io/guides/best-practices) · [Dropping odds](https://docs.odds-api.io/guides/dropping-odds) · [Python SDK (PyPI)](https://pypi.org/project/odds-api-io/1.1.0/)
- [parse.bot – Norsk Tipping Oddsen API](https://parse.bot/marketplace/7caef9ed-2972-47a8-bc1c-571e0efd9bc2/norsk-tipping-no-api) · [GitHub runevangen/sb#194](https://github.com/runevangen/sb/issues/194)
- [The Odds API – bookmakers](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) · [SportsGameOdds comparison](https://sportsgameodds.com/compare/the-odds-api)
- [OddsPapi blog](https://oddspapi.io/blog/?p=2479) · [OddsPapi on API-Football odds](https://oddspapi.io/blog/?p=3128) · [OddsPapi on SportsDataIO](https://oddspapi.io/blog/?p=2943) · [sportsapis.dev SportsDataIO review](https://sportsapis.dev/apis/sportsdata-io)
- [API-Football tiers (getbruin)](https://getbruin.com/docs/ingestr/soccer-sources/api-football.html) · [Highlightly – football APIs 2026](https://highlightly.net/blogs/best-football-apis-in-2026) · [api-football v3 endpoint list (skills.sh)](https://skills.sh/silkyland/thscore-api-skill/api-football-v3)
- [soccerdata – football-data.co.uk MatchHistory](https://soccerdata.readthedocs.io/en/latest/datasources/MatchHistory.html)
