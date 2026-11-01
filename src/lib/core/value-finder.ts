import { buildConsensus, DEFAULT_CONSENSUS_CONFIG, type ConsensusConfig, type ConsensusResult, type ReferenceQuote } from "./consensus";
import { confidenceScore, DEFAULT_CONFIDENCE_CONFIG, type ConfidenceConfig, type ConfidenceResult } from "./confidence";
import { expectedValue, formatPercent } from "./ev";
import { doubleChanceFromMatchResult } from "../markets/derived";
import { lineKind, marketKey, OUTCOMES, type CanonicalMarket } from "../markets/types";

export type Category = "EXCELLENT_VALUE" | "POTENTIAL_VALUE" | "WATCHLIST" | "INSUFFICIENT_DATA" | "NO_VALUE";

export interface Thresholds {
  minReferenceBooks: number;
  maxDataAgeSeconds: number;
  minEv: number;
  minConfidence: number;
  excellentEv: number;
  excellentConfidence: number;
  watchlistEv: number;
  /** EV above this is far more likely a data/mapping error than a real price; treated as INSUFFICIENT_DATA. */
  suspectEv: number;
}

/** Configurable starting values from the product brief – not proven optimal. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  minReferenceBooks: 3,
  maxDataAgeSeconds: 120,
  minEv: 0.03,
  minConfidence: 65,
  excellentEv: 0.06,
  excellentConfidence: 80,
  watchlistEv: 0.01,
  suspectEv: 0.25,
};

export interface TargetQuote {
  bookmaker: string;
  /** outcome -> decimal odds offered by the target (Norsk Tipping). Missing outcomes are allowed. */
  prices: Record<string, number>;
  ageSeconds: number;
}

export interface ReferenceMarketQuote {
  bookmaker: string;
  prices: Record<string, number>;
  ageSeconds: number;
}

export interface EvaluateOptions {
  thresholds?: Thresholds;
  consensus?: Partial<ConsensusConfig>;
  confidence?: ConfidenceConfig;
  /** Bookmakers considered sharp anchors (high liquidity / low margin). */
  sharpBookmakers?: readonly string[];
  /** Whether the provider→canonical mapping's settlement rules were verified for BOTH sides. */
  settlementVerified: boolean;
}

export interface SelectionEvaluation {
  marketKey: string;
  outcome: string;
  targetOdds: number | null;
  fairProbability: number | null;
  fairOdds: number | null;
  ev: number | null;
  confidence: ConfidenceResult | null;
  category: Category;
  /** Human-readable, data-derived explanation lines. No generated prose. */
  reasons: string[];
  consensus: Pick<ConsensusResult, "nBooks" | "effectiveBooks" | "maxAgeSeconds" | "rejected"> & { usedBooks: string[] };
}

const DEFAULT_SHARP = ["Pinnacle", "Betfair Exchange", "SBOBet", "Singbet"];

/**
 * Evaluate every selection of one market for one event.
 * Partition markets are de-vigged per reference book; DOUBLE_CHANCE must be evaluated
 * with `evaluateDoubleChance` using 1X2 reference quotes.
 */
export function evaluateMarket(
  market: CanonicalMarket,
  target: TargetQuote,
  references: readonly ReferenceMarketQuote[],
  opts: EvaluateOptions,
): SelectionEvaluation[] {
  if (market.type === "DOUBLE_CHANCE") throw new Error("Use evaluateDoubleChance for DOUBLE_CHANCE");
  const outcomes = OUTCOMES[market.type];
  const cfg: ConsensusConfig = { ...DEFAULT_CONSENSUS_CONFIG, ...opts.consensus, targetBookmaker: target.bookmaker };
  cfg.maxAgeSeconds = Math.min(cfg.maxAgeSeconds, (opts.thresholds ?? DEFAULT_THRESHOLDS).maxDataAgeSeconds);
  const quotes: ReferenceQuote[] = references.map((r) => ({
    bookmaker: r.bookmaker,
    odds: outcomes.map((o) => r.prices[o] ?? NaN),
    ageSeconds: r.ageSeconds,
  }));
  const consensus = buildConsensus(outcomes, quotes, cfg);
  const fair: Record<string, { p: number; sd: number }> | null = consensus.probabilities
    ? Object.fromEntries(outcomes.map((o, j) => [o, { p: consensus.probabilities![j]!, sd: consensus.dispersion[j]! }]))
    : null;
  return outcomes.map((o) => scoreSelection(market, o, target, consensus, fair?.[o] ?? null, opts));
}

