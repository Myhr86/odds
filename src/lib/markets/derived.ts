/**
 * Markets derived from margin-free partition markets.
 * Double Chance outcomes overlap (each outcome of 1X2 appears in two DC selections), so a
 * DC price set must never be de-vigged by normalising to 1. Instead the fair DC probability
 * is the sum of the relevant fair 1X2 probabilities.
 */
export interface FairMatchResult {
  home: number;
  draw: number;
  away: number;
}

export function doubleChanceFromMatchResult(p: FairMatchResult): { home_draw: number; home_away: number; draw_away: number } {
  const s = p.home + p.draw + p.away;
  if (Math.abs(s - 1) > 1e-6) throw new RangeError(`1X2 probabilities must sum to 1 (got ${s})`);
  return { home_draw: p.home + p.draw, home_away: p.home + p.away, draw_away: p.draw + p.away };
}
