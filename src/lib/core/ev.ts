import { assertValidDecimalOdds, assertValidProbability } from "./probability";

/**
 * Expected value per 1 unit staked:  EV = odds × p − 1.
 * Example: odds 2.20, p = 0.49  →  EV = 0.078 (+7.8%).
 *
 * `p` must be an ESTIMATED TRUE probability (margin-free consensus or calibrated model),
 * never a raw implied probability from a bookmaker price.
 */
export function expectedValue(odds: number, probability: number): number {
  assertValidDecimalOdds(odds);
  assertValidProbability(probability);
  return odds * probability - 1;
}

/** Probability at which a price is exactly break-even (EV = 0): 1 / odds. */
export function breakEvenProbability(odds: number): number {
  assertValidDecimalOdds(odds);
  return 1 / odds;
}

/** Edge in probability points: p − 1/odds. Positive ⇔ EV positive. */
export function probabilityEdge(odds: number, probability: number): number {
  return probability - breakEvenProbability(odds);
}

/** Format a fraction as a signed percentage string, e.g. 0.078 → "+7.8%". */
export function formatPercent(x: number, decimals = 1): string {
  const v = (x * 100).toFixed(decimals);
  return x > 0 ? `+${v}%` : `${v}%`;
}

/**
 * Lines with a push outcome (whole-number Asian handicaps / totals) or split-stake
 * outcomes (quarter lines) do not have a simple binary payoff. When a two-way price is
 * de-vigged, the result is P(win | no push). The true EV for a whole line is then
 *   EV = P(no push) × (odds × P(win | no push) − 1),
 * i.e. the same sign, smaller magnitude. Without P(no push) we report the conditional EV
 * and flag it as approximate. Quarter lines are approximated the same way.
 */
export function expectedValueWithPush(odds: number, pWinGivenNoPush: number, pNoPush: number): number {
  if (!(pNoPush > 0 && pNoPush <= 1)) throw new RangeError("pNoPush must be in (0, 1]");
  return pNoPush * expectedValue(odds, pWinGivenNoPush);
}
