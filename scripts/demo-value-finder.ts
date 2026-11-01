/**
 * Runs the full value-finder pipeline on the DEMO provider (synthetic data) so the math and
 * ranking can be inspected without an API key. Output is explicitly labelled DEMO.
 */
import { DemoOddsProvider } from "../src/lib/providers/demo/demo-provider";
import { evaluateQuotes } from "../src/lib/core/pipeline";

const p = new DemoOddsProvider(Number(process.env.SEED ?? 42));
const now = new Date();
const events = await p.getEvents();
const res = await p.getOdds(events.map((e) => e.providerEventId), [p.targetBookmaker, ...p.referenceBookmakers]);
const evals = evaluateQuotes(res.flatMap((r) => r.quotes), p.targetBookmaker, now, {
  sharpBookmakers: ["Demo Sharp", "Demo Exchange"],
  consensus: { reliabilityWeights: { "Demo Sharp": 3, "Demo Exchange": 2.5 } },
});
console.log("⚠  DEMO DATA – synthetic prices, fictional teams. Not real odds.\n");
for (const e of evals) {
  const ev = events.find((x) => x.providerEventId === e.providerEventId)!;
  console.log(`[${e.category.padEnd(17)}] ${ev.home} – ${ev.away} | ${e.marketKey} ${e.outcome} @ ${e.targetOdds} | EV ${e.ev === null ? "n/a" : (e.ev * 100).toFixed(1) + "%"} | conf ${e.confidence?.score ?? "-"}`);
  e.reasons.forEach((r) => console.log(`      · ${r}`));
}
