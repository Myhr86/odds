/**
 * PHASE 1 VERIFICATION PROBE – odds-api.io × Norsk Tipping
 *
 * Answers, with REAL responses, the questions that block Phase 2:
 *   Q1  Is Norsk Tipping in the provider's bookmaker list, and under what exact name?
 *   Q2  Are the reference books we want available (Pinnacle, Betfair Exchange, …)?
 *   Q3  Does /events return upcoming football events priced by Norsk Tipping?
 *   Q4  Which markets/lines does Norsk Tipping have, with what field names?
 *   Q5  Are timestamps present, and how old are Norsk Tipping prices vs reference prices?
 *   Q6  Which markets are unmapped by our adapter?
 *   Q7  What rate-limit headers does the API send?
 *
 * Usage:  ODDS_API_IO_KEY=... npm run probe:odds-api-io [-- --events 5 --league <slug>]
 * Output: console report + fixtures/recorded/*.json (gitignored: may contain licensed data).
 * Cost:   1 (bookmakers, no key) + 1 (sports, no key) + 1 (events) + ceil(N/10) (odds/multi) requests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { OddsApiIoProvider } from "../src/lib/providers/odds-api-io/client";
import { parseEvent, parseOddsEvent } from "../src/lib/providers/odds-api-io/parse";
import { marketKey } from "../src/lib/markets/types";
import { evaluateQuotes } from "../src/lib/core/pipeline";

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const nEvents = Number(arg("events", "5"));
const league = arg("league");

const key = process.env.ODDS_API_IO_KEY;
if (!key) {
  console.error("ODDS_API_IO_KEY is not set. Copy .env.example to .env and run with the key in the environment.");
  process.exit(2);
}
const wantedRefs = (process.env.ODDS_API_IO_REFERENCE_BOOKMAKERS ?? "Betfair Exchange,Sbobet,SingBet,Bet365,Unibet").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = new URL("../fixtures/recorded/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const save = (name: string, data: unknown) => writeFileSync(new URL(`${name}-${stamp}.json`, outDir), JSON.stringify(data, null, 2));
const p = new OddsApiIoProvider({ apiKey: key, markets: process.env.ODDS_API_IO_MARKETS?.split(",") });
const report: Record<string, unknown> = { ranAt: new Date().toISOString() };

async function main() {
  // Q1/Q2
  const books = await p.getBookmakers();
  save("bookmakers", books);
  const nt = books.filter((b) => /norsk|tipping|oddsen/i.test(b.name));
  console.log(`\nQ1 Bookmakers total: ${books.length}. Norsk Tipping candidates: ${JSON.stringify(nt)}`);
  report.q1 = { total: books.length, norskTippingCandidates: nt };
  if (!nt.length) {
    console.log("   ✗ Norsk Tipping NOT found. Stop: this provider cannot be the primary source.");
    return;
  }
  const target = process.env.ODDS_API_IO_TARGET_BOOKMAKER && nt.some((b) => b.name === process.env.ODDS_API_IO_TARGET_BOOKMAKER) ? process.env.ODDS_API_IO_TARGET_BOOKMAKER : nt[0]!.name;
  const refStatus = wantedRefs.map((r) => ({ wanted: r, found: books.find((b) => b.name.toLowerCase() === r.toLowerCase()) ?? null }));
  console.log(`Q2 Reference books:`, refStatus.map((r) => `${r.wanted}: ${r.found ? "✓" : "✗"}`).join(", "));
  report.q2 = refStatus;

  const sports = await p.get("/sports", {}, false);
  save("sports", sports);

  // Q3
  const rawEvents = await p.get("/events", { sport: "football", bookmaker: target, status: "pending", limit: 50, league });
  save("events", rawEvents);
  const list = (Array.isArray(rawEvents) ? rawEvents : ((rawEvents as { data?: unknown[] }).data ?? [])) as unknown[];
  const parsed = list.flatMap((e) => {
    try {
      return [parseEvent(e)];
    } catch (err) {
      console.log("   ! unparseable event:", (err as Error).message);
      return [];
    }
  });
  console.log(`Q3 Upcoming football events with ${target}: ${parsed.length} (raw ${list.length})`);
  parsed.slice(0, 10).forEach((e) => console.log(`   ${e.startsAt}  ${e.league.name}: ${e.home} – ${e.away}  [${e.providerEventId}]`));
  report.q3 = { count: parsed.length, sample: parsed.slice(0, 10) };
  if (!parsed.length) return;

  // Q4–Q6
  const ids = parsed.slice(0, nEvents).map((e) => e.providerEventId);
  const bookList = [target, ...refStatus.filter((r) => r.found).map((r) => r.found!.name)];
  const rawOdds = await p.get("/odds/multi", { eventIds: ids.join(","), bookmakers: bookList.join(","), markets: process.env.ODDS_API_IO_MARKETS });
  save("odds", rawOdds);
  const now = new Date();
  const results = (Array.isArray(rawOdds) ? rawOdds : [rawOdds]).map((ev) => parseOddsEvent(ev, now.toISOString()));
  const booksSeen = new Set<string>();
  const ntMarkets = new Map<string, number>();
  const ages: Record<string, number[]> = {};
  let missingTs = 0;
  for (const r of results) {
    for (const q of r.quotes) {
      booksSeen.add(q.bookmaker);
      if (q.bookmaker === target) ntMarkets.set(marketKey(q.market), (ntMarkets.get(marketKey(q.market)) ?? 0) + 1);
      if (q.providerUpdatedAt) (ages[q.bookmaker] ??= []).push((now.getTime() - Date.parse(q.providerUpdatedAt)) / 1000);
      else missingTs++;
    }
  }
  console.log(`Q4 Bookmakers present in odds response: ${[...booksSeen].join(", ") || "(none)"}`);
  console.log(`   ${target} canonical markets:`, Object.fromEntries(ntMarkets));
  console.log(`Q5 Median price age (s) per bookmaker:`, Object.fromEntries(Object.entries(ages).map(([b, a]) => [b, Math.round(median(a))])), `| quotes without timestamp: ${missingTs}`);
  const unmapped = results.flatMap((r) => r.unmapped);
  const unmappedNames = [...new Set(unmapped.map((u) => `${u.bookmaker}: ${u.providerMarketName} (${u.reason})`))];
  console.log(`Q6 Unmapped market types (${unmappedNames.length}):`);
  unmappedNames.slice(0, 40).forEach((u) => console.log("   " + u));
  console.log(`Q7 Rate-limit headers:`, p.lastRateLimit);

  const evals = evaluateQuotes(results.flatMap((r) => r.quotes), target, now);
  console.log(`\nValue-finder dry run (all mappings UNVERIFIED → max category WATCHLIST):`);
  evals.slice(0, 10).forEach((e) => console.log(`   [${e.category}] ev=${e.ev === null ? "n/a" : (e.ev * 100).toFixed(1) + "%"} conf=${e.confidence?.score ?? "-"} ${e.marketKey} ${e.outcome} @ ${e.targetOdds ?? "-"} (refs ${e.consensus.nBooks})`));

  Object.assign(report, {
    q4: { booksSeen: [...booksSeen], targetMarkets: Object.fromEntries(ntMarkets) },
    q5: { medianAgeSeconds: Object.fromEntries(Object.entries(ages).map(([b, a]) => [b, median(a)])), missingTimestamps: missingTs },
    q6: unmappedNames,
    q7: p.lastRateLimit,
    dryRunTop: evals.slice(0, 20),
  });
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : NaN;
}

main()
  .catch((e) => {
    console.error("Probe failed:", (e as Error).message);
    report.error = (e as Error).message;
    process.exitCode = 1;
  })
  .finally(() => {
    save("probe-report", report);
    console.log(`\nRaw responses and report written to fixtures/recorded/ (gitignored).`);
  });
