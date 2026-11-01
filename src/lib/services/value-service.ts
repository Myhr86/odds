import type { Db } from "../db/client";
import { evaluateQuotes, type PipelineEvaluation } from "../core/pipeline";
import { evaluateDoubleChance, rankEvaluations, type SelectionEvaluation } from "../core/value-finder";
import { marketKey as marketKeyOf, type CanonicalMarket } from "../markets/types";
import { manualQuote } from "../providers/manual/manual-quote";
import type { ProviderEvent, UnmappedMarket } from "../providers/types";
import { DEMO_SHARP, type ReferenceSource } from "./references";
import { getSettings, logSync, recordEvaluations, storeQuotes, upsertEvent } from "./repo";

export const TARGET = "Norsk Tipping";

export interface ManualMarketInput {
  market: CanonicalMarket;
  prices: Record<string, number>;
}

export interface EvaluationResponse {
  event: ProviderEvent & { eventId: number };
  evaluations: Array<SelectionEvaluation & { origin: string }>;
  referenceBooks: string[];
  unmapped: UnmappedMarket[];
  fetchedAt: string;
  cached: boolean;
  creditsUsed: number;
  creditsRemaining: number | null;
  recorded: number;
  isDemo: boolean;
  referenceMarkets: string[];
}

/**
 * Option A flow: the user picked an event from the reference provider and typed Norsk Tipping prices.
 * 1. fetch (cached) reference odds for the league  2. store all prices (history on change)
 * 3. evaluate with fetched-age basis  4. record every evaluation with a valid EV (immutable).
 */
export async function evaluateManual(db: Db, source: ReferenceSource, league: string, providerEventId: string, inputs: ManualMarketInput[], now = new Date()): Promise<EvaluationResponse> {
  if (!inputs.length) throw new Error("Enter at least one Norsk Tipping price");
  const ev = (await source.events(league)).find((e) => e.providerEventId === providerEventId);
  if (!ev) throw new Error("Match not found in the reference provider's upcoming events (it may have started)");
  const settings = await getSettings(db);
  const isDemo = source.kind === "demo";

  let refs;
  try {
    refs = await source.odds(league, providerEventId);
  } catch (e) {
    await logSync(db, { provider: source.provider, job: `odds:${league}`, ok: false, requestsUsed: 0, quotes: 0, changes: 0, error: (e as Error).message });
    throw e;
  }
  // Evaluate "as of" the moment both sides are known: never before the reference fetch completed.
  now = new Date(Math.max(now.getTime(), Date.parse(refs.fetchedAt)));
  const providerId = isDemo ? "demo" : source.provider;
  const eventId = await upsertEvent(db, ev, providerId, `${league}:${providerEventId}`);
  // manualQuote validates (throws on typos) before anything is stored.
  const allNt = inputs.map((i) => manualQuote({ providerEventId, market: i.market, prices: i.prices, enteredAt: now }));
  const ntQuotes = allNt.filter((q) => q.market.type !== "DOUBLE_CHANCE");
  const dcInputs = inputs.filter((i) => i.market.type === "DOUBLE_CHANCE");
  const changes = await storeQuotes(db, eventId, [...refs.quotes, ...allNt], TARGET);
  if (!refs.cached) {
    await logSync(db, { provider: source.provider, job: `odds:${league}`, ok: true, requestsUsed: refs.creditsUsed, quotes: refs.quotes.length, changes, rateLimit: { creditsRemaining: refs.creditsRemaining } });
  }

  const common = {
    thresholds: settings.thresholds,
    ...(isDemo ? { sharpBookmakers: DEMO_SHARP, consensus: { reliabilityWeights: { "Demo Sharp": 3, "Demo Exchange": 2.5 } } } : {}),
  };
  const evals: Array<PipelineEvaluation | (SelectionEvaluation & { origin: string })> = evaluateQuotes([...refs.quotes, ...ntQuotes], TARGET, now, {
    ...common,
    ageBasis: "fetched",
    verifiedMarketTypes: isDemo ? ["MATCH_RESULT", "TOTAL_GOALS"] : settings.verifiedMarketTypes,
  });
  const age = (iso: string) => (now.getTime() - Date.parse(iso)) / 1000;
  for (const d of dcInputs) {
    const mr = refs.quotes.filter((q) => q.market.type === "MATCH_RESULT" && q.market.period === d.market.period);
    const verified = isDemo || settings.verifiedMarketTypes.includes("MATCH_RESULT");
    const res = evaluateDoubleChance(d.market.period, { bookmaker: TARGET, prices: d.prices, ageSeconds: 0 }, mr.map((q) => ({ bookmaker: q.bookmaker, prices: q.prices, ageSeconds: age(q.fetchedAt) })), { ...common, settlementVerified: verified });
    evals.push(...res.filter((r) => d.prices[r.outcome] !== undefined).map((r) => ({ ...r, origin: "MANUAL" })));
  }
  // Only evaluations for prices the user actually entered.
  const entered = (e: SelectionEvaluation) => inputs.some((i) => e.marketKey === marketKeyOf(i.market) && i.prices[e.outcome] !== undefined);
  const final = rankEvaluations(evals.filter(entered));
  const recorded = await recordEvaluations(db, eventId, final, { thresholds: settings.thresholds, isDemo, targetOrigin: "MANUAL" });

  return {
    event: { ...ev, eventId },
    evaluations: final,
    referenceBooks: [...new Set(refs.quotes.map((q) => q.bookmaker))].sort(),
    referenceMarkets: [...new Set(refs.quotes.map((q) => marketKeyOf(q.market)))].sort(),
    unmapped: refs.unmapped,
    fetchedAt: refs.fetchedAt,
    cached: refs.cached,
    creditsUsed: refs.creditsUsed,
    creditsRemaining: refs.creditsRemaining,
    recorded,
    isDemo,
  };
}

