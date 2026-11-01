import { isComplete, marketKey, OUTCOMES, validateMarket, type CanonicalMarket } from "../../markets/types";
import type { OddsQuote } from "../types";

/**
 * Option A: Norsk Tipping prices are typed in by the user from the Oddsen app/site.
 * They are stored with provider "manual" and origin "MANUAL"; the entry time is the timestamp.
 * The user confirms that the Norsk Tipping market settles like the canonical one (e.g. Oddsen
 * "HUB" = 90 minutes) – the reference side remains unverified until provider docs are checked.
 */
export const MANUAL_PROVIDER = "manual";

export interface ManualEntry {
  providerEventId: string; // the reference provider's event id the user picked
  market: CanonicalMarket;
  prices: Record<string, number>;
  enteredAt: Date;
  bookmaker?: string;
}

export function validateManualPrices(market: CanonicalMarket, prices: Record<string, number>): string[] {
  const errors: string[] = [];
  try {
    validateMarket(market);
  } catch (e) {
    errors.push((e as Error).message);
    return errors;
  }
  const allowed = new Set(OUTCOMES[market.type]);
  for (const [k, v] of Object.entries(prices)) {
    if (!allowed.has(k)) errors.push(`Unknown outcome "${k}" for ${market.type}`);
    else if (!Number.isFinite(v) || v <= 1 || v > 1000) errors.push(`Odds for ${k} must be a decimal number between 1.01 and 1000`);
  }
  if (!Object.keys(prices).length) errors.push("Enter at least one price");
  // If complete, Norsk Tipping's own book should be over-round; under-round almost certainly means a typo.
  if (!errors.length && isComplete({ market, prices })) {
    const sum = OUTCOMES[market.type].reduce((a, o) => a + 1 / prices[o]!, 0);
    if (sum < 1) errors.push(`These prices sum to ${(sum * 100).toFixed(1)}% implied probability (<100%) – probably a typo`);
  }
  return errors;
}

export function manualQuote(e: ManualEntry): OddsQuote {
  const errs = validateManualPrices(e.market, e.prices);
  if (errs.length) throw new Error(errs.join("; "));
  marketKey(e.market);
  const at = e.enteredAt.toISOString();
  return {
    provider: MANUAL_PROVIDER,
    providerEventId: e.providerEventId,
    bookmaker: e.bookmaker ?? "Norsk Tipping",
    providerMarketName: "manual entry",
    market: e.market,
    prices: e.prices,
    providerUpdatedAt: at,
    fetchedAt: at,
    settlementVerified: true,
    origin: "MANUAL",
  };
}
