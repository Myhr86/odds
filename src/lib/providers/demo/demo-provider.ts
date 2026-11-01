import type { OddsProvider, OddsQuote, OddsResult, ProviderEvent, ProviderStatus } from "../types";

/**
 * ⚠ DEMO PROVIDER – SYNTHETIC DATA ⚠
 * Fictional teams and randomly generated (seeded) prices for development and UI work when no
 * API key is configured. Every object carries origin = "DEMO" and the UI must label it.
 * Nothing produced here says anything about real Norsk Tipping or market prices.
 */
export class DemoOddsProvider implements OddsProvider {
  readonly name = "demo";
  readonly origin = "DEMO" as const;
  private rand: () => number;
  constructor(
    seed = 42,
    private readonly now: () => Date = () => new Date(),
    readonly targetBookmaker = "Norsk Tipping",
    readonly referenceBookmakers = ["Demo Sharp", "Demo Exchange", "Demo Book A", "Demo Book B", "Demo Book C"],
  ) {
    this.rand = mulberry32(seed);
  }

  async getEvents(): Promise<ProviderEvent[]> {
    const base = this.now().getTime();
    return Array.from({ length: 6 }, (_, i) => ({
      provider: this.name,
      providerEventId: `demo-${i + 1}`,
      sport: "football",
      league: { name: "DEMO League" },
      home: `Demo Team ${2 * i + 1}`,
      away: `Demo Team ${2 * i + 2}`,
      startsAt: new Date(base + (i + 2) * 3_600_000).toISOString(),
      status: "scheduled" as const,
      origin: "DEMO" as const,
    }));
  }

  async getOdds(ids: string[], bookmakers: string[]): Promise<OddsResult[]> {
    const events = await this.getEvents();
    const fetchedAt = this.now().toISOString();
    return ids.map((id) => {
      const event = events.find((e) => e.providerEventId === id) ?? null;
      const pOver = 0.35 + this.rand() * 0.3;
      const quotes: OddsQuote[] = bookmakers.map((bk) => {
        const isTarget = bk === this.targetBookmaker;
        const margin = isTarget ? 0.06 + this.rand() * 0.04 : 0.02 + this.rand() * 0.04;
        const noise = (this.rand() - 0.5) * (isTarget ? 0.08 : 0.02);
        const p = Math.min(0.9, Math.max(0.1, pOver + noise));
        const k = 1 + margin;
        return {
          provider: this.name,
          providerEventId: id,
          bookmaker: bk,
          providerMarketName: "DEMO Totals 2.5",
          market: { sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR", line: 2.5 },
          prices: { over: round2(1 / (p * k)), under: round2(1 / ((1 - p) * k)) },
          providerUpdatedAt: new Date(this.now().getTime() - Math.floor(this.rand() * 60_000)).toISOString(),
          fetchedAt,
          settlementVerified: true,
          origin: "DEMO",
        };
      });
      return { event, quotes, unmapped: [] };
    });
  }

  async getHistoricalOdds(id: string, bookmakers: string[]): Promise<OddsResult> {
    return (await this.getOdds([id], bookmakers))[0]!;
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    return { provider: this.name, ok: true, checkedAt: this.now().toISOString(), latencyMs: 0, rateLimit: {}, message: "DEMO data – synthetic", origin: "DEMO" };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
