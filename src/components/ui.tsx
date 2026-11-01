import type { ReactNode } from "react";

export function Card({ title, children, right, className = "" }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium tracking-wide text-zinc-300">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const CAT_STYLE: Record<string, string> = {
  EXCELLENT_VALUE: "bg-pos/15 text-pos border-pos/40",
  POTENTIAL_VALUE: "bg-pos/10 text-emerald-300 border-emerald-400/30",
  WATCHLIST: "bg-warn/10 text-warn border-warn/40",
  INSUFFICIENT_DATA: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  NO_VALUE: "bg-neg/10 text-red-300 border-neg/30",
};
export function CategoryBadge({ category }: { category: string }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ${CAT_STYLE[category] ?? ""}`}>{category.replace("_", " ")}</span>;
}

export function Ev({ value }: { value: number | null }) {
  if (value === null) return <span className="num text-muted">–</span>;
  const c = value >= 0.03 ? "text-pos" : value > 0 ? "text-emerald-300" : "text-neg";
  return <span className={`num ${c}`}>{`${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`}</span>;
}

export function Confidence({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="num text-muted">–</span>;
  const c = score >= 80 ? "bg-pos" : score >= 65 ? "bg-emerald-400" : score >= 45 ? "bg-warn" : "bg-neg";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded bg-zinc-800"><span className={`block h-full ${c}`} style={{ width: `${score}%` }} /></span>
      <span className="num text-xs">{score}</span>
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="rounded-lg border border-warn/50 bg-warn/10 px-4 py-2 text-sm text-warn">
      <strong>DEMO DATA.</strong> THE_ODDS_API_KEY is not configured, so reference odds are synthetic and teams are fictional. Nothing shown says anything about real markets.
      <span className="mt-1 block text-xs text-warn/80">
        To use real data, add <code>THE_ODDS_API_KEY=your_key</code> to a file named <code>.env.local</code> in the project folder (next to package.json), then restart <code>npm run dev</code>. On Vercel, add it under Project → Settings → Environment Variables and redeploy.
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export const btn = "inline-flex items-center justify-center rounded-md border border-line bg-panel-2 px-3 py-1.5 text-sm hover:border-zinc-500 disabled:opacity-50";
export const btnPrimary = "inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";
export const input = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500";
