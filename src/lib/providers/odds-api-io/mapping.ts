import type { CanonicalMarket, MarketType, Period } from "../../markets/types";

/**
 * odds-api.io market name → canonical market.
 *
 * Source of names: public docs list "ML, Spread, Totals, Spread HT, Totals HT, Team Total Home,
 * Team Total Away, …" (docs.odds-api.io, accessed via search 2026-11-01). Field names `hdp`,
 * `home`/`draw`/`away`, `over`/`under` come from documented examples.
 *
 * EVERY mapping starts with verified=false. A mapping may be set to verified=true only after:
 *   1. `npm run probe:odds-api-io` has recorded real responses for Norsk Tipping AND the reference
 *      books, and
 *   2. a human has confirmed the settlement scope (90 min vs. incl. extra time), the handicap sign
 *      convention, and that Norsk Tipping's Oddsen market of the same name settles identically.
 * Unverified mappings are capped at WATCHLIST by the value finder.
 */
export interface MappingRule {
  type: MarketType;
  period: Period;
  team?: "home" | "away";
  /** Provider odds-entry field -> canonical outcome. */
  fields: Record<string, string>;
  /** Provider field containing the line, if any. */
  lineField?: string;
  /** For AH: multiply provider hdp by this to get the HOME-perspective line. UNVERIFIED (assumed +1). */
  lineSign?: 1 | -1;
  /** Requires a draw field to be present (distinguishes 1X2 from 2-way moneyline). */
  requireFields?: string[];
  verified: boolean;
  note?: string;
}

export const ODDS_API_IO_MARKETS: Record<string, MappingRule[]> = {
  ML: [
    {
      type: "MATCH_RESULT",
      period: "FT_REGULAR",
      fields: { home: "home", draw: "draw", away: "away" },
      requireFields: ["home", "draw", "away"],
      verified: false,
      note: "Assumed 90-minute result for football. Must be confirmed (cup ties!).",
    },
  ],
  "ML HT": [{ type: "MATCH_RESULT", period: "H1", fields: { home: "home", draw: "draw", away: "away" }, requireFields: ["home", "draw", "away"], verified: false }],
  Totals: [{ type: "TOTAL_GOALS", period: "FT_REGULAR", fields: { over: "over", under: "under" }, lineField: "hdp", verified: false }],
  "Totals HT": [{ type: "TOTAL_GOALS", period: "H1", fields: { over: "over", under: "under" }, lineField: "hdp", verified: false }],
  Spread: [{ type: "ASIAN_HANDICAP", period: "FT_REGULAR", fields: { home: "home", away: "away" }, lineField: "hdp", lineSign: 1, verified: false, note: "Sign convention of hdp unverified." }],
  "Spread HT": [{ type: "ASIAN_HANDICAP", period: "H1", fields: { home: "home", away: "away" }, lineField: "hdp", lineSign: 1, verified: false }],
  "Team Total Home": [{ type: "TEAM_TOTAL", period: "FT_REGULAR", team: "home", fields: { over: "over", under: "under" }, lineField: "hdp", verified: false }],
  "Team Total Away": [{ type: "TEAM_TOTAL", period: "FT_REGULAR", team: "away", fields: { over: "over", under: "under" }, lineField: "hdp", verified: false }],
  // Name not confirmed in docs; candidates kept so the probe can report a hit.
  "Both Teams To Score": [{ type: "BTTS", period: "FT_REGULAR", fields: { yes: "yes", no: "no" }, verified: false, note: "Market name unconfirmed." }],
  BTTS: [{ type: "BTTS", period: "FT_REGULAR", fields: { yes: "yes", no: "no" }, verified: false, note: "Market name unconfirmed." }],
};

export function toCanonical(rule: MappingRule, line: number | undefined): CanonicalMarket {
  const m: CanonicalMarket = { sport: "football", type: rule.type, period: rule.period };
  if (rule.lineField !== undefined && line !== undefined) m.line = line * (rule.lineSign ?? 1);
  if (rule.team) m.team = rule.team;
  return m;
}
