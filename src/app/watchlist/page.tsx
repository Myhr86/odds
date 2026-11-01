import { getDb } from "@/lib/db/client";
import { listWatch } from "@/lib/services/repo";
import { Card, Empty, btn } from "@/components/ui";
import { fmtOslo, marketLabel, outcomeLabel } from "@/lib/format";
import { unwatch } from "../actions";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const rows = await listWatch(await getDb());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <p className="text-sm text-muted">Selections you are following. Prices go stale quickly: re-check in the Value Finder with the current Norsk Tipping odds before acting.</p>
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>Your watchlist is empty. Use “Watch” on a Value Finder result.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="py-2 pr-3">Kick-off</th><th className="pr-3">Match</th><th className="pr-3">Selection</th><th /></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className={`border-b border-line/60 ${Date.parse(w.starts_at) < Date.now() ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-3">{fmtOslo(w.starts_at)}</td>
                  <td className="pr-3">{w.home_name} – {w.away_name}<div className="text-xs text-muted">{w.league}</div></td>
                  <td className="pr-3">{w.market_key ? `${marketLabel(w.market_key)} · ${outcomeLabel(w.outcome ?? "")}` : "Whole match"}</td>
                  <td className="text-right"><form action={unwatch}><input type="hidden" name="id" value={w.id} /><button className={btn}>Remove</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
