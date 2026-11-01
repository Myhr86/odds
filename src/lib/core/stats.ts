/**
 * Performance statistics with explicit uncertainty. Every reported rate must carry its n
 * and an interval; small samples must look uncertain in the UI.
 */

/** Wilson score interval for a binomial proportion (default 95%). */
export function wilsonInterval(successes: number, n: number, z = 1.959964): { p: number; lower: number; upper: number } {
  if (n <= 0) return { p: NaN, lower: 0, upper: 1 };
  if (successes < 0 || successes > n) throw new RangeError("successes must be in [0, n]");
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

export type BetOutcome = "win" | "loss" | "push" | "half_win" | "half_loss" | "void";

/** Profit for a 1-unit stake at decimal odds. */
export function unitProfit(odds: number, outcome: BetOutcome): number {
  switch (outcome) {
    case "win":
      return odds - 1;
    case "loss":
      return -1;
    case "half_win":
      return (odds - 1) / 2;
    case "half_loss":
      return -0.5;
    case "push":
    case "void":
      return 0;
  }
}

export interface RoiSummary {
  n: number;
  staked: number;
  profit: number;
  roi: number;
  /** Normal-approximation 95% CI for mean per-unit return. Wide for small n – by design. */
  roiLower: number;
  roiUpper: number;
  standardError: number;
}

/** ROI of flat 1-unit stakes; voids/pushes count as zero-return bets but stake is refunded so excluded from staked. */
export function roiSummary(bets: ReadonlyArray<{ odds: number; outcome: BetOutcome }>, z = 1.959964): RoiSummary {
  const settled = bets.filter((b) => b.outcome !== "void" && b.outcome !== "push");
  const r = settled.map((b) => unitProfit(b.odds, b.outcome));
  const n = r.length;
  const profit = r.reduce((a, b) => a + b, 0);
  if (n === 0) return { n: 0, staked: 0, profit: 0, roi: NaN, roiLower: NaN, roiUpper: NaN, standardError: NaN };
  const mean = profit / n;
  const variance = n > 1 ? r.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : NaN;
  const se = Math.sqrt(variance / n);
  return { n, staked: n, profit, roi: mean, roiLower: mean - z * se, roiUpper: mean + z * se, standardError: se };
}

/** Brier score for binary outcomes: mean (p − y)². Lower is better. */
export function brierScore(preds: ReadonlyArray<{ p: number; y: 0 | 1 }>): number {
  if (!preds.length) return NaN;
  return preds.reduce((a, { p, y }) => a + (p - y) ** 2, 0) / preds.length;
}

/** Mean negative log-likelihood for binary outcomes, with clipping. */
export function logLoss(preds: ReadonlyArray<{ p: number; y: 0 | 1 }>, eps = 1e-15): number {
  if (!preds.length) return NaN;
  return -preds.reduce((a, { p, y }) => {
    const q = Math.min(1 - eps, Math.max(eps, p));
    return a + (y ? Math.log(q) : Math.log(1 - q));
  }, 0) / preds.length;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  n: number;
  meanPredicted: number;
  observedRate: number;
  ci: { lower: number; upper: number };
}

/** Reliability table with equal-width bins plus expected calibration error (ECE). */
export function calibration(preds: ReadonlyArray<{ p: number; y: 0 | 1 }>, bins = 10): { bins: CalibrationBin[]; ece: number } {
  const out: CalibrationBin[] = [];
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const lower = i / bins;
    const upper = (i + 1) / bins;
    const inBin = preds.filter(({ p }) => p >= lower && (i === bins - 1 ? p <= upper : p < upper));
    if (!inBin.length) continue;
    const wins = inBin.reduce((a, x) => a + x.y, 0);
    const meanPredicted = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const w = wilsonInterval(wins, inBin.length);
    out.push({ lower, upper, n: inBin.length, meanPredicted, observedRate: w.p, ci: { lower: w.lower, upper: w.upper } });
    ece += (inBin.length / preds.length) * Math.abs(w.p - meanPredicted);
  }
  return { bins: out, ece };
}
