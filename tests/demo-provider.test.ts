import { describe, expect, it } from "vitest";
import { DemoOddsProvider } from "@/lib/providers/demo/demo-provider";
import { evaluateQuotes } from "@/lib/core/pipeline";

describe("DemoOddsProvider", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("labels everything as DEMO and is deterministic", async () => {
    const a = new DemoOddsProvider(7, () => now);
    const b = new DemoOddsProvider(7, () => now);
    const books = [a.targetBookmaker, ...a.referenceBookmakers];
    const ra = await a.getOdds(["demo-1"], books);
    const rb = await b.getOdds(["demo-1"], books);
    expect(ra).toEqual(rb);
    expect(ra[0]!.quotes.every((q) => q.origin === "DEMO")).toBe(true);
    expect((await a.getEvents()).every((e) => e.origin === "DEMO" && e.home.startsWith("Demo"))).toBe(true);
  });
  it("runs through the pipeline and propagates origin", async () => {
    const p = new DemoOddsProvider(1, () => now);
    const events = await p.getEvents();
    const res = await p.getOdds(events.map((e) => e.providerEventId), [p.targetBookmaker, ...p.referenceBookmakers]);
    const evals = evaluateQuotes(res.flatMap((r) => r.quotes), p.targetBookmaker, now);
    expect(evals.length).toBe(12);
    expect(evals.every((e) => e.origin === "DEMO")).toBe(true);
  });
});
