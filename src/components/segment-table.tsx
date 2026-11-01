import type { Segment } from "@/lib/services/performance";
import { pct } from "@/lib/format";

export function SegmentTable({ rows }: { rows: Segment[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Segment</th><th className="pr-3">n</th><th className="pr-3">Settled</th><th className="pr-3">Avg EV</th><th className="pr-3">Avg odds</th>
            <th className="pr-3">Hit rate (95% CI)</th><th className="pr-3">P/L (units)</th><th className="pr-3">ROI (95% CI)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.label} className="border-b border-line/60">
              <td className="py-1.5 pr-3">{s.label.replace("_", " ")}</td>
              <td className="num pr-3">{s.n}</td>
              <td className="num pr-3">{s.settled}</td>
              <td className="num pr-3">{pct(s.avgEv)}</td>
              <td className="num pr-3">{Number.isNaN(s.avgOdds) ? "–" : s.avgOdds.toFixed(2)}</td>
              <td className="num pr-3">{s.settled ? `${(s.hit.p * 100).toFixed(0)}% (${(s.hit.lower * 100).toFixed(0)}–${(s.hit.upper * 100).toFixed(0)}%)` : "–"}</td>
              <td className={`num pr-3 ${s.profit > 0 ? "text-pos" : s.profit < 0 ? "text-neg" : ""}`}>{s.settled ? s.profit.toFixed(2) : "–"}</td>
              <td className="num pr-3">{s.settled > 1 ? `${pct(s.roi)} (${pct(s.roiLower, 0)} to ${pct(s.roiUpper, 0)})` : s.settled ? pct(s.roi) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
