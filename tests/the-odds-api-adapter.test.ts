import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { TheOddsApiProvider } from "@/lib/providers/the-odds-api/client";
import { parseOddsEvent } from "@/lib/providers/the-odds-api/parse";
import { manualQuote, validateManualPrices } from "@/lib/providers/manual/manual-quote";
import { evaluateQuotes } from "@/lib/core/pipeline";
import { marketKey } from "@/lib/markets/types";

// SYNTHETIC fixture in the documented v4 shape, with a mocked fetch. Not a recorded response.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/synthetic/the-odds-api-odds.synthetic.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-01T12:00:00Z");

describe("The Odds API parser", () => {
  const r = parseOddsEvent(fixture[0], NOW.toISOString());
  it("maps h2h by team name and canonicalises bookmaker names", () => {
    const bf = r.quotes.find((q) => q.bookmaker === "Betfair Exchange" && q.market.type === "MATCH_RESULT")!;
    expect(bf.prices).toEqual({ home: 2.14, draw: 3.6, away: 3.65 });
  });
  it("maps totals and spreads (home-perspective line)", () => {
    const keys = r.quotes.filter((q) => q.bookmaker === "Pinnacle").map((q) => marketKey(q.market)).sort();
    expect(keys).toEqual(["football|ASIAN_HANDICAP|FT_REGULAR|-0.25|-", "football|MATCH_RESULT|FT_REGULAR|-|-", "football|TOTAL_GOALS|FT_REGULAR|2.5|-"]);
  });
  it("silently ignores exchange lay markets (not back-able)", () => {
    expect(r.unmapped).toEqual([]);
    expect(r.quotes.some((q) => q.providerMarketName === "h2h_lay")).toBe(false);
  });
  it("collapses regional copies of one bookmaker to a single name", async () => {
    const { bookmakerName } = await import("@/lib/providers/the-odds-api/parse");
    expect(bookmakerName("unibet_fr", "Unibet (FR)")).toBe("Unibet");
    expect(bookmakerName("unibet_se", "Unibet (SE)")).toBe("Unibet");
    expect(bookmakerName("winamax_de", "Winamax (DE)")).toBe("Winamax");
    expect(bookmakerName("leovegas_se", "LeoVegas (SE)")).toBe("LeoVegas");
    expect(bookmakerName("pmu_fr", "PMU (FR)")).toBe("PMU");
    expect(bookmakerName("mybookieag", "MyBookie.ag")).toBe("MyBookie.ag");
  });
  it("keeps the last-change timestamp as providerUpdatedAt", () => {
    expect(r.quotes.find((q) => q.bookmaker === "William Hill")!.providerUpdatedAt).toBe("2026-11-01T11:00:00.000Z");
  });
});

describe("manual Norsk Tipping entry", () => {
  const market = { sport: "football" as const, type: "MATCH_RESULT" as const, period: "FT_REGULAR" as const };
  it("validates prices", () => {
    expect(validateManualPrices(market, { home: 2.3, draw: 3.3, away: 3.0 })).toEqual([]);
    expect(validateManualPrices(market, { home: 1 })[0]).toMatch(/between 1.01/);
    expect(validateManualPrices(market, { yes: 2 })[0]).toMatch(/Unknown outcome/);
    expect(validateManualPrices(market, { home: 3, draw: 4, away: 5 })[0]).toMatch(/typo/);
    expect(validateManualPrices(market, {})[0]).toMatch(/at least one/);
  });
  it("produces a MANUAL quote", () => {
    const q = manualQuote({ providerEventId: "synth0001", market, prices: { home: 2.3 }, enteredAt: NOW });
    expect(q).toMatchObject({ origin: "MANUAL", bookmaker: "Norsk Tipping", provider: "manual" });
  });
});

