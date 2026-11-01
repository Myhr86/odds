import { getDb } from "@/lib/db/client";
import { getSettings } from "@/lib/services/repo";
import { getReferenceSource } from "@/lib/services/references";
import { Card, btnPrimary, input } from "@/components/ui";
import { saveSettings } from "../actions";

export const dynamic = "force-dynamic";

const MARKETS = [
  ["MATCH_RESULT", "1X2 / HUB (also used for Double chance)", "Does the reference provider's soccer “h2h” settle on the 90-minute result (plus stoppage time, no extra time), like Norsk Tipping's HUB?"],
  ["TOTAL_GOALS", "Total goals Over/Under", "Do both settle on goals in 90 minutes plus stoppage time? Are whole and quarter lines handled as Asian lines (push or half stakes) at both?"],
] as const;

export default async function SettingsPage() {
  const db = await getDb();
  const s = await getSettings(db);
  const t = s.thresholds;
  const source = getReferenceSource();
  const field = (name: string, label: string, value: number, hint: string) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} defaultValue={value} className={`${input} num`} inputMode="decimal" />
      <span className="text-[11px] text-muted">{hint}</span>
    </label>
  );
  return (
    <form action={saveSettings} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">These thresholds are configurable starting values, not proven optima. Historical Performance shows how each EV and confidence range actually does.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Recommendation thresholds">
          <div className="grid grid-cols-2 gap-3">
            {field("minReferenceBooks", "Min. reference bookmakers", t.minReferenceBooks, "Fewer means INSUFFICIENT DATA")}
            {field("maxDataAgeSeconds", "Max. data age (seconds)", t.maxDataAgeSeconds, "Older prices are rejected")}
            {field("minEv", "POTENTIAL VALUE: min. EV (%)", +(t.minEv * 100).toFixed(2), "")}
            {field("minConfidence", "POTENTIAL VALUE: min. confidence", t.minConfidence, "0–100")}
            {field("excellentEv", "EXCELLENT VALUE: min. EV (%)", +(t.excellentEv * 100).toFixed(2), "")}
            {field("excellentConfidence", "EXCELLENT VALUE: min. confidence", t.excellentConfidence, "0–100")}
            {field("watchlistEv", "WATCHLIST: min. EV (%)", +(t.watchlistEv * 100).toFixed(2), "")}
            {field("suspectEv", "Plausibility limit (%)", +(t.suspectEv * 100).toFixed(2), "Higher EV is treated as a data error")}
          </div>
        </Card>
        <Card title="Market settlement verification">
          <p className="mb-3 text-xs leading-relaxed text-muted">
            Prices can only be compared if both sides settle the same way. Tick a market only after checking Norsk Tipping's rules (norsk-tipping.no, Oddsen rules) and the reference provider's market documentation.
            Unticked markets are capped at WATCHLIST.
          </p>
          <div className="space-y-3">
            {MARKETS.map(([k, label, q]) => (
              <label key={k} className="flex gap-3 text-sm">
                <input type="checkbox" name="verified" value={k} defaultChecked={s.verifiedMarketTypes.includes(k)} className="mt-1" />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{q}</span></span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Data sources">
          <ul className="space-y-1 text-sm">
            <li>Reference odds: <strong>{source.kind === "live" ? "The Odds API (key configured)" : "DEMO: THE_ODDS_API_KEY not set"}</strong></li>
            <li>Norsk Tipping odds: <strong>manual entry</strong> (no official API exists, and the site is not scraped)</li>
            <li>Database: <strong>{process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "Local PGlite (./data/pglite)"}</strong></li>
          </ul>
          <p className="mt-2 text-xs text-muted">API keys are read on the server only and are never sent to the browser.</p>
        </Card>
      </div>
      <button className={btnPrimary}>Save settings</button>
    </form>
  );
}
