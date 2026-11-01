import { describe, expect, it } from "vitest";
import { breakEvenProbability, expectedValue, expectedValueWithPush, formatPercent, probabilityEdge } from "@/lib/core/ev";
import { closingLineValue, logClv, priceMovement } from "@/lib/core/clv";
import { brierScore, calibration, logLoss, roiSummary, unitProfit, wilsonInterval } from "@/lib/core/stats";
import { doubleChanceFromMatchResult } from "@/lib/markets/derived";

describe("expected value", () => {
  it("reproduces the spec example: 2.20 × 0.49 − 1 = +7.8%", () => {
    const ev = expectedValue(2.2, 0.49);
    expect(ev).toBeCloseTo(0.078, 12);
    expect(formatPercent(ev)).toBe("+7.8%");
  });
  it("is zero exactly at the break-even probability", () => {
    expect(expectedValue(2.5, breakEvenProbability(2.5))).toBeCloseTo(0, 12);
  });
  it("is negative when the price is below fair", () => {
    expect(expectedValue(1.8, 0.5)).toBeCloseTo(-0.1, 12);
    expect(formatPercent(-0.1)).toBe("-10.0%");
  });
  it("probability edge has the same sign as EV", () => {
    expect(probabilityEdge(2.2, 0.49)).toBeCloseTo(0.49 - 1 / 2.2, 12);
  });
  it("rejects raw probabilities outside (0,1)", () => {
    expect(() => expectedValue(2, 1)).toThrow();
    expect(() => expectedValue(2, 0)).toThrow();
  });
  it("push-adjusted EV scales the conditional EV by P(no push)", () => {
    expect(expectedValueWithPush(2.0, 0.55, 0.75)).toBeCloseTo(0.75 * 0.1, 12);
  });
});

describe("double chance derivation", () => {
  it("sums fair 1X2 probabilities", () => {
    const dc = doubleChanceFromMatchResult({ home: 0.5, draw: 0.3, away: 0.2 });
    expect(dc.home_draw).toBeCloseTo(0.8, 12);
    expect(dc.home_away).toBeCloseTo(0.7, 12);
    expect(dc.draw_away).toBeCloseTo(0.5, 12);
  });
  it("refuses non-normalised input", () => {
    expect(() => doubleChanceFromMatchResult({ home: 0.5, draw: 0.3, away: 0.3 })).toThrow();
  });
});

describe("CLV", () => {
  it("took 2.20, closing fair probability 50% (fair 2.00) → +10% CLV", () => {
    expect(closingLineValue(2.2, 0.5)).toBeCloseTo(0.1, 12);
    expect(logClv(2.2, 0.5)).toBeCloseTo(Math.log(1.1), 12);
  });
  it("negative when the market closed above our price", () => {
    expect(closingLineValue(2.0, 0.45)).toBeCloseTo(-0.1, 12);
  });
  it("price movement", () => {
    expect(priceMovement(2.2, 2.0)).toBeCloseTo(-0.0909090909, 9);
  });
});

describe("statistics", () => {
  it("Wilson interval matches reference values", () => {
    const a = wilsonInterval(5, 10);
    expect(a.lower).toBeCloseTo(0.2366, 4);
    expect(a.upper).toBeCloseTo(0.7634, 4);
    const b = wilsonInterval(0, 10);
    expect(b.lower).toBe(0);
    expect(b.upper).toBeCloseTo(0.2775, 4);
  });
  it("unit profit by outcome", () => {
    expect(unitProfit(2.5, "win")).toBe(1.5);
    expect(unitProfit(2.5, "loss")).toBe(-1);
    expect(unitProfit(2.0, "half_win")).toBe(0.5);
    expect(unitProfit(2.0, "half_loss")).toBe(-0.5);
    expect(unitProfit(2.0, "push")).toBe(0);
  });
  it("ROI summary with CI; pushes/voids excluded from stake", () => {
    const s = roiSummary([
      { odds: 2.0, outcome: "win" },
      { odds: 2.0, outcome: "loss" },
      { odds: 3.0, outcome: "win" },
      { odds: 2.0, outcome: "loss" },
      { odds: 2.0, outcome: "void" },
    ]);
    expect(s.n).toBe(4);
    expect(s.profit).toBeCloseTo(1, 12);
    expect(s.roi).toBeCloseTo(0.25, 12);
    expect(s.roiLower).toBeLessThan(0); // 4 bets prove nothing
    expect(s.roiUpper).toBeGreaterThan(0.5);
  });
  it("Brier and log loss", () => {
    const preds = [{ p: 0.8, y: 1 as const }, { p: 0.3, y: 0 as const }];
    expect(brierScore(preds)).toBeCloseTo((0.04 + 0.09) / 2, 12);
    expect(logLoss(preds)).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7)) / 2, 12);
  });
  it("calibration ECE is 0 for a perfectly calibrated bin", () => {
    const preds = [...Array(10)].map((_, i) => ({ p: 0.5, y: (i < 5 ? 1 : 0) as 0 | 1 }));
    const c = calibration(preds);
    expect(c.ece).toBeCloseTo(0, 12);
    expect(c.bins).toHaveLength(1);
    expect(c.bins[0]!.n).toBe(10);
  });
});
