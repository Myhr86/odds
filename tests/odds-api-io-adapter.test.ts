import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { OddsApiIoProvider } from "@/lib/providers/odds-api-io/client";
import { normaliseTimestamp, parseOddsEvent } from "@/lib/providers/odds-api-io/parse";
import { evaluateQuotes } from "@/lib/core/pipeline";
import { marketKey } from "@/lib/markets/types";

// NOTE: integration tests run against a SYNTHETIC fixture shaped after the public docs, with a mocked
// fetch. Once `npm run probe:odds-api-io` has recorded real responses, add them under fixtures/recorded
// and the "recorded fixtures" suite below will parse every one of them.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/synthetic/odds-api-io-odds-multi.synthetic.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-01T12:00:00Z");

function mockFetch(routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }[]>) {
  const calls: URL[] = [];
  const impl = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url);
    const queue = routes[url.pathname];
    if (!queue?.length) return new Response("not found", { status: 404 });
    const r = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("odds-api.io parser", () => {
  const res = parseOddsEvent(fixture[0], NOW.toISOString());

  it("parses the event", () => {
    expect(res.event).toMatchObject({ providerEventId: "900001", home: "Synthetic Home FC", sport: "football", status: "scheduled", startsAt: "2026-11-02T18:00:00.000Z" });
  });
  it("maps ML and Totals to canonical markets, coercing string odds", () => {
    const nt = res.quotes.filter((q) => q.bookmaker === "Norsk Tipping");
    expect(nt.map((q) => marketKey(q.market)).sort()).toEqual(["football|MATCH_RESULT|FT_REGULAR|-|-", "football|TOTAL_GOALS|FT_REGULAR|2.5|-"]);
    expect(nt.find((q) => q.market.type === "MATCH_RESULT")!.prices).toEqual({ home: 2.3, draw: 3.3, away: 3.0 });
  });
  it("keeps separate lines separate", () => {
    const lines = res.quotes.filter((q) => q.bookmaker === "Pinnacle" && q.market.type === "TOTAL_GOALS").map((q) => q.market.line);
    expect(lines.sort()).toEqual([2.25, 2.5]);
  });
  it("normalises epoch-ms and ISO timestamps", () => {
    expect(res.quotes.find((q) => q.bookmaker === "Pinnacle" && q.market.line === 2.5)!.providerUpdatedAt).toBe("2026-11-01T11:59:40.000Z");
    expect(normaliseTimestamp(1793534380)).toBe("2026-11-01T11:59:40.000Z");
    expect(normaliseTimestamp("garbage")).toBeNull();
  });
  it("reports unmapped markets and invalid entries instead of silently dropping them", () => {
    expect(res.unmapped.map((u) => `${u.bookmaker}:${u.providerMarketName}:${u.reason}`)).toEqual([
      "Bet365:Corners Totals:no mapping rule",
      "Unibet:Totals:fields do not match any rule",
    ]);
  });
  it("marks every mapping as settlement-unverified until verified against real data", () => {
    expect(res.quotes.every((q) => q.settlementVerified === false)).toBe(true);
  });
  it("feeds the value pipeline end-to-end (capped at WATCHLIST while unverified)", () => {
    const evals = evaluateQuotes(res.quotes, "Norsk Tipping", NOW);
    const over = evals.find((e) => e.marketKey.includes("TOTAL_GOALS") && e.outcome === "over")!;
    expect(over.consensus.nBooks).toBe(3);
    expect(over.ev!).toBeGreaterThan(0);
    expect(over.category).toBe("WATCHLIST");
    expect(evals.every((e) => e.category !== "EXCELLENT_VALUE" && e.category !== "POTENTIAL_VALUE")).toBe(true);
  });
});

describe("OddsApiIoProvider (mocked HTTP)", () => {
  it("refuses to construct without a key", () => {
    expect(() => new OddsApiIoProvider({ apiKey: "" })).toThrow(/ODDS_API_IO_KEY/);
  });
  it("batches /odds/multi in groups of 10 and sends key + bookmakers server-side", async () => {
    const { impl, calls } = mockFetch({ "/v3/odds/multi": [{ body: fixture }] });
    const p = new OddsApiIoProvider({ apiKey: "SECRET", fetchImpl: impl, now: () => NOW });
    const ids = Array.from({ length: 23 }, (_, i) => String(i));
    const out = await p.getOdds(ids, ["Norsk Tipping", "Pinnacle"]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.searchParams.get("eventIds")!.split(",")).toHaveLength(10);
    expect(calls[2]!.searchParams.get("eventIds")!.split(",")).toHaveLength(3);
    expect(calls[0]!.searchParams.get("apiKey")).toBe("SECRET");
    expect(calls[0]!.searchParams.get("bookmakers")).toBe("Norsk Tipping,Pinnacle");
    expect(out).toHaveLength(3);
  });
  it("retries on 429 then succeeds, capturing rate-limit headers", async () => {
    vi.useFakeTimers();
    const { impl, calls } = mockFetch({
      "/v3/events": [
        { status: 429, body: "slow down", headers: { "retry-after": "1" } },
        { body: [{ id: 1, home: "H", away: "A", date: "2026-11-02T18:00:00Z", status: "pending", sport: { name: "Football", slug: "football" }, league: { name: "L" } }], headers: { "x-ratelimit-remaining": "4999" } },
      ],
    });
    const p = new OddsApiIoProvider({ apiKey: "SECRET", fetchImpl: impl });
    const promise = p.getEvents({ sport: "football", bookmaker: "Norsk Tipping" });
    await vi.runAllTimersAsync();
    const events = await promise;
    vi.useRealTimers();
    expect(calls).toHaveLength(2);
    expect(events[0]!.providerEventId).toBe("1");
    expect(p.lastRateLimit["x-ratelimit-remaining"]).toBe("4999");
  });
  it("never leaks the API key in errors", async () => {
    const { impl } = mockFetch({ "/v3/odds/multi": [{ status: 401, body: "bad key SECRET" }] });
    const p = new OddsApiIoProvider({ apiKey: "SECRET", fetchImpl: impl, maxRetries: 0 });
    const err = await p.getOdds(["1"], ["Pinnacle"]).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("SECRET");
    expect(String((err as Error).message)).toContain("HTTP 401");
  });
  it("provider status reports failure without throwing", async () => {
    const { impl } = mockFetch({ "/v3/sports": [{ status: 503, body: "down" }] });
    const p = new OddsApiIoProvider({ apiKey: "K", fetchImpl: impl, maxRetries: 0 });
    const s = await p.getProviderStatus();
    expect(s.ok).toBe(false);
    expect(s.message).toMatch(/503/);
  });
});

describe("recorded fixtures (populated by the probe)", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../fixtures/recorded/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.startsWith("odds-") && f.endsWith(".json"));
  it.skipIf(files.length === 0)("every recorded odds response parses", () => {
    for (const f of files) {
      const raw = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      for (const ev of Array.isArray(raw) ? raw : [raw]) expect(() => parseOddsEvent(ev, NOW.toISOString())).not.toThrow();
    }
  });
});
