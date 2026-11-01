import { getReferenceSource } from "@/lib/services/references";
import { DemoBanner } from "@/components/ui";
import { ValueFinderClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ValueFinderPage() {
  const source = getReferenceSource();
  let leagues: { key: string; title: string }[] = [];
  let error: string | null = null;
  try {
    leagues = await source.leagues();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Value Finder</h1>
        <p className="text-sm text-muted">
          Pick a match, type in the Norsk Tipping odds you see on Oddsen, and compare them with a margin-free consensus of {source.kind === "demo" ? "synthetic demo" : "international"} bookmakers.
          {source.kind === "live" && ` Each fresh league fetch costs ${source.creditsPerCall} credits from The Odds API (cached 90 s).`}
        </p>
      </div>
      {source.kind === "demo" && <DemoBanner />}
      {error ? <div className="rounded-lg border border-neg/40 bg-neg/10 p-4 text-sm text-red-300">Could not load leagues from the reference provider: {error}</div> : <ValueFinderClient leagues={leagues} />}
    </div>
  );
}
