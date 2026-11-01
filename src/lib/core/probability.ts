/**
 * Probability primitives and bookmaker-margin removal.
 *
 * All odds are DECIMAL odds (European format, stake included), e.g. 2.20.
 * All probabilities are in [0, 1].
 */

export class InvalidOddsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOddsError";
  }
}

/** Decimal odds must be finite and strictly greater than 1.0 (a 1.00 price returns nothing). */
export function assertValidDecimalOdds(odds: number): void {
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1) {
    throw new InvalidOddsError(`Invalid decimal odds: ${String(odds)} (must be finite and > 1)`);
  }
}

export function assertValidProbability(p: number): void {
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new RangeError(`Invalid probability: ${String(p)} (must be in the open interval (0, 1))`);
  }
}

/** P = 1 / odds. This is the bookmaker's *implied* probability and still contains margin. */
export function impliedProbability(odds: number): number {
  assertValidDecimalOdds(odds);
  return 1 / odds;
}

/** Fair odds = 1 / fair probability. */
export function fairOdds(probability: number): number {
  assertValidProbability(probability);
  return 1 / probability;
}

/** Sum of implied probabilities of a complete market ("book"). 1.05 => 5% overround. */
export function bookSum(odds: readonly number[]): number {
  if (odds.length < 2) throw new RangeError("A complete market needs at least 2 outcomes");
  return odds.reduce((acc, o) => acc + impliedProbability(o), 0);
}

/** Overround (bookmaker margin) as a fraction: bookSum - 1. Negative => the book is under-round (arb / error). */
export function overround(odds: readonly number[]): number {
  return bookSum(odds) - 1;
}

export type MarginMethod = "proportional" | "power" | "shin";

export interface MarginRemovalResult {
  /** Margin-free probabilities, same order as input; sum to 1 (within 1e-9). */
  probabilities: number[];
  overround: number;
  /** Method requested. */
  method: MarginMethod;
  /** Method actually applied (may fall back to proportional, e.g. Shin on an under-round book). */
  appliedMethod: MarginMethod;
  /** Method parameter: power exponent k, or Shin's z. Undefined for proportional. */
  parameter?: number;
}

/**
 * Remove bookmaker margin from a COMPLETE, MUTUALLY EXCLUSIVE market
 * (e.g. 1X2, Over/Under 2.5, BTTS Yes/No, AH -0.5 home/away).
 *
 * Do NOT pass overlapping markets such as Double Chance (1X, 12, X2) – derive those
 * from a margin-free 1X2 instead (see markets/derived.ts).
 *
 * Methods:
 *  - proportional (default, as specified): p_i = q_i / Σq. Simple, transparent.
 *  - power: p_i = q_i^k with k chosen so Σp = 1. Removes more margin from longshots,
 *    partially correcting the favourite-longshot bias.
 *  - shin: Shin (1993) insider-trading model; similar intent to power.
 * Proportional is used for the official consensus unless configured otherwise.
 */
export function removeMargin(odds: readonly number[], method: MarginMethod = "proportional"): MarginRemovalResult {
  const q = odds.map(impliedProbability);
  if (q.length < 2) throw new RangeError("A complete market needs at least 2 outcomes");
  const sum = q.reduce((a, b) => a + b, 0);
  const or = sum - 1;

  const proportional = (): MarginRemovalResult => ({
    probabilities: q.map((x) => x / sum),
    overround: or,
    method,
    appliedMethod: "proportional",
  });

  if (method === "proportional" || Math.abs(or) < 1e-12) return proportional();

  if (method === "power") {
    // f(k) = Σ q_i^k - 1 is strictly decreasing in k for q_i in (0,1).
    const f = (k: number) => q.reduce((a, x) => a + Math.pow(x, k), 0) - 1;
    const k = bisect(f, 1e-3, 100);
    if (k === null) return proportional();
    const p = q.map((x) => Math.pow(x, k));
    const s = p.reduce((a, b) => a + b, 0);
    return { probabilities: p.map((x) => x / s), overround: or, method, appliedMethod: "power", parameter: k };
  }

  // Shin: p_i(z) = (sqrt(z^2 + 4(1-z) q_i^2 / S) - z) / (2(1-z)); find z in [0,1) with Σp = 1.
  if (sum <= 1) return proportional(); // Shin's z is undefined for an under-round book.
  const shinP = (z: number) => q.map((x) => (Math.sqrt(z * z + (4 * (1 - z) * x * x) / sum) - z) / (2 * (1 - z)));
  const g = (z: number) => shinP(z).reduce((a, b) => a + b, 0) - 1;
  const z = bisect(g, 0, 0.999);
  if (z === null) return proportional();
  const p = shinP(z);
  const s = p.reduce((a, b) => a + b, 0);
  return { probabilities: p.map((x) => x / s), overround: or, method, appliedMethod: "shin", parameter: z };
}

/** Bisection root finder for a monotone function. Returns null if no sign change in [lo, hi]. */
function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-12, maxIter = 200): number | null {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tol || (hi - lo) / 2 < tol) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
