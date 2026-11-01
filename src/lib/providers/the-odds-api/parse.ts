import { z } from "zod";
import { lineKind, type CanonicalMarket } from "../../markets/types";
import type { OddsQuote, OddsResult, ProviderEvent, UnmappedMarket } from "../types";

/**
 * The Odds API (the-odds-api.com) v4 response parsing.
 *
 * Shape per v4 docs [PRIOR knowledge + docs extracts 2026-11-01, re-verify with a recorded response]:
 *   event: { id, sport_key, sport_title, commence_time, home_team, away_team,
 *            bookmakers?: [{ key, title, last_update, markets: [{ key, last_update?, outcomes: [{ name, price, point? }] }] }] }
 *   h2h outcomes are named by team (home_team / away_team) plus "Draw" for soccer.
 *   totals outcomes "Over"/"Under" with point; spreads outcomes are team names with point (that team's handicap);
 *   btts "Yes"/"No"; draw_no_bet outcomes are team names.
 *
 * Every mapping is settlement-UNVERIFIED (90 min vs. incl. extra time not confirmed in docs).
 */
export const PROVIDER = "the-odds-api";

const Outcome = z.object({ name: z.string(), price: z.number(), point: z.number().optional() }).passthrough();
const Market = z.object({ key: z.string(), last_update: z.string().optional(), outcomes: z.array(Outcome) }).passthrough();
const Bookmaker = z.object({ key: z.string(), title: z.string(), last_update: z.string().optional(), markets: z.array(Market) }).passthrough();
export const TheOddsApiEvent = z
  .object({
    id: z.string(),
    sport_key: z.string(),
    sport_title: z.string().optional(),
    commence_time: z.string(),
    home_team: z.string().nullable(),
    away_team: z.string().nullable(),
    bookmakers: z.array(Bookmaker).optional(),
  })
  .passthrough();

export const TheOddsApiSport = z.object({ key: z.string(), group: z.string(), title: z.string(), description: z.string().optional(), active: z.boolean(), has_outrights: z.boolean().optional() }).passthrough();
export type TheOddsApiSport = z.infer<typeof TheOddsApiSport>;

/** Canonical display names so the consensus can de-duplicate regional copies (e.g. Betfair EU/UK). */
export const BOOKMAKER_NAMES: Record<string, string> = {
  pinnacle: "Pinnacle",
  betfair_ex_eu: "Betfair Exchange",
  betfair_ex_uk: "Betfair Exchange",
  betfair_ex_au: "Betfair Exchange",
  matchbook: "Matchbook",
  williamhill: "William Hill",
  unibet_eu: "Unibet",
  unibet_uk: "Unibet",
  onexbet: "1xbet",
  marathonbet: "Marathonbet",
  nordicbet: "NordicBet",
  betsson: "Betsson",
  coolbet: "Coolbet",
  sport888: "888sport",
  betclic: "Betclic",
};

export function bookmakerName(key: string, title: string): string {
  return BOOKMAKER_NAMES[key] ?? title;
}