/** Double chance: fair probability = sum of consensus 1X2 fair probabilities. */
export function evaluateDoubleChance(
  period: CanonicalMarket["period"],
  target: TargetQuote,
  matchResultReferences: readonly ReferenceMarketQuote[],
  opts: EvaluateOptions,
): SelectionEvaluation[] {
  const dcMarket: CanonicalMarket = { sport: "football", type: "DOUBLE_CHANCE", period };
  const cfg: ConsensusConfig = { ...DEFAULT_CONSENSUS_CONFIG, ...opts.consensus, targetBookmaker: target.bookmaker };
  cfg.maxAgeSeconds = Math.min(cfg.maxAgeSeconds, (opts.thresholds ?? DEFAULT_THRESHOLDS).maxDataAgeSeconds);
  const o1x2 = OUTCOMES.MATCH_RESULT;
  const consensus = buildConsensus(
    o1x2,
    matchResultReferences.map((r) => ({ bookmaker: r.bookmaker, odds: o1x2.map((o) => r.prices[o] ?? NaN), ageSeconds: r.ageSeconds })),
    cfg,
  );
  let fair: Record<string, { p: number; sd: number }> | null = null;
  if (consensus.probabilities) {
    const [h, d, a] = consensus.probabilities as [number, number, number];
    const dc = doubleChanceFromMatchResult({ home: h, draw: d, away: a });
    // Dispersion of a DC selection = SD of the complementary single outcome (e.g. 1X ↔ 2).
    const [sh, sd, sa] = consensus.dispersion as [number, number, number];
    fair = { home_draw: { p: dc.home_draw, sd: sa }, home_away: { p: dc.home_away, sd: sd }, draw_away: { p: dc.draw_away, sd: sh } };
  }
  return OUTCOMES.DOUBLE_CHANCE.map((o) => scoreSelection(dcMarket, o, target, consensus, fair?.[o] ?? null, opts));
}

