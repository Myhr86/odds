import { removeMargin, type MarginMethod } from "./probability";

/**
 * Weighted, margin-free market consensus across independent reference bookmakers.
 *
 * Procedure (documented in docs/02-architecture.md §5):
 *  1. Drop quotes from the TARGET bookmaker (Norsk Tipping must never price itself).
 *  2. Drop stale quotes (age > maxAgeSeconds) and incomplete price sets.
 *  3. De-vig each bookmaker's complete market individually (default: proportional).
 *  4. If ≥ outlierMinBooks remain, reject books whose de-vigged probability for any outcome
 *     deviates from the median by more than max(outlierAbsFloor, outlierMadK × MAD).
 *  5. Weight each remaining book: w = reliabilityWeight × 0.5^(age / freshnessHalfLifeSeconds).
 *  6. Consensus p_j = Σ w_i p_ij / Σ w_i (linear opinion pool), renormalised to sum to 1.
 *  7. Report coverage (n, Kish effective n), dispersion (weighted SD per outcome) and rejections.
 */

export interface ReferenceQuote {
  bookmaker: string;
  /** Decimal odds per outcome, in the same order as `outcomes`. */
  odds: number[];
  /** Seconds since the provider says this price was last updated. */
  ageSeconds: number;
}

export interface ConsensusConfig {
  targetBookmaker: string;
  maxAgeSeconds: number;
  marginMethod: MarginMethod;
  /** Bookmaker -> reliability weight. Unknown bookmakers get `defaultWeight`. */
  reliabilityWeights: Record<string, number>;
  defaultWeight: number;
  freshnessHalfLifeSeconds: number;
  outlierMinBooks: number;
  outlierMadK: number;
  outlierAbsFloor: number;
  /** Max acceptable overround for a reference book; above this the book is treated as unreliable. */
  maxOverround: number;
}

/**
 * Starting values – NOT proven optimal. Sharp / high-liquidity markets get higher weight.
 * Names must match the provider's bookmaker names (verified by the probe script).
 */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  targetBookmaker: "Norsk Tipping",
  maxAgeSeconds: 120,
  marginMethod: "proportional",
  // Names as returned by odds-api.io GET /v3/bookmakers (verified 2026-11-01). Pinnacle is NOT offered there.
  reliabilityWeights: {
    "Betfair Exchange": 3,
    Sbobet: 2.5,
    SingBet: 2.5,
    Pinnacle: 3, // kept for a possible second provider
    Bet365: 1,
    Unibet: 1,
    "William Hill": 1,
  },
  defaultWeight: 1,
  freshnessHalfLifeSeconds: 300,
  outlierMinBooks: 4,
  outlierMadK: 4,
  outlierAbsFloor: 0.04,
  maxOverround: 0.15,
};

export type RejectionReason = "target_bookmaker" | "stale" | "invalid_prices" | "excessive_margin" | "outlier" | "duplicate";

export interface ConsensusResult {
  outcomes: string[];
  /** Margin-free consensus probabilities, aligned with `outcomes`. Null when no book survived. */
  probabilities: number[] | null;
  used: Array<{ bookmaker: string; weight: number; fairProbabilities: number[]; overround: number; ageSeconds: number }>;
  rejected: Array<{ bookmaker: string; reason: RejectionReason; detail?: string }>;
  nBooks: number;
  /** Kish effective sample size (Σw)² / Σw². Equals nBooks when weights are equal. */
  effectiveBooks: number;
  /** Weighted standard deviation of de-vigged probabilities, per outcome. */
  dispersion: number[];
  maxAgeSeconds: number | null;
}

