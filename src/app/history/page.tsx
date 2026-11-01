import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listRecommendations } from "@/lib/services/repo";
import { bySegments } from "@/lib/services/performance";
import { Card, CategoryBadge, Confidence, Empty, Ev, btn, input } from "@/components/ui";
import { SegmentTable } from "@/components/segment-table";
import { fmtOslo, marketLabel, odds, outcomeLabel } from "@/lib/format";
import { settle } from "../actions";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const includeDemo = (await searchParams).demo === "1";
  const rows = await listRecommendations(await getDb(), { includeDemo, limit: 2000 });
  const seg = bySegments(rows);
  const now = Date.now();
  const toSettle = [...new Map(rows.filter((r) => r.home_score_ft === null && Date.parse(r.starts_at) < now).map((r) => [r.event_id, r])).values()];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Historical Performance</h1>
          <p className="text-sm text-muted">Every evaluation is recorded, whether you bet on it or not, and losses are never hidden. Profit and loss assume a flat stake of 1 unit on each recorded selection.</p>
        </div>
        <Link className={btn} href={includeDemo ? "/history" : "/history?demo=1"}>{includeDemo ? "Hide demo data" : "Include demo data"}</Link>
      </div>

      <Card title="Summary">
        <SegmentTable rows={[seg.all]} />
        <p className="mt-2 text-xs text-muted">
          With small samples the intervals are wide. That reflects how much is really known, not a display bug. A few hundred settled selections are needed before ROI says much.
          Closing line value (CLV) needs closing odds. That isn't collected automatically in manual mode yet.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="By category"><SegmentTable rows={seg.category} /></Card>
        <Card title="By EV range"><SegmentTable rows={seg.ev} /></Card>
        <Card title="By confidence"><SegmentTable rows={seg.confidence} /></Card>
        <Card title={`Matches waiting for a result (${toSettle.length})`}>
          {toSettle.length === 0 ? (
            <Empty>No finished matches waiting for a score.</Empty>
          ) : (
            <ul className="space-y-2">
              {toSettle.map((r) => (
                <li key={r.event_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{fmtOslo(r.starts_at)} · {r.home_name} – {r.away_name}</span>
                  <form action={settle} className="flex items-center gap-1">
                    <input type="hidden" name="eventId" value={r.event_id} />
                    <input name="home" className={`${input} num w-14`} inputMode="numeric" placeholder="H" required />
                    <span>–</span>
                    <input name="away" className={`${input} num w-14`} inputMode="numeric" placeholder="B" required />
                    <button className={btn}>Save 90-min score</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`All recorded evaluations (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>Nothing recorded yet. Evaluate a match in the Value Finder.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">Recorded</th><th className="pr-3">Match</th><th className="pr-3">Selection</th><th className="pr-3">Odds</th><th className="pr-3">EV</th><th className="pr-3">Conf.</th><th className="pr-3">Category</th><th className="pr-3">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 text-xs text-muted">{fmtOslo(r.created_at)}{r.is_demo && " · DEMO"}</td>
                    <td className="pr-3">{r.home_name} – {r.away_name}</td>
                    <td className="pr-3">{marketLabel(r.market_key)} · {outcomeLabel(r.outcome)}</td>
                    <td className="num pr-3">{odds(r.target_odds)}</td>
                    <td className="pr-3"><Ev value={r.expected_value} /></td>
                    <td className="pr-3"><Confidence score={r.confidence} /></td>
                    <td className="pr-3"><CategoryBadge category={r.category} /></td>
                    <td className="num pr-3">{r.result_outcome ? `${r.result_outcome} (${r.unit_profit! > 0 ? "+" : ""}${r.unit_profit!.toFixed(2)})` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
