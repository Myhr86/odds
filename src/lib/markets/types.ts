/**
 * Canonical, provider-independent market model.
 *
 * Two prices are only comparable if their CanonicalMarket keys are identical, which
 * encodes sport, market type, period/settlement scope, line and team. Provider adapters
 * are responsible for mapping provider market names into this model and must declare
 * whether that mapping's settlement rules have been VERIFIED (see MarketMapping).
 */

export type Sport = "football";

export type MarketType =
  | "MATCH_RESULT" // 1X2
  | "DOUBLE_CHANCE" // derived from 1X2 – overlapping outcomes
  | "TOTAL_GOALS" // Over/Under
  | "BTTS" // Both teams to score
  | "ASIAN_HANDICAP"
  | "TEAM_TOTAL";

/**
 * Settlement scope. FT_REGULAR = 90 minutes + stoppage time, no extra time / penalties
 * (the standard for football pre-match markets). Never compare across scopes.
 */
export type Period = "FT_REGULAR" | "FT_INCL_ET" | "H1" | "H2";

export type Team = "home" | "away";

export interface CanonicalMarket {
  sport: Sport;
  type: MarketType;
  period: Period;
  /** Goal line for totals / handicap line from the HOME team's perspective for AH. */
  line?: number;
  /** Team for TEAM_TOTAL. */
  team?: Team;
}

export const OUTCOMES: Record<MarketType, readonly string[]> = {
  MATCH_RESULT: ["home", "draw", "away"],
  DOUBLE_CHANCE: ["home_draw", "home_away", "draw_away"],
  TOTAL_GOALS: ["over", "under"],
  BTTS: ["yes", "no"],
  ASIAN_HANDICAP: ["home", "away"],
  TEAM_TOTAL: ["over", "under"],
};

/** Markets whose outcomes are a partition (mutually exclusive & exhaustive) and can be de-vigged directly. */
export function isPartitionMarket(type: MarketType): boolean {
  return type !== "DOUBLE_CHANCE";
}

export type LineKind = "none" | "half" | "whole" | "quarter";

/** .5 lines have no push; whole lines can push; .25/.75 lines split the stake. */
export function lineKind(line: number | undefined): LineKind {
  if (line === undefined) return "none";
  const frac = Math.round(Math.abs(line * 100)) % 100;
  if (frac === 50) return "half";
  if (frac === 0) return "whole";
  if (frac === 25 || frac === 75) return "quarter";
  throw new RangeError(`Unsupported line ${line}`);
}

export function requiresLine(type: MarketType): boolean {
  return type === "TOTAL_GOALS" || type === "ASIAN_HANDICAP" || type === "TEAM_TOTAL";
}

export function validateMarket(m: CanonicalMarket): void {
  if (requiresLine(m.type) && m.line === undefined) throw new Error(`${m.type} requires a line`);
  if (!requiresLine(m.type) && m.line !== undefined) throw new Error(`${m.type} must not have a line`);
  if (m.type === "TEAM_TOTAL" && !m.team) throw new Error("TEAM_TOTAL requires a team");
  if (m.type !== "TEAM_TOTAL" && m.team) throw new Error(`${m.type} must not have a team`);
  if (m.line !== undefined) lineKind(m.line);
}

/** Stable string key, e.g. "football|TOTAL_GOALS|FT_REGULAR|2.5|-". Used for DB storage and joins. */
export function marketKey(m: CanonicalMarket): string {
  validateMarket(m);
  const line = m.line === undefined ? "-" : formatLine(m.line);
  return [m.sport, m.type, m.period, line, m.team ?? "-"].join("|");
}

export function parseMarketKey(key: string): CanonicalMarket {
  const [sport, type, period, line, team] = key.split("|");
  if (!sport || !type || !period || line === undefined || team === undefined) throw new Error(`Bad market key: ${key}`);
  const m: CanonicalMarket = { sport: sport as Sport, type: type as MarketType, period: period as Period };
  if (line !== "-") m.line = Number(line);
  if (team !== "-") m.team = team as Team;
  validateMarket(m);
  return m;
}

function formatLine(line: number): string {
  // Normalise -0 and float noise: 2.50000001 -> "2.5"
  const r = Math.round(line * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
}

/** A price set for one market at one bookmaker at one moment. */
export interface MarketPrices {
  market: CanonicalMarket;
  /** outcome -> decimal odds. Must contain all OUTCOMES[type] to be complete. */
  prices: Record<string, number>;
}

export function isComplete(mp: MarketPrices): boolean {
  return OUTCOMES[mp.market.type].every((o) => {
    const v = mp.prices[o];
    return typeof v === "number" && Number.isFinite(v) && v > 1;
  });
}
