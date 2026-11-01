import { marketKey, type MarketType } from "../markets/types";
import type { OddsQuote } from "../providers/types";
import { evaluateDoubleChance, evaluateMarket, rankEvaluations, type EvaluateOptions, type SelectionEvaluation } from "./value-finder";

/**
 * Glue between provider quotes and the pure value finder. Groups quotes by
 * (event, canonical market), computes data ages, and evaluates each group.
 *
 * Age basis:
 *  - "provider_updated" (default): now − providerUpdatedAt (falls back to fetchedAt).
 *  - "fetched": now − fetchedAt. Use this when the provider only returns prices that are currently
 *    offered, so a successful fetch confirms the price. A price that hasn't changed for 20 minutes
 *    is still valid. The Odds API's `last_update` reports the last CHANGE, so option A uses "fetched".
 */
export interface PipelineEvaluation extends SelectionEvaluation {
  providerEventId: string;
  origin: OddsQuote["origin"];
  ageSource: "provider" | "fetched_at_fallback" | "fetched";
}

export interface PipelineOptions extends Omit<EvaluateOptions, "settlementVerified"> {
  ageBasis?: "provider_updated" | "fetched";
  /**
   * Market types whose reference-provider settlement a human has checked against Norsk Tipping's
   * rules (Settings page). Overrides the adapter's settlementVerified=false for those types.
   */
  verifiedMarketTypes?: readonly MarketType[];
}

export function evaluateQuotes(quotes: readonly OddsQuote[], targetBookmaker: string, now: Date, opts: PipelineOptions = {}): PipelineEvaluation[] {
  const groups = new Map<string, OddsQuote[]>();
  for (const q of quotes) {
    const k = `${q.providerEventId}#${marketKey(q.market)}`;
    const arr = groups.get(k) ?? [];
    arr.push(q);
    groups.set(k, arr);
  }
  const basis = opts.ageBasis ?? "provider_updated";
  // Tolerate up to 5 s of clock skew (timestamps slightly in the future count as age 0); larger
  // negative ages stay negative and are rejected as invalid by the consensus.
  const age = (q: OddsQuote) => {
    const a = (now.getTime() - Date.parse(basis === "fetched" ? q.fetchedAt : (q.providerUpdatedAt ?? q.fetchedAt))) / 1000;
    return a < 0 && a >= -5 ? 0 : a;
  };
  const verifiedTypes = new Set(opts.verifiedMarketTypes ?? []);
  const isVerified = (q: OddsQuote) => q.settlementVerified || verifiedTypes.has(q.market.type);
  const out: PipelineEvaluation[] = [];

  for (const group of groups.values()) {
    const target = group.find((q) => q.bookmaker.toLowerCase() === targetBookmaker.toLowerCase());
    if (!target) continue;
    const refs = group.filter((q) => q !== target);
    const settlementVerified = isVerified(target) && refs.every(isVerified);
    const evals = evaluateMarket(
      target.market,
      { bookmaker: target.bookmaker, prices: target.prices, ageSeconds: age(target) },
      refs.map((r) => ({ bookmaker: r.bookmaker, prices: r.prices, ageSeconds: age(r) })),
      { ...opts, settlementVerified },
    );
    const ageSource: PipelineEvaluation["ageSource"] = basis === "fetched" ? "fetched" : group.some((q) => q.providerUpdatedAt === null) ? "fetched_at_fallback" : "provider";
    for (const e of evals) out.push({ ...e, providerEventId: target.providerEventId, origin: target.origin, ageSource });
  }
  return rankEvaluations(out);
}

export { evaluateDoubleChance };
