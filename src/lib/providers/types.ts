import type { CanonicalMarket } from "../markets/types";

/**
 * Provider-independent contracts. Every provider (odds-api.io, a future second odds feed,
 * the DEMO provider) implements OddsProvider; application code depends only on these types.
 * Adapters run SERVER-SIDE only – they read API keys from the environment.
 */

export type DataOrigin = "LIVE_PROVIDER" | "MANUAL" | "DEMO";

export interface ProviderEvent {
  provider: string;
  /** Provider's own event id (string to support any provider). */
  providerEventId: string;
  sport: string;
  league: { name: string; slug?: string; country?: string };
  home: string;
  away: string;
  /** Kick-off, ISO-8601 UTC. */
  startsAt: string;
  status: "scheduled" | "live" | "finished" | "cancelled" | "unknown";
  origin: DataOrigin;
}

export interface OddsQuote {
  provider: string;
  providerEventId: string;
  bookmaker: string;
  /** Provider market name exactly as received (kept for audit). */
  providerMarketName: string;
  market: CanonicalMarket;
  /** outcome -> decimal odds. */
  prices: Record<string, number>;
  /** When the BOOKMAKER price last changed, per the provider (UTC ISO). Null if the provider omits it. */
  providerUpdatedAt: string | null;
  /** When WE received it (UTC ISO). */
  fetchedAt: string;
  /** Whether the provider→canonical mapping has verified settlement rules (period, ET, push handling). */
  settlementVerified: boolean;
  origin: DataOrigin;
}

export interface UnmappedMarket {
  bookmaker: string;
  providerMarketName: string;
  reason: string;
  sample?: unknown;
}

export interface OddsResult {
  event: ProviderEvent | null;
  quotes: OddsQuote[];
  unmapped: UnmappedMarket[];
}

export interface ProviderStatus {
  provider: string;
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  /** Rate limit info if the provider exposes it (header names vary by provider). */
  rateLimit: Record<string, string>;
  message?: string;
  origin: DataOrigin;
}

export interface EventQuery {
  sport: string;
  league?: string;
  /** Restrict to events the target bookmaker prices. */
  bookmaker?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface OddsUpdate {
  quote: OddsQuote;
}

export interface Subscription {
  close(): void;
}

export interface OddsProvider {
  readonly name: string;
  readonly origin: DataOrigin;
  getEvents(q: EventQuery): Promise<ProviderEvent[]>;
  getOdds(providerEventIds: string[], bookmakers: string[]): Promise<OddsResult[]>;
  /** Historical snapshots for one event, if the provider/plan supports it. */
  getHistoricalOdds(providerEventId: string, bookmakers: string[]): Promise<OddsResult>;
  /** Real-time updates, only if VERIFIED to be available for the bookmakers concerned. */
  subscribeToUpdates?(bookmakers: string[], onUpdate: (u: OddsUpdate) => void, onError: (e: Error) => void): Subscription;
  getProviderStatus(): Promise<ProviderStatus>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