export function parseEvent(raw: unknown): ProviderEvent {
  const e = TheOddsApiEvent.parse(raw);
  const d = new Date(e.commence_time);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad commence_time ${e.commence_time}`);
  if (!e.home_team || !e.away_team) throw new Error(`Event ${e.id} lacks team names (outright?)`);
  return {
    provider: PROVIDER,
    providerEventId: e.id,
    sport: e.sport_key.startsWith("soccer") ? "football" : e.sport_key.split("_")[0]!,
    league: { name: e.sport_title ?? e.sport_key, slug: e.sport_key },
    home: e.home_team,
    away: e.away_team,
    startsAt: d.toISOString(),
    status: "scheduled",
    origin: "LIVE_PROVIDER",
  };
}

type Rule = { market: (o: z.infer<typeof Outcome>[]) => CanonicalMarket | null; outcomes: (o: z.infer<typeof Outcome>, home: string, away: string) => string | null };

const RULES: Record<string, Rule> = {
  h2h: {
    market: (os) => (os.some((o) => o.name === "Draw") ? { sport: "football", type: "MATCH_RESULT", period: "FT_REGULAR" } : null),
    outcomes: (o, h, a) => (o.name === h ? "home" : o.name === a ? "away" : o.name === "Draw" ? "draw" : null),
  },
  totals: {
    market: (os) => (os[0]?.point !== undefined && os.every((o) => o.point === os[0]!.point) ? { sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR", line: os[0]!.point } : null),
    outcomes: (o) => (o.name === "Over" ? "over" : o.name === "Under" ? "under" : null),
  },
  btts: {
    market: () => ({ sport: "football", type: "BTTS", period: "FT_REGULAR" }),
    outcomes: (o) => (o.name === "Yes" ? "yes" : o.name === "No" ? "no" : null),
  },
  draw_no_bet: {
    // DNB ≡ Asian handicap 0 (stake returned on a draw).
    market: () => ({ sport: "football", type: "ASIAN_HANDICAP", period: "FT_REGULAR", line: 0 }),
    outcomes: (o, h, a) => (o.name === h ? "home" : o.name === a ? "away" : null),
  },
};

export function parseOddsEvent(raw: unknown, fetchedAt: string): OddsResult {
  const e = TheOddsApiEvent.parse(raw);
  const event = parseEvent(raw);
  const quotes: OddsQuote[] = [];
  const unmapped: UnmappedMarket[] = [];
  for (const b of e.bookmakers ?? []) {
    const name = bookmakerName(b.key, b.title);
    for (const m of b.markets) {
      if (m.key === "spreads") {
        // Spreads: outcomes carry each team's own handicap; home line = home outcome's point.
        const home = m.outcomes.find((o) => o.name === event.home);
        const away = m.outcomes.find((o) => o.name === event.away);
        if (!home || !away || home.point === undefined || away.point === undefined || home.point !== -away.point) {
          unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: "inconsistent spread points", sample: m.outcomes });
          continue;
        }
        try {
          lineKind(home.point);
        } catch {
          unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: `unsupported line ${home.point}` });
          continue;
        }
        quotes.push(quote(event, name, m.key, { sport: "football", type: "ASIAN_HANDICAP", period: "FT_REGULAR", line: home.point }, { home: home.price, away: away.price }, m.last_update ?? b.last_update, fetchedAt));
        continue;
      }
      const rule = RULES[m.key];
      if (!rule) {
        unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: "no mapping rule" });
        continue;
      }
      const market = rule.market(m.outcomes);
      if (!market) {
        unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: "market shape not supported", sample: m.outcomes });
        continue;
      }
      if (market.line !== undefined) {
        try {
          lineKind(market.line);
        } catch {
          unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: `unsupported line ${market.line}` });
          continue;
        }
      }
      const prices: Record<string, number> = {};
      let ok = true;
      for (const o of m.outcomes) {
        const k = rule.outcomes(o, event.home, event.away);
        if (!k || !(o.price > 1)) {
          ok = false;
          break;
        }
        prices[k] = o.price;
      }
      if (!ok) {
        unmapped.push({ bookmaker: name, providerMarketName: m.key, reason: "unrecognised outcome or invalid price", sample: m.outcomes });
        continue;
      }
      quotes.push(quote(event, name, m.key, market, prices, m.last_update ?? b.last_update, fetchedAt));
    }
  }
  return { event, quotes, unmapped };
}

function quote(event: ProviderEvent, bookmaker: string, providerMarketName: string, market: CanonicalMarket, prices: Record<string, number>, updated: string | undefined, fetchedAt: string): OddsQuote {
  const d = updated ? new Date(updated) : null;
  return {
    provider: PROVIDER,
    providerEventId: event.providerEventId,
    bookmaker,
    providerMarketName,
    market,
    prices,
    providerUpdatedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
    fetchedAt,
    settlementVerified: false,
    origin: "LIVE_PROVIDER",
  };
}
