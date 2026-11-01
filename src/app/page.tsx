import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getReferenceSource } from "@/lib/services/references";
import { lastSyncs, listRecommendations, listWatch } from "@/lib/services/repo";
import { segment } from "@/lib/services/performance";
import { Card, CategoryBadge, Confidence, DemoBanner, Empty, Ev, btnPrimary } from "@/components/ui";
import { fmtOslo, marketLabel, odds, outcomeLabel, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = await getDb();
  const source = getReferenceSource();
  const isDemo = source.kind === "demo";
  const [recs, watchlist, syncs] = await Promise.all([listRecommendations(db, { includeDemo: isDemo, limit: 500 }), listWatch(db), lastSyncs(db, 20)]);
  const dayAgo = Date.now() - 86_400_000;
  const recent = recs.filter((r) => Date.parse(r.created_at) > dayAgo && ["EXCELLENT_VALUE", "POTENTIAL_VALUE", "WATCHLIST"].includes(r.category)).slice(0, 8);
  const upcomingWatch = watchlist.filter((w) => Date.parse(w.starts_at) > Date.now()).slice(0, 8);
  const lastOk = syncs.find((s) => s.ok);
  const lastErr = syncs.find((s) => !s.ok);
  const credits = source.creditsRemaining() ?? (lastOk?.rate_limit?.creditsRemaining as number | undefined) ?? null;
  const perf = segment("All", recs.filter((r) => !r.is_demo || isDemo));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">Where, if anywhere, is Norsk Tipping offering better odds than the market suggests?</p>
        </div>
        <Link href="/value-finder" className={btnPrimary}>Check a match →</Link>
      </div>
      {isDemo && <DemoBanner />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Reference data">
          <div className="text-lg font-semibold">{isDemo ? "Demo (synthetic)" : "The Odds API"}</div>
          <div className="mt-1 text-xs text-muted">Norsk Tipping prices: manual entry</div>
        </Card>
        <Card title="Credits left">
          <div className="num text-lg font-semibold">{isDemo ? "–" : credits ?? "unknown"}</div>
          <div className="mt-1 text-xs text-muted">{isDemo ? "No API key configured" : `Free plan: 500/month · ${source.creditsPerCall} per league fetch`}</div>
        </Card>
        <Card title="Last successful sync">
          <div className="text-lg font-semibold">{lastOk ? fmtOslo(lastOk.finished_at) : "never"}</div>
          {lastErr && (!lastOk || Date.parse(lastErr.finished_at) > Date.parse(lastOk.finished_at)) && <div className="mt-1 text-xs text-red-300">Last error: {lastErr.error?.slice(0, 120)}</div>}
        </Card>
        <Card title="Track record">
          <div className="num text-lg font-semibold">{perf.settled ? pct(perf.roi) : "–"}</div>
          <div className="mt-1 text-xs text-muted">{perf.n} recorded · {perf.settled} settled{perf.settled > 1 && ` · 95% CI ${pct(perf.roiLower, 0)} to ${pct(perf.roiUpper, 0)}`}</div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Best potential value, last 24 h" right={<Link className="text-xs text-muted hover:text-white" href="/history">All →</Link>}>
          {recent.length === 0 ? (
            <Empty>Nothing above the WATCHLIST level in the last 24 hours. That is a normal and honest result: most Norsk Tipping prices are not value.</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pr-3">
                      <div>{r.home_name} – {r.away_name}</div>
                      <div className="text-xs text-muted">{fmtOslo(r.starts_at)} · {marketLabel(r.market_key)} · {outcomeLabel(r.outcome)} @ {odds(r.target_odds)}</div>
                    </td>
                    <td className="pr-3"><Ev value={r.expected_value} /></td>
                    <td className="pr-3"><Confidence score={r.confidence} /></td>
                    <td><CategoryBadge category={r.category} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Watchlist, upcoming" right={<Link className="text-xs text-muted hover:text-white" href="/watchlist">All →</Link>}>
          {upcomingWatch.length === 0 ? (
            <Empty>No upcoming matches on your watchlist.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcomingWatch.map((w) => (
                <li key={w.id}>
                  <div>{w.home_name} – {w.away_name}</div>
                  <div className="text-xs text-muted">{fmtOslo(w.starts_at)}{w.market_key && ` · ${marketLabel(w.market_key)} · ${outcomeLabel(w.outcome ?? "")}`}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
