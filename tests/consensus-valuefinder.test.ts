import { describe, expect, it } from "vitest";
import { buildConsensus, DEFAULT_CONSENSUS_CONFIG, type ConsensusConfig } from "@/lib/core/consensus";
import { confidenceScore } from "@/lib/core/confidence";
import { evaluateDoubleChance, evaluateMarket, rankEvaluations, type ReferenceMarketQuote } from "@/lib/core/value-finder";
import { lineKind, marketKey, parseMarketKey, type CanonicalMarket } from "@/lib/markets/types";

const cfg = (o: Partial<ConsensusConfig> = {}): ConsensusConfig => ({ ...DEFAULT_CONSENSUS_CONFIG, reliabilityWeights: {}, ...o });
const OU = ["over", "under"];

describe("buildConsensus", () => {
  it("never includes the target bookmaker", () => {
    const r = buildConsensus(OU, [
      { bookmaker: "Norsk Tipping", odds: [3, 1.3], ageSeconds: 1 },
      { bookmaker: "A", odds: [1.9, 1.9], ageSeconds: 1 },
    ], cfg());
    expect(r.nBooks).toBe(1);
    expect(r.rejected).toContainEqual({ bookmaker: "Norsk Tipping", reason: "target_bookmaker" });
  });
  it("rejects stale, invalid, duplicate and excessive-margin quotes", () => {
    const r = buildConsensus(OU, [
      { bookmaker: "Stale", odds: [1.9, 1.9], ageSeconds: 500 },
      { bookmaker: "Bad", odds: [1.0, 1.9], ageSeconds: 1 },
      { bookmaker: "Short", odds: [1.9], ageSeconds: 1 },
      { bookmaker: "Greedy", odds: [1.6, 1.6], ageSeconds: 1 },
      { bookmaker: "A", odds: [1.9, 1.9], ageSeconds: 1 },
      { bookmaker: "a", odds: [1.9, 1.9], ageSeconds: 1 },
    ], cfg());
    expect(r.used.map((u) => u.bookmaker)).toEqual(["A"]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["duplicate", "excessive_margin", "invalid_prices", "invalid_prices", "stale"]);
  });
  it("equal weights and equal ages give the plain mean of de-vigged probabilities", () => {
    const r = buildConsensus(OU, [
      { bookmaker: "A", odds: [1.9, 1.9], ageSeconds: 0 }, // 0.50
      { bookmaker: "B", odds: [1.8, 2.0], ageSeconds: 0 }, // 0.5263
    ], cfg());
    const pB = (1 / 1.8) / (1 / 1.8 + 1 / 2.0);
    expect(r.probabilities![0]).toBeCloseTo((0.5 + pB) / 2, 12);
    expect(r.effectiveBooks).toBeCloseTo(2, 12);
  });
  it("reliability weights pull the consensus toward sharp books", () => {
    const quotes = [
      { bookmaker: "Pinnacle", odds: [1.95, 1.95], ageSeconds: 0 },
      { bookmaker: "Soft", odds: [1.7, 2.1], ageSeconds: 0 },
    ];
    const eq = buildConsensus(OU, quotes, cfg());
    const w = buildConsensus(OU, quotes, cfg({ reliabilityWeights: { Pinnacle: 3 } }));
    expect(Math.abs(w.probabilities![0]! - 0.5)).toBeLessThan(Math.abs(eq.probabilities![0]! - 0.5));
    expect(w.effectiveBooks).toBeLessThan(2);
  });
  it("older quotes get exponentially less weight (half-life)", () => {
    const r = buildConsensus(OU, [
      { bookmaker: "A", odds: [1.9, 1.9], ageSeconds: 0 },
      { bookmaker: "B", odds: [1.9, 1.9], ageSeconds: 100 },
    ], cfg({ freshnessHalfLifeSeconds: 100, maxAgeSeconds: 1000 }));
    expect(r.used[1]!.weight / r.used[0]!.weight).toBeCloseTo(0.5, 12);
  });
  it("removes a clear outlier when enough books are present", () => {
    const r = buildConsensus(OU, [
      { bookmaker: "A", odds: [1.9, 1.9], ageSeconds: 0 },
      { bookmaker: "B", odds: [1.91, 1.89], ageSeconds: 0 },
      { bookmaker: "C", odds: [1.89, 1.91], ageSeconds: 0 },
      { bookmaker: "D", odds: [1.92, 1.88], ageSeconds: 0 },
      { bookmaker: "Wrong", odds: [1.4, 2.8], ageSeconds: 0 }, // probably a different line
    ], cfg());
    expect(r.used.map((u) => u.bookmaker)).not.toContain("Wrong");
    expect(r.rejected.find((x) => x.bookmaker === "Wrong")?.reason).toBe("outlier");
  });
  it("returns null probabilities when nothing survives", () => {
    const r = buildConsensus(OU, [{ bookmaker: "X", odds: [1.9, 1.9], ageSeconds: 9999 }], cfg());
    expect(r.probabilities).toBeNull();
  });
});

describe("confidenceScore", () => {
  it("follows the documented formula", () => {
    const r = confidenceScore({ effectiveBooks: 3, worstAgeSeconds: 60, selectionDispersion: 0.015, hasSharpAnchor: true, marketCleanliness: "clean" });
    // (0.3×0.5 + 0.2×0.5 + 0.25×0.5 + 0.15×1 + 0.1×1) / 1.0 = 0.625
    expect(r.score).toBe(63);
    expect(r.scope).toBe("data-quality only");
  });
  it("perfect data gives 100; adding model components changes scope", () => {
    expect(confidenceScore({ effectiveBooks: 10, worstAgeSeconds: 0, selectionDispersion: 0, hasSharpAnchor: true, marketCleanliness: "clean" }).score).toBe(100);
    const m = confidenceScore({ effectiveBooks: 10, worstAgeSeconds: 0, selectionDispersion: 0, hasSharpAnchor: true, marketCleanliness: "clean", modelCalibrationEce: 0.05 });
    expect(m.scope).toBe("data + model");
    expect(m.score).toBeLessThan(100);
  });
});