function scoreSelection(
  market: CanonicalMarket,
  outcome: string,
  target: TargetQuote,
  consensus: ConsensusResult,
  fair: { p: number; sd: number } | null,
  opts: EvaluateOptions,
): SelectionEvaluation {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const sharp = new Set((opts.sharpBookmakers ?? DEFAULT_SHARP).map((s) => s.toLowerCase()));
  const key = marketKey(market);
  const targetOdds = target.prices[outcome];
  const reasons: string[] = [];
  const base = {
    marketKey: key,
    outcome,
    consensus: {
      nBooks: consensus.nBooks,
      effectiveBooks: consensus.effectiveBooks,
      maxAgeSeconds: consensus.maxAgeSeconds,
      rejected: consensus.rejected,
      usedBooks: consensus.used.map((u) => u.bookmaker),
    },
  };
  const insufficient = (why: string[], partial: Partial<SelectionEvaluation> = {}): SelectionEvaluation => ({
    ...base,
    targetOdds: targetOdds ?? null,
    fairProbability: null,
    fairOdds: null,
    ev: null,
    confidence: null,
    category: "INSUFFICIENT_DATA",
    reasons: why,
    ...partial,
  });

  if (targetOdds === undefined || !(targetOdds > 1)) return insufficient([`${target.bookmaker} has no valid price for this selection.`]);
  if (target.ageSeconds > t.maxDataAgeSeconds) return insufficient([`${target.bookmaker} price is ${Math.round(target.ageSeconds)}s old (limit ${t.maxDataAgeSeconds}s).`]);
  if (!fair || consensus.nBooks < t.minReferenceBooks) {
    const why = [`Only ${consensus.nBooks} usable reference bookmaker(s); minimum is ${t.minReferenceBooks}.`];
    const counts = countBy(consensus.rejected.map((r) => r.reason));
    if (Object.keys(counts).length) why.push(`Rejected quotes: ${Object.entries(counts).map(([k, v]) => `${v}× ${k}`).join(", ")}.`);
    return insufficient(why);
  }

  const ev = expectedValue(targetOdds, fair.p);
  const fairOdds = 1 / fair.p;
  const lk = lineKind(market.line);
  const cleanliness = !opts.settlementVerified ? "unverified_settlement" : lk === "whole" || lk === "quarter" ? "approximate" : "clean";
  const confidence = confidenceScore(
    {
      effectiveBooks: consensus.effectiveBooks,
      worstAgeSeconds: Math.max(target.ageSeconds, consensus.maxAgeSeconds ?? 0),
      selectionDispersion: fair.sd,
      hasSharpAnchor: consensus.used.some((u) => sharp.has(u.bookmaker.toLowerCase())),
      marketCleanliness: cleanliness,
    },
    opts.confidence ?? DEFAULT_CONFIDENCE_CONFIG,
  );

  reasons.push(
    `${target.bookmaker} offers ${targetOdds.toFixed(2)}; margin-free consensus of ${consensus.nBooks} book(s) (${base.consensus.usedBooks.join(", ")}) implies ${(fair.p * 100).toFixed(1)}% → fair odds ${fairOdds.toFixed(2)}.`,
    `EV = ${targetOdds.toFixed(2)} × ${fair.p.toFixed(4)} − 1 = ${formatPercent(ev)}.`,
    `Reference disagreement (weighted SD) ${(fair.sd * 100).toFixed(2)} pp; oldest price used ${Math.round(Math.max(target.ageSeconds, consensus.maxAgeSeconds ?? 0))}s.`,
  );
  if (cleanliness === "approximate") reasons.push(`Line ${market.line} can push or split stakes: EV shown is conditional on no push (approximate).`);
  if (cleanliness === "unverified_settlement") reasons.push("Settlement rules of the provider market mapping are NOT verified; comparison may be invalid.");
  if (consensus.rejected.length) reasons.push(`Excluded: ${consensus.rejected.map((r) => `${r.bookmaker} (${r.reason}${r.detail ? `: ${r.detail}` : ""})`).join("; ")}.`);

  let category: Category;
  if (ev > t.suspectEv) {
    reasons.unshift(`EV ${formatPercent(ev)} exceeds plausibility limit ${formatPercent(t.suspectEv)}: probable market/event mismatch or stale price. Not recommended.`);
    category = "INSUFFICIENT_DATA";
  } else if (!opts.settlementVerified && ev >= t.watchlistEv) {
    category = "WATCHLIST";
  } else if (ev >= t.excellentEv && confidence.score >= t.excellentConfidence) category = "EXCELLENT_VALUE";
  else if (ev >= t.minEv && confidence.score >= t.minConfidence) category = "POTENTIAL_VALUE";
  else if (ev >= t.watchlistEv) {
    category = "WATCHLIST";
    if (ev >= t.minEv) reasons.push(`Confidence ${confidence.score} is below the ${t.minConfidence} threshold.`);
  } else category = "NO_VALUE";

  return { ...base, targetOdds, fairProbability: fair.p, fairOdds, ev, confidence, category, reasons };
}

function countBy(xs: string[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of xs) r[x] = (r[x] ?? 0) + 1;
  return r;
}

const CATEGORY_RANK: Record<Category, number> = { EXCELLENT_VALUE: 0, POTENTIAL_VALUE: 1, WATCHLIST: 2, NO_VALUE: 3, INSUFFICIENT_DATA: 4 };

/** Best opportunities first: category, then EV × confidence. */
export function rankEvaluations<T extends SelectionEvaluation>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => {
    const c = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (c) return c;
    return rankScore(b) - rankScore(a);
  });
}

function rankScore(x: SelectionEvaluation): number {
  if (x.ev === null || !x.confidence) return -1e9;
  return x.ev * x.confidence.score;
}