export function buildConsensus(
  outcomes: readonly string[],
  quotes: readonly ReferenceQuote[],
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
): ConsensusResult {
  const rejected: ConsensusResult["rejected"] = [];
  const seen = new Set<string>();
  type Cand = { bookmaker: string; fair: number[]; overround: number; ageSeconds: number };
  let cands: Cand[] = [];

  for (const q of quotes) {
    const key = q.bookmaker.trim().toLowerCase();
    if (key === config.targetBookmaker.trim().toLowerCase()) {
      rejected.push({ bookmaker: q.bookmaker, reason: "target_bookmaker" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ bookmaker: q.bookmaker, reason: "duplicate" });
      continue;
    }
    if (q.odds.length !== outcomes.length || q.odds.some((o) => !Number.isFinite(o) || o <= 1)) {
      rejected.push({ bookmaker: q.bookmaker, reason: "invalid_prices" });
      continue;
    }
    if (!Number.isFinite(q.ageSeconds) || q.ageSeconds < 0 || q.ageSeconds > config.maxAgeSeconds) {
      rejected.push({ bookmaker: q.bookmaker, reason: "stale", detail: `age ${q.ageSeconds}s` });
      continue;
    }
    const mr = removeMargin(q.odds, config.marginMethod);
    if (mr.overround > config.maxOverround) {
      rejected.push({ bookmaker: q.bookmaker, reason: "excessive_margin", detail: `overround ${(mr.overround * 100).toFixed(1)}%` });
      continue;
    }
    seen.add(key);
    cands.push({ bookmaker: q.bookmaker, fair: mr.probabilities, overround: mr.overround, ageSeconds: q.ageSeconds });
  }

  if (cands.length >= config.outlierMinBooks) {
    const keep: Cand[] = [];
    const med = outcomes.map((_, j) => median(cands.map((c) => c.fair[j]!)));
    const mad = outcomes.map((_, j) => median(cands.map((c) => Math.abs(c.fair[j]! - med[j]!))));
    for (const c of cands) {
      const j = c.fair.findIndex((p, idx) => Math.abs(p - med[idx]!) > Math.max(config.outlierAbsFloor, config.outlierMadK * mad[idx]!));
      if (j >= 0) {
        rejected.push({
          bookmaker: c.bookmaker,
          reason: "outlier",
          detail: `${outcomes[j]}: ${(c.fair[j]! * 100).toFixed(1)}% vs median ${(med[j]! * 100).toFixed(1)}%`,
        });
      } else keep.push(c);
    }
    cands = keep;
  }

  if (cands.length === 0) {
    return { outcomes: [...outcomes], probabilities: null, used: [], rejected, nBooks: 0, effectiveBooks: 0, dispersion: outcomes.map(() => 0), maxAgeSeconds: null };
  }

  const weightsLc = Object.fromEntries(Object.entries(config.reliabilityWeights).map(([k, v]) => [k.toLowerCase(), v]));
  const used = cands.map((c) => ({
    bookmaker: c.bookmaker,
    weight: (weightsLc[c.bookmaker.toLowerCase()] ?? config.defaultWeight) * Math.pow(0.5, c.ageSeconds / config.freshnessHalfLifeSeconds),
    fairProbabilities: c.fair,
    overround: c.overround,
    ageSeconds: c.ageSeconds,
  }));
  const W = used.reduce((a, u) => a + u.weight, 0);
  const W2 = used.reduce((a, u) => a + u.weight * u.weight, 0);
  const raw = outcomes.map((_, j) => used.reduce((a, u) => a + u.weight * u.fairProbabilities[j]!, 0) / W);
  const s = raw.reduce((a, b) => a + b, 0);
  const probabilities = raw.map((p) => p / s);
  const dispersion = outcomes.map((_, j) => Math.sqrt(used.reduce((a, u) => a + u.weight * (u.fairProbabilities[j]! - probabilities[j]!) ** 2, 0) / W));

  return {
    outcomes: [...outcomes],
    probabilities,
    used,
    rejected,
    nBooks: used.length,
    effectiveBooks: (W * W) / W2,
    dispersion,
    maxAgeSeconds: Math.max(...used.map((u) => u.ageSeconds)),
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
