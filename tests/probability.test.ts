import { describe, expect, it } from "vitest";
import { bookSum, fairOdds, impliedProbability, InvalidOddsError, overround, removeMargin } from "@/lib/core/probability";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("implied probability", () => {
  it("is 1/odds", () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(4)).toBe(0.25);
    expect(impliedProbability(1.25)).toBeCloseTo(0.8, 12);
  });
  it.each([1, 0.5, 0, -2, NaN, Infinity])("rejects invalid odds %s", (o) => {
    expect(() => impliedProbability(o)).toThrow(InvalidOddsError);
  });
  it("fair odds is the inverse of probability", () => {
    expect(fairOdds(0.4)).toBeCloseTo(2.5, 12);
    expect(() => fairOdds(0)).toThrow();
    expect(() => fairOdds(1)).toThrow();
  });
});

describe("overround", () => {
  it("1.90/1.90 two-way market has 5.263% overround", () => {
    expect(bookSum([1.9, 1.9])).toBeCloseTo(1.0526315789, 9);
    expect(overround([1.9, 1.9])).toBeCloseTo(0.0526315789, 9);
  });
  it("detects an under-round (arbitrage/error) book", () => {
    expect(overround([2.1, 2.1])).toBeLessThan(0);
  });
  it("needs at least two outcomes", () => {
    expect(() => bookSum([2])).toThrow();
  });
});

describe("removeMargin – proportional (spec default)", () => {
  it("matches the hand-computed 1X2 example", () => {
    // q = 0.5, 0.285714…, 0.25 ; Σ = 1.0357142857
    const r = removeMargin([2.0, 3.5, 4.0]);
    expect(r.appliedMethod).toBe("proportional");
    expect(r.overround).toBeCloseTo(0.0357142857, 9);
    expect(r.probabilities[0]).toBeCloseTo(0.4827586207, 9);
    expect(r.probabilities[1]).toBeCloseTo(0.2758620690, 9);
    expect(r.probabilities[2]).toBeCloseTo(0.2413793103, 9);
    expect(sum(r.probabilities)).toBeCloseTo(1, 12);
  });
  it("symmetric two-way market de-vigs to 50/50", () => {
    expect(removeMargin([1.9, 1.9]).probabilities).toEqual([0.5, 0.5]);
  });
  it("a margin-free book is returned unchanged", () => {
    const r = removeMargin([2, 4, 4]);
    expect(r.probabilities[0]).toBeCloseTo(0.5, 12);
    expect(r.probabilities[1]).toBeCloseTo(0.25, 12);
  });
});

describe.each(["power", "shin"] as const)("removeMargin – %s", (method) => {
  it("produces a probability distribution", () => {
    const r = removeMargin([1.4, 4.6, 8.5], method);
    expect(r.appliedMethod).toBe(method);
    expect(sum(r.probabilities)).toBeCloseTo(1, 9);
    r.probabilities.forEach((p) => expect(p).toBeGreaterThan(0));
  });
  it("removes proportionally more margin from the longshot than proportional does", () => {
    const odds = [1.4, 4.6, 8.5];
    const prop = removeMargin(odds, "proportional").probabilities;
    const alt = removeMargin(odds, method).probabilities;
    expect(alt[0]!).toBeGreaterThan(prop[0]!);
    expect(alt[2]!).toBeLessThan(prop[2]!);
  });
  it("agrees with proportional on a symmetric market", () => {
    const r = removeMargin([1.9, 1.9], method).probabilities;
    expect(r[0]).toBeCloseTo(0.5, 9);
  });
});

describe("removeMargin – Shin on under-round book", () => {
  it("falls back to proportional and reports it", () => {
    const r = removeMargin([2.1, 2.1], "shin");
    expect(r.appliedMethod).toBe("proportional");
    expect(r.probabilities[0]).toBeCloseTo(0.5, 12);
  });
});
