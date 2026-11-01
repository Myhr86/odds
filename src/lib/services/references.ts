import { DemoOddsProvider } from "../providers/demo/demo-provider";
import { TheOddsApiProvider } from "../providers/the-odds-api/client";
import type { OddsQuote, ProviderEvent, UnmappedMarket } from "../providers/types";

/**
 * Where reference (non-Norsk Tipping) odds come from.
 *  - live: The Odds API (THE_ODDS_API_KEY set). League lists and events are free; odds cost credits.
 *  - demo: synthetic data, clearly labelled, used when no key is configured.
 * Odds are fetched per LEAGUE (one call covers every match in it) and cached for
 * REF_CACHE_SECONDS (default 90 s, below the 120 s freshness limit) to save credits.
 */
export interface League {
  key: string;
  title: string;
}

export interface ReferenceOdds {
  quotes: OddsQuote[];
  unmapped: UnmappedMarket[];
  fetchedAt: string;
  cached: boolean;
  creditsUsed: number;
  creditsRemaining: number | null;
}

export interface ReferenceSource {
  kind: "live" | "demo";
  provider: string;
  leagues(): Promise<League[]>;
  events(league: string): Promise<ProviderEvent[]>;
  odds(league: string, providerEventId: string): Promise<ReferenceOdds>;
  creditsRemaining(): number | null;
  creditsPerCall: number;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}
const g = globalThis as unknown as { __oiRefCache?: Map<string, CacheEntry<unknown>>; __oiRefSource?: ReferenceSource };
const cache = (g.__oiRefCache ??= new Map());

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  if (e && Date.now() - e.at < ttlMs) return { value: e.value, hit: true };
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return { value, hit: false };
}

const refTtl = () => Number(process.env.REF_CACHE_SECONDS ?? 90) * 1000;

class LiveSource implements ReferenceSource {
  readonly kind = "live" as const;
  readonly provider = "the-odds-api";
  constructor(private readonly api: TheOddsApiProvider) {}
  get creditsPerCall() {
    return this.api.creditsPerOddsCall;
  }
  creditsRemaining() {
    return this.api.usage.remaining;
  }
  async leagues() {
    const { value } = await cached("leagues", 3_600_000, async () => (await this.api.getFootballLeagues()).map((s) => ({ key: s.key, title: s.title })));
    return value.sort((a, b) => a.title.localeCompare(b.title));
  }
  async events(league: string) {
    const now = new Date();
    const { value } = await cached(`events:${league}`, 600_000, () =>
      this.api.getEvents({ sport: "football", league, from: now.toISOString().replace(/\.\d{3}Z$/, "Z") }),
    );
    return value.filter((e) => Date.parse(e.startsAt) > Date.now());
  }
  async odds(league: string, providerEventId: string): Promise<ReferenceOdds> {
    const before = this.api.usage.used;
    const { value, hit } = await cached(`odds:${league}`, refTtl(), async () => ({ results: await this.api.getLeagueOdds(league), fetchedAt: new Date().toISOString() }));
    const r = value.results.find((x) => x.event?.providerEventId === providerEventId);
    return {
      quotes: r?.quotes ?? [],
      unmapped: r?.unmapped ?? [],
      fetchedAt: value.fetchedAt,
      cached: hit,
      creditsUsed: hit ? 0 : before === null || this.api.usage.used === null ? this.creditsPerCall : this.api.usage.used - before,
      creditsRemaining: this.api.usage.remaining,
    };
  }
}

class DemoSource implements ReferenceSource {
  readonly kind = "demo" as const;
  readonly provider = "demo";
  readonly creditsPerCall = 0;
  private readonly demo = new DemoOddsProvider(Date.now() % 100000);
  creditsRemaining() {
    return null;
  }
  async leagues() {
    return [{ key: "demo_league", title: "DEMO League (synthetic data)" }];
  }
  async events() {
    const { value } = await cached("demo:events", 3_600_000, () => this.demo.getEvents());
    return value;
  }
  async odds(_league: string, providerEventId: string): Promise<ReferenceOdds> {
    const [r] = await this.demo.getOdds([providerEventId], this.demo.referenceBookmakers);
    return { quotes: r?.quotes ?? [], unmapped: [], fetchedAt: new Date().toISOString(), cached: false, creditsUsed: 0, creditsRemaining: null };
  }
}

export function getReferenceSource(): ReferenceSource {
  if (g.__oiRefSource) return g.__oiRefSource;
  const key = process.env.THE_ODDS_API_KEY;
  g.__oiRefSource = key
    ? new LiveSource(new TheOddsApiProvider({ apiKey: key, regions: (process.env.THE_ODDS_API_REGIONS ?? "eu").split(","), markets: (process.env.THE_ODDS_API_MARKETS ?? "h2h,totals").split(",") }))
    : new DemoSource();
  return g.__oiRefSource;
}

export const DEMO_SHARP = ["Demo Sharp", "Demo Exchange"];