describe("market keys", () => {
  it("round-trips and normalises float noise", () => {
    const m: CanonicalMarket = { sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR", line: 2.5000000001 };
    expect(marketKey(m)).toBe("football|TOTAL_GOALS|FT_REGULAR|2.5|-");
    expect(parseMarketKey(marketKey(m)).line).toBe(2.5);
  });
  it("different periods never share a key", () => {
    const a = marketKey({ sport: "football", type: "MATCH_RESULT", period: "FT_REGULAR" });
    const b = marketKey({ sport: "football", type: "MATCH_RESULT", period: "FT_INCL_ET" });
    expect(a).not.toBe(b);
  });
  it("validates line requirements", () => {
    expect(() => marketKey({ sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR" })).toThrow();
    expect(() => marketKey({ sport: "football", type: "BTTS", period: "FT_REGULAR", line: 1.5 })).toThrow();
  });
  it("classifies lines", () => {
    expect(lineKind(2.5)).toBe("half");
    expect(lineKind(-1)).toBe("whole");
    expect(lineKind(-0.25)).toBe("quarter");
    expect(lineKind(0.75)).toBe("quarter");
  });
});

const ou25: CanonicalMarket = { sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR", line: 2.5 };
const refs = (extra: ReferenceMarketQuote[] = []): ReferenceMarketQuote[] => [
  { bookmaker: "Pinnacle", prices: { over: 1.95, under: 1.95 }, ageSeconds: 10 },
  { bookmaker: "Betfair Exchange", prices: { over: 1.98, under: 1.98 }, ageSeconds: 10 },
  { bookmaker: "Bet365", prices: { over: 1.91, under: 1.91 }, ageSeconds: 10 },
  { bookmaker: "Unibet", prices: { over: 1.9, under: 1.92 }, ageSeconds: 10 },
  ...extra,
];

describe("evaluateMarket", () => {
  it("finds value when target beats the consensus and explains why", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 2.15, under: 1.65 }, ageSeconds: 5 }, refs(), { settlementVerified: true });
    const over = res.find((r) => r.outcome === "over")!;
    expect(over.fairProbability!).toBeGreaterThan(0.49);
    expect(over.fairProbability!).toBeLessThan(0.51);
    expect(over.ev!).toBeCloseTo(2.15 * over.fairProbability! - 1, 12);
    expect(over.ev!).toBeGreaterThan(0.06);
    expect(["EXCELLENT_VALUE", "POTENTIAL_VALUE"]).toContain(over.category);
    expect(over.reasons.join(" ")).toMatch(/EV = 2\.15/);
    const under = res.find((r) => r.outcome === "under")!;
    expect(under.category).toBe("NO_VALUE");
  });
  it("requires the minimum number of reference books", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 2.15, under: 1.65 }, ageSeconds: 5 }, refs().slice(0, 2), { settlementVerified: true });
    expect(res.every((r) => r.category === "INSUFFICIENT_DATA")).toBe(true);
    expect(res[0]!.reasons[0]).toMatch(/Only 2 usable/);
  });
  it("rejects stale target prices", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 2.15, under: 1.65 }, ageSeconds: 600 }, refs(), { settlementVerified: true });
    expect(res[0]!.category).toBe("INSUFFICIENT_DATA");
  });
  it("treats implausibly high EV as a probable mismatch", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 3.2, under: 1.3 }, ageSeconds: 5 }, refs(), { settlementVerified: true });
    const over = res.find((r) => r.outcome === "over")!;
    expect(over.category).toBe("INSUFFICIENT_DATA");
    expect(over.reasons[0]).toMatch(/plausibility/);
  });
  it("caps unverified settlement mappings at WATCHLIST", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 2.15, under: 1.65 }, ageSeconds: 5 }, refs(), { settlementVerified: false });
    expect(res.find((r) => r.outcome === "over")!.category).toBe("WATCHLIST");
  });
  it("ranks best opportunities first", () => {
    const res = evaluateMarket(ou25, { bookmaker: "Norsk Tipping", prices: { over: 2.15, under: 1.65 }, ageSeconds: 5 }, refs(), { settlementVerified: true });
    expect(rankEvaluations(res)[0]!.outcome).toBe("over");
  });
});

describe("evaluateDoubleChance", () => {
  it("derives fair DC from 1X2 consensus instead of de-vigging overlapping prices", () => {
    const mr: ReferenceMarketQuote[] = ["Pinnacle", "Bet365", "Unibet"].map((b) => ({ bookmaker: b, prices: { home: 2.0, draw: 3.5, away: 4.0 }, ageSeconds: 5 }));
    const res = evaluateDoubleChance("FT_REGULAR", { bookmaker: "Norsk Tipping", prices: { home_draw: 1.4, home_away: 1.3, draw_away: 2.0 }, ageSeconds: 5 }, mr, { settlementVerified: true });
    const hd = res.find((r) => r.outcome === "home_draw")!;
    expect(hd.fairProbability!).toBeCloseTo(0.4827586207 + 0.2758620690, 9);
    expect(hd.ev!).toBeCloseTo(1.4 * hd.fairProbability! - 1, 12);
  });
});
