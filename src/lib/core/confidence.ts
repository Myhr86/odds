/**
 * Confidence score (0–100): a measure of DATA AND ANALYTICAL RELIABILITY for one
 * evaluated selection. It is NOT the probability that the bet wins.
 *
 * Score = 100 × Σ(weight_c × component_c) / Σ(weight_c) over AVAILABLE components.
 *
 * Phase-1 components (always available):
 *  coverage     w=0.30  min(1, effectiveBooks / fullCoverageBooks)               (Kish effective N of reference books)
 *  freshness    w=0.20  1 − worstAge / maxAge, clamped to [0,1]                  (worst of target and reference ages)
 *  agreement    w=0.25  1 − dispersion / maxDispersion, clamped                  (weighted SD of de-vigged prob. for the selection)
 *  sharpAnchor  w=0.15  1 if ≥1 high-reliability book contributed, else 0.4
 *  marketClean  w=0.10  1 for clean binary payoff, 0.6 for push/quarter lines, 0.5 for unverified settlement mapping
 *
 * Later-phase components (included only when supplied; otherwise the score is labelled
 * "data-quality only"):
 *  modelCalibration  w=0.15  1 − ECE / 0.10, clamped       (expected calibration error of the probability source)
 *  trackRecord       w=0.10  min(1, n / 500) × clamp(0.5 + CLV×10, 0, 1)   (historical sample & CLV in this segment)
 *
 * All constants are configurable starting values, not proven optima.
 */

export interface ConfidenceInputs {
  effectiveBooks: number;
  worstAgeSeconds: number;
  selectionDispersion: number;
  hasSharpAnchor: boolean;
  marketCleanliness: "clean" | "approximate" | "unverified_settlement";
  modelCalibrationEce?: number;
  trackRecord?: { n: number; meanClv: number };
}

export interface ConfidenceConfig {
  fullCoverageBooks: number;
  maxAgeSeconds: number;
  maxDispersion: number;
  weights: { coverage: number; freshness: number; agreement: number; sharpAnchor: number; marketClean: number; modelCalibration: number; trackRecord: number };
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  fullCoverageBooks: 6,
  maxAgeSeconds: 120,
  maxDispersion: 0.03,
  weights: { coverage: 0.3, freshness: 0.2, agreement: 0.25, sharpAnchor: 0.15, marketClean: 0.1, modelCalibration: 0.15, trackRecord: 0.1 },
};

export interface ConfidenceResult {
  score: number; // integer 0..100
  components: Record<string, { value: number; weight: number }>;
  scope: "data-quality only" | "data + model";
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function confidenceScore(inp: ConfidenceInputs, cfg: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG): ConfidenceResult {
  const w = cfg.weights;
  const components: ConfidenceResult["components"] = {
    coverage: { value: clamp01(inp.effectiveBooks / cfg.fullCoverageBooks), weight: w.coverage },
    freshness: { value: clamp01(1 - inp.worstAgeSeconds / cfg.maxAgeSeconds), weight: w.freshness },
    agreement: { value: clamp01(1 - inp.selectionDispersion / cfg.maxDispersion), weight: w.agreement },
    sharpAnchor: { value: inp.hasSharpAnchor ? 1 : 0.4, weight: w.sharpAnchor },
    marketClean: {
      value: inp.marketCleanliness === "clean" ? 1 : inp.marketCleanliness === "approximate" ? 0.6 : 0.5,
      weight: w.marketClean,
    },
  };
  if (inp.modelCalibrationEce !== undefined) {
    components.modelCalibration = { value: clamp01(1 - inp.modelCalibrationEce / 0.1), weight: w.modelCalibration };
  }
  if (inp.trackRecord) {
    const { n, meanClv } = inp.trackRecord;
    components.trackRecord = { value: clamp01(n / 500) * clamp01(0.5 + meanClv * 10), weight: w.trackRecord };
  }
  let num = 0;
  let den = 0;
  for (const c of Object.values(components)) {
    num += c.value * c.weight;
    den += c.weight;
  }
  return {
    score: Math.round((100 * num) / den),
    components,
    scope: components.modelCalibration || components.trackRecord ? "data + model" : "data-quality only",
  };
}
