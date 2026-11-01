import { assertValidDecimalOdds } from "./probability";

/**
 * Closing Line Value.
 *
 * CLV measures whether the price we took beat the market's final, best-informed estimate.
 * Benchmark: the MARGIN-FREE closing consensus probability of the same selection (not the
 * raw closing price of any one book, and not Norsk Tipping's own closing price).
 *
 *   clv = oddsTaken × pClose − 1         (equivalently oddsTaken / fairClosingOdds − 1)
 *
 * This is the EV the bet had if the closing consensus is the true probability. Positive CLV
 * over a large sample is evidence of an edge; it is NOT realised profit. Report it alongside
 * (never instead of) P/L and ROI.
 */
export function closingLineValue(oddsTaken: number, closingFairProbability: number): number {
  assertValidDecimalOdds(oddsTaken);
  if (!(closingFairProbability > 0 && closingFairProbability < 1)) throw new RangeError("closingFairProbability must be in (0,1)");
  return oddsTaken * closingFairProbability - 1;
}

/** Log-odds-ratio form, additive across bets: ln(oddsTaken / fairClosingOdds). */
export function logClv(oddsTaken: number, closingFairProbability: number): number {
  return Math.log(oddsTaken * closingFairProbability);
}

/** Percentage price movement from recommendation to close, e.g. 2.20 → 2.00 = −9.1%. */
export function priceMovement(oddsAtRecommendation: number, closingOdds: number): number {
  assertValidDecimalOdds(oddsAtRecommendation);
  assertValidDecimalOdds(closingOdds);
  return closingOdds / oddsAtRecommendation - 1;
}
