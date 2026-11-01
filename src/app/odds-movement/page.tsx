import { getDb } from "@/lib/db/client";
import { Card, Empty } from "@/components/ui";
import { fmtOslo, marketLabel, outcomeLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OddsMovementPage() {
  const db = await getDb();
  const rows = (
    await db.query<{ observed_at: string; home_name: string; away_name: string; bookmaker: string; is_target: boolean; market_key: string; outcome: string; previous_odds: number | null; new_odds: number }>(
      `select oc.observed_at, e.home_name, e.away_name, b.name as bookmaker, b.is_target, oc.market_key, oc.outcome,
              oc.previous_odds::float8 as previous_odds, oc.new_odds::float8 as new_odds
         from odds_changes oc join events e on e.id = oc.event_id join bookmakers b on b.id = oc.bookmaker_id
        where oc.previous_odds is not null
        order by oc.observed_at desc limit 200`,
    )
  ).rows;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Odds Movement</h1>
        <p className="text-sm text-muted">
          Price changes recorded each time a match is evaluated. In manual mode, odds are only captured when you check a match, so this is a log, not a continuous feed.
          Charts and the Market Lag Detector need continuous polling (Phase 3), which needs a paid data plan.
        </p>
      </div>
      <Card title="Latest recorded changes">
        {rows.length === 0 ? (
          <Empty>No changes yet. Re-evaluate a match later and any moves will show up here.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-2 pr-3">Seen</th><th className="pr-3">Match</th><th className="pr-3">Bookmaker</th><th className="pr-3">Selection</th><th className="pr-3">Move</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const pctMove = r.previous_odds ? r.new_odds / r.previous_odds - 1 : 0;
                return (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 text-xs text-muted">{fmtOslo(r.observed_at)}</td>
                    <td className="pr-3">{r.home_name} – {r.away_name}</td>
                    <td className="pr-3">{r.bookmaker}{r.is_target && " ★"}</td>
                    <td className="pr-3">{marketLabel(r.market_key)} · {outcomeLabel(r.outcome)}</td>
                    <td className={`num pr-3 ${pctMove < 0 ? "text-neg" : "text-pos"}`}>{r.previous_odds?.toFixed(2)} → {r.new_odds.toFixed(2)} ({pctMove > 0 ? "+" : ""}{(pctMove * 100).toFixed(1)}%)</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