describe("option A pipeline: manual target + The Odds API references", () => {
  const refs = parseOddsEvent(fixture[0], NOW.toISOString()).quotes;
  const nt = manualQuote({ providerEventId: "synth0001", market: { sport: "football", type: "MATCH_RESULT", period: "FT_REGULAR" }, prices: { home: 2.3, draw: 3.3, away: 3.0 }, enteredAt: NOW });

  it("with provider last-change ages, old-but-valid prices are rejected as stale", () => {
    const e = evaluateQuotes([nt, ...refs], "Norsk Tipping", NOW);
    expect(e.find((x) => x.outcome === "home")!.category).toBe("INSUFFICIENT_DATA");
  });
  it("with fetched-age basis, the fresh fetch confirms the prices", () => {
    const e = evaluateQuotes([nt, ...refs], "Norsk Tipping", NOW, { ageBasis: "fetched" });
    const home = e.find((x) => x.outcome === "home")!;
    expect(home.consensus.nBooks).toBe(4);
    expect(home.ev!).toBeCloseTo(2.3 * home.fairProbability! - 1, 12);
    expect(home.ev!).toBeGreaterThan(0.03);
    expect(home.category).toBe("WATCHLIST"); // reference settlement unverified
    expect(home.ageSource).toBe("fetched");
  });
  it("after the user verifies MATCH_RESULT settlement, real categories apply", () => {
    const e = evaluateQuotes([nt, ...refs], "Norsk Tipping", NOW, { ageBasis: "fetched", verifiedMarketTypes: ["MATCH_RESULT"] });
    expect(["EXCELLENT_VALUE", "POTENTIAL_VALUE"]).toContain(e.find((x) => x.outcome === "home")!.category);
  });
});

describe("TheOddsApiProvider (mocked HTTP)", () => {
  it("requires a key", () => {
    expect(() => new TheOddsApiProvider({ apiKey: "" })).toThrow(/THE_ODDS_API_KEY/);
  });
  it("requests decimal odds for eu/h2h,totals, tracks credits, hides key", async () => {
    const calls: URL[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      calls.push(new URL(String(u)));
      return new Response(JSON.stringify(fixture), { headers: { "x-requests-remaining": "498", "x-requests-used": "2", "x-requests-last": "2" } });
    }) as unknown as typeof fetch;
    const p = new TheOddsApiProvider({ apiKey: "SECRET", fetchImpl, now: () => NOW });
    expect(p.creditsPerOddsCall).toBe(2);
    const res = await p.getLeagueOdds("soccer_norway_eliteserien");
    expect(calls[0]!.pathname).toBe("/v4/sports/soccer_norway_eliteserien/odds");
    expect(calls[0]!.searchParams.get("oddsFormat")).toBe("decimal");
    expect(calls[0]!.searchParams.get("regions")).toBe("eu");
    expect(calls[0]!.searchParams.get("markets")).toBe("h2h,totals");
    expect(p.usage).toEqual({ remaining: 498, used: 2, last: 2 });
    expect(res[0]!.quotes.length).toBeGreaterThan(0);
  });
  it("does not retry or leak the key on 401 (quota exhausted)", async () => {
    const fetchImpl = vi.fn(async () => new Response("Usage quota has been reached SECRET", { status: 401 })) as unknown as typeof fetch;
    const p = new TheOddsApiProvider({ apiKey: "SECRET", fetchImpl });
    const err = (await p.getLeagueOdds("soccer_epl").catch((e) => e)) as Error;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(err.message).toContain("HTTP 401");
    expect(err.message).not.toContain("SECRET");
  });
  it("filters football leagues and skips outrights", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([
        { key: "soccer_epl", group: "Soccer", title: "EPL", active: true, has_outrights: false },
        { key: "soccer_epl_winner", group: "Soccer", title: "EPL Winner", active: true, has_outrights: true },
        { key: "basketball_nba", group: "Basketball", title: "NBA", active: true, has_outrights: false },
      ])),
    ) as unknown as typeof fetch;
    const p = new TheOddsApiProvider({ apiKey: "K", fetchImpl });
    expect((await p.getFootballLeagues()).map((s) => s.key)).toEqual(["soccer_epl"]);
  });
});

describe("recorded The Odds API responses (fixtures/recorded/the-odds-api-*.json, gitignored)", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../fixtures/recorded/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.startsWith("the-odds-api-") && f.endsWith(".json"));
  it.skipIf(files.length === 0)("every recorded response parses with ≥3 distinct reference books per 1X2 market", () => {
    for (const f of files) {
      for (const ev of JSON.parse(readFileSync(new URL(f, dir), "utf8"))) {
        const res = parseOddsEvent(ev, NOW.toISOString());
        const mr = new Set(res.quotes.filter((q) => q.market.type === "MATCH_RESULT").map((q) => q.bookmaker));
        expect(mr.size).toBeGreaterThanOrEqual(3);
        expect(res.unmapped.filter((u) => u.reason !== "no mapping rule")).toEqual([]);
      }
    }
  });
});
