import { roiSummary, wilsonInterval, type BetOutcome } from "../core/stats";
import type { RecommendationRow } from "./repo";

export interface Segment {
  label: string;
  n: number;
  settled: number;
  avgEv: number;
  avgOdds: number;
  hit: { p: number; lower: number; upper: number };
  profit: number;
  roi: number;
  roiLower: number;
  roiUpper: number;
}

/** Flat 1-unit staking over ALL recorded recommendations in a segment (bet on or not, won or lost). */
export function segment(label: string, rows: RecommendationRow[]): Segment {
  const settled = rows.filter((r) => r.result_outcome && r.result_outcome !== "void" && r.result_outcome !== "push");
  const roi = roiSummary(settled.map((r) => ({ odds: r.target_odds, outcome: r.result_outcome as BetOutcome })));
  const wins = settled.filter((r) => r.result_outcome === "win" || r.result_outcome === "half_win").length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    label,
    n: rows.length,
    settled: settled.length,
    avgEv: mean(rows.map((r) => r.expected_value)),
    avgOdds: mean(rows.map((r) => r.target_odds)),
    hit: wilsonInterval(wins, settled.length),
    profit: roi.profit,
    roi: roi.roi,
    roiLower: roi.roiLower,
    roiUpper: roi.roiUpper,
  };
}

export function bySegments(rows: RecommendationRow[]) {
  const group = (key: (r: RecommendationRow) => string, order: string[]) =>
    order.map((label) => segment(label, rows.filter((r) => key(r) === label))).filter((s) => s.n > 0);
  return {
    all: segment("All recorded", rows),
    category: group((r) => r.category, ["EXCELLENT_VALUE", "POTENTIAL_VALUE", "WATCHLIST", "NO_VALUE", "INSUFFICIENT_DATA"]),
    ev: group((r) => (r.expected_value < 0 ? "EV < 0" : r.expected_value < 0.03 ? "0–3%" : r.expected_value < 0.06 ? "3–6%" : "≥ 6%"), ["EV < 0", "0–3%", "3–6%", "≥ 6%"]),
    confidence: group((r) => (r.confidence < 50 ? "< 50" : r.confidence < 65 ? "50–64" : r.confidence < 80 ? "65–79" : "≥ 80"), ["< 50", "50–64", "65–79", "≥ 80"]),
  };
}
