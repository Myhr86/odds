import { marketKey } from "../markets/types";
import type { OddsQuote } from "../providers/types";
import { evaluateDoubleChance, evaluateMarket, rankEvaluations, type EvaluateOptions, type SelectionEvaluation } from "./value-finder";

/**
 * Glue between provider quotes and the pure value-finder: groups quotes by
 * (event, canonical market), computes data ages from providerUpdatedAt (falls back to fetchedAt,
 * which is flagged), and evaluates each group.
 */
export interface PipelineEvaluation extends SelectionEvaluation {
  providerEventId: string;
  origin: OddsQuote["origin"];
  ageSource: "provider" | "fetched_at_fallback";
}

export function evaluateQuotes(
  quotes: readonly OddsQuote[],
  targetBookmaker: string,
  now: Date,
  opts: Omit<EvaluateOptions, "settlementVerified"> = {},
): PipelineEvaluation[] {
  const groups = new Map<string, OddsQuote[]>();
  for (const q of quotes) {
    const k = `${q.providerEventId}#${marketKey(q.market)}`;
    const arr = groups.get(k) ?? [];
    arr.push(q);
    groups.set(k, arr);
  }
  const age = (q: OddsQuote) => (now.getTime() - Date.parse(q.providerUpdatedAt ?? q.fetchedAt)) / 1000;
  const out: PipelineEvaluation[] = [];

  for (const group of groups.values()) {
    const target = group.find((q) => q.bookmaker.toLowerCase() === targetBookmaker.toLowerCase());
    if (!target) continue;
    const refs = group.filter((q) => q !== target);
    const settlementVerified = target.settlementVerified && refs.every((r) => r.settlementVerified);
    const evals = evaluateMarket(
      target.market,
      { bookmaker: target.bookmaker, prices: target.prices, ageSeconds: age(target) },
      refs.map((r) => ({ bookmaker: r.bookmaker, prices: r.prices, ageSeconds: age(r) })),
      { ...opts, settlementVerified },
    );
    const ageSource = group.some((q) => q.providerUpdatedAt === null) ? "fetched_at_fallback" : "provider";
    for (const e of evals) out.push({ ...e, providerEventId: target.providerEventId, origin: target.origin, ageSource });
  }
  return rankEvaluations(out);
}

export { evaluateDoubleChance };
