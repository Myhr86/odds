import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openDb, type Db } from "@/lib/db/client";
import { evaluateManual } from "@/lib/services/value-service";
import { addWatch, getSettings, listRecommendations, listWatch, saveSetting, settleEvent } from "@/lib/services/repo";
import { parseEvent, parseOddsEvent } from "@/lib/providers/the-odds-api/parse";
import type { ReferenceSource } from "@/lib/services/references";

// Live-shaped source backed by the SYNTHETIC The Odds API fixture (no network).
const fixture = JSON.parse(readFileSync(new URL("../fixtures/synthetic/the-odds-api-odds.synthetic.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-01T12:00:00Z");
const source: ReferenceSource = {
  kind: "live",
  provider: "the-odds-api",
  creditsPerCall: 2,
  creditsRemaining: () => 498,
  leagues: async () => [{ key: "soccer_norway_eliteserien", title: "Eliteserien" }],
  events: async () => [parseEvent(fixture[0])],
  odds: async (_l, id) => {
    const r = parseOddsEvent(fixture[0], NOW.toISOString());
    return { quotes: r.event!.providerEventId === id ? r.quotes : [], unmapped: r.unmapped, fetchedAt: NOW.toISOString(), cached: false, creditsUsed: 2, creditsRemaining: 498 };
  },
};
const MR = { sport: "football" as const, type: "MATCH_RESULT" as const, period: "FT_REGULAR" as const };
const OU = { sport: "football" as const, type: "TOTAL_GOALS" as const, period: "FT_REGULAR" as const, line: 2.5 };
const DC = { sport: "football" as const, type: "DOUBLE_CHANCE" as const, period: "FT_REGULAR" as const };

let db: Db;
beforeAll(async () => {
  db = await openDb({ pgliteDir: "memory://", databaseUrl: "" });
}, 30_000);

describe("value service (option A) end-to-end on PGlite", () => {
  it("evaluates manual Norsk Tipping prices against references and records them", async () => {
    const r = await evaluateManual(db, source, "soccer_norway_eliteserien", "synth0001", [
      { market: MR, prices: { home: 2.3, draw: 3.3, away: 3.0 } },
      { market: OU, prices: { over: 1.95 } },
      { market: DC, prices: { home_draw: 1.45 } },
    ], NOW);
    expect(r.referenceBooks).toEqual(["Betfair Exchange", "Pinnacle", "Unibet", "William Hill"]);
    expect(r.evaluations.map((e) => `${e.marketKey}:${e.outcome}`).sort()).toEqual([
      "football|DOUBLE_CHANCE|FT_REGULAR|-|-:home_draw",
      "football|MATCH_RESULT|FT_REGULAR|-|-:away",
      "football|MATCH_RESULT|FT_REGULAR|-|-:draw",
      "football|MATCH_RESULT|FT_REGULAR|-|-:home",
      "football|TOTAL_GOALS|FT_REGULAR|2.5|-:over",
    ]);
    const home = r.evaluations.find((e) => e.outcome === "home")!;
    expect(home.category).toBe("WATCHLIST"); // reference settlement not yet verified by the user
    expect(r.recorded).toBe(5);
    expect(r.creditsUsed).toBe(2);
  });

  it("regression: reference fetch finishing after the request started is not 'stale'", async () => {
    const late: ReferenceSource = { ...source, odds: async (l, id) => ({ ...(await source.odds(l, id)), fetchedAt: new Date(NOW.getTime() + 3000).toISOString() }) };
    const r = await evaluateManual(db, late, "soccer_norway_eliteserien", "synth0001", [{ market: MR, prices: { home: 2.31 } }], NOW);
    expect(r.evaluations[0]!.consensus.nBooks).toBe(4);
  });

  it("re-evaluating the same prices does not duplicate recommendations", async () => {
    const r = await evaluateManual(db, source, "soccer_norway_eliteserien", "synth0001", [{ market: MR, prices: { home: 2.3, draw: 3.3, away: 3.0 } }], NOW);
    expect(r.recorded).toBe(0);
  });

  it("honours user-verified market types from settings", async () => {
    await saveSetting(db, "verified_market_types", ["MATCH_RESULT"]);
    expect((await getSettings(db)).verifiedMarketTypes).toEqual(["MATCH_RESULT"]);
    const r = await evaluateManual(db, source, "soccer_norway_eliteserien", "synth0001", [{ market: MR, prices: { home: 2.32, draw: 3.3, away: 3.0 } }], NOW);
    expect(["EXCELLENT_VALUE", "POTENTIAL_VALUE"]).toContain(r.evaluations.find((e) => e.outcome === "home")!.category);
  });

  it("rejects typos before storing anything", async () => {
    await expect(evaluateManual(db, source, "soccer_norway_eliteserien", "synth0001", [{ market: MR, prices: { home: 23, draw: 33, away: 30 } }], NOW)).rejects.toThrow(/typo/);
  });

  it("stores odds history only on change", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from odds_changes oc join bookmakers b on b.id = oc.bookmaker_id where b.name = 'Norsk Tipping' and outcome = 'home'`);
    expect(r.rows[0]!.n).toBe(4); // 2.30 → 2.31 → 2.30 → 2.32 (repeat of 2.30 at the same price was not stored)
  });

  it("watchlist and settlement", async () => {
    const recs = await listRecommendations(db);
    const eventId = recs[0]!.event_id;
    await addWatch(db, eventId, "football|MATCH_RESULT|FT_REGULAR|-|-", "home", null);
    expect((await listWatch(db)).length).toBe(1);
    const n = await settleEvent(db, eventId, 2, 1);
    expect(n).toBe(recs.length);
    const after = await listRecommendations(db);
    const home = after.find((x) => x.outcome === "home" && x.target_odds === 2.3)!;
    expect(home.result_outcome).toBe("win");
    expect(home.unit_profit).toBeCloseTo(1.3, 6);
    expect(after.find((x) => x.outcome === "over")!.result_outcome).toBe("win");
    expect(after.find((x) => x.outcome === "draw")!.unit_profit).toBe(-1);
  });
});
