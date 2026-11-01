"use client";
import { useState, useTransition } from "react";
import { loadEvents, runEvaluation, watch } from "../actions";
import type { EvaluationResponse, ManualMarketInput } from "@/lib/services/value-service";
import type { ProviderEvent } from "@/lib/providers/types";
import { Card, CategoryBadge, Confidence, Empty, Ev, btn, btnPrimary, input } from "@/components/ui";
import { fmtOslo, fmtOsloTime, marketLabel, odds, outcomeLabel } from "@/lib/format";

const LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 2, 2.25, 2.75, 3, 3.25];

function parseOdds(s: string): number | undefined {
  const v = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? undefined : v;
}

export function ValueFinderClient({ leagues }: { leagues: { key: string; title: string }[] }) {
  const [league, setLeague] = useState("");
  const [events, setEvents] = useState<ProviderEvent[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [f, setF] = useState<Record<string, string>>({ line: "2.5" });
  const [result, setResult] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [watched, setWatched] = useState<Set<string>>(new Set());

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  function pickLeague(key: string) {
    setLeague(key);
    setEvents(null);
    setEventId("");
    setResult(null);
    setError(null);
    if (!key) return;
    start(async () => {
      const r = await loadEvents(key);
      if (r.ok) setEvents(r.data);
      else setError(r.error);
    });
  }

  function buildInputs(): ManualMarketInput[] {
    const out: ManualMarketInput[] = [];
    const add = (market: ManualMarketInput["market"], m: Record<string, string>) => {
      const prices: Record<string, number> = {};
      for (const [outcome, field] of Object.entries(m)) {
        const v = parseOdds(f[field] ?? "");
        if (v !== undefined) prices[outcome] = v;
      }
      if (Object.keys(prices).length) out.push({ market, prices });
    };
    add({ sport: "football", type: "MATCH_RESULT", period: "FT_REGULAR" }, { home: "h", draw: "u", away: "b" });
    add({ sport: "football", type: "TOTAL_GOALS", period: "FT_REGULAR", line: Number(f.line) }, { over: "over", under: "under" });
    add({ sport: "football", type: "DOUBLE_CHANCE", period: "FT_REGULAR" }, { home_draw: "dc1x", home_away: "dc12", draw_away: "dcx2" });
    return out;
  }

  function evaluate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const inputs = buildInputs();
    if (!inputs.length) return setError("Type at least one Norsk Tipping price.");
    start(async () => {
      const r = await runEvaluation(league, eventId, inputs);
      if (r.ok) setResult(r.data);
      else setError(r.error);
    });
  }

  const ev = events?.find((x) => x.providerEventId === eventId);

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card title="1 · Match and Norsk Tipping prices">
        <form onSubmit={evaluate} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs text-muted">League</span>
            <select className={input} value={league} onChange={(e) => pickLeague(e.target.value)}>
              <option value="">Choose league…</option>
              {leagues.map((l) => (
                <option key={l.key} value={l.key}>{l.title}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Match (Norwegian time)</span>
            <select className={input} value={eventId} onChange={(e) => { setEventId(e.target.value); setResult(null); }} disabled={!events}>
              <option value="">{events === null ? (league && pending ? "Loading…" : "Choose league first") : events.length ? "Choose match…" : "No upcoming matches"}</option>
              {events?.map((x) => (
                <option key={x.providerEventId} value={x.providerEventId}>{fmtOslo(x.startsAt)} · {x.home} – {x.away}</option>
              ))}
            </select>
          </label>

          {ev && (
            <>
              <fieldset className="space-y-1">
                <legend className="text-xs text-muted">1X2 / HUB (full time, 90 min)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["h", "u", "b"] as const).map((k) => (
                    <input key={k} className={`${input} num`} inputMode="decimal" placeholder={k.toUpperCase()} value={f[k] ?? ""} onChange={set(k)} />
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="text-xs text-muted">Total goals</legend>
                <div className="grid grid-cols-3 gap-2">
                  <select className={`${input} num`} value={f.line} onChange={set("line")}>
                    {LINES.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <input className={`${input} num`} inputMode="decimal" placeholder="Over" value={f.over ?? ""} onChange={set("over")} />
                  <input className={`${input} num`} inputMode="decimal" placeholder="Under" value={f.under ?? ""} onChange={set("under")} />
                </div>
              </fieldset>
              <fieldset className="space-y-1">
                <legend className="text-xs text-muted">Double chance (calculated from the 1X2 consensus)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {([["dc1x", "1X"], ["dc12", "12"], ["dcx2", "X2"]] as const).map(([k, p]) => (
                    <input key={k} className={`${input} num`} inputMode="decimal" placeholder={p} value={f[k] ?? ""} onChange={set(k)} />
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted">Fill in only what you want to check. Decimal odds, for example 2.15 or 2,15.</p>
              <button className={btnPrimary} disabled={pending}>{pending ? "Evaluating…" : "Evaluate"}</button>
            </>
          )}
          {error && <p className="rounded-md border border-neg/40 bg-neg/10 p-2 text-sm text-red-300">{error}</p>}
        </form>
      </Card>

      <div className="space-y-4">
        {!result ? (
          <Card title="2 · Result">
            <Empty>Choose a match and enter the Norsk Tipping prices to see EV, fair odds and confidence.</Empty>
          </Card>
        ) : (
          <>
            <Card
              title={`${result.event.home} – ${result.event.away}`}
              right={<span className="text-xs text-muted">{fmtOslo(result.event.startsAt)}</span>}
            >
              <div className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
                <div>Reference bookmakers ({result.referenceBooks.length}): <span className="text-zinc-300">{result.referenceBooks.join(", ") || "none"}</span></div>
                <div>Reference odds fetched {fmtOsloTime(result.fetchedAt)} {result.cached ? "(cache, 0 credits)" : `(${result.creditsUsed} credits)`}{result.creditsRemaining !== null && ` · ${result.creditsRemaining} credits left`}</div>
                <div>Reference markets: <span className="text-zinc-300">{result.referenceMarkets.map(marketLabel).join(", ") || "none"}</span></div>
                <div>Recorded in history: {result.recorded} new</div>
              </div>
            </Card>
            <Card title="2 · Evaluation (best first)">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3">Selection</th><th className="pr-3">NT odds</th><th className="pr-3">Fair odds</th><th className="pr-3">Probability</th><th className="pr-3">EV</th><th className="pr-3">Confidence</th><th className="pr-3">Category</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.evaluations.map((e) => {
                      const k = `${e.marketKey}|${e.outcome}`;
                      return (
                        <tr key={k} className="border-b border-line/60 align-top">
                          <td className="py-2 pr-3">
                            <div>{marketLabel(e.marketKey)} · <strong>{outcomeLabel(e.outcome)}</strong></div>
                            <details className="mt-1 text-xs text-muted">
                              <summary className="cursor-pointer select-none">Why?</summary>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4">{e.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                              {e.confidence && (
                                <div className="mt-1">Confidence ({e.confidence.scope}): {Object.entries(e.confidence.components).map(([n, c]) => `${n} ${(c.value * 100).toFixed(0)}%×${c.weight}`).join(" · ")}</div>
                              )}
                            </details>
                          </td>
                          <td className="num pr-3">{odds(e.targetOdds)}</td>
                          <td className="num pr-3">{odds(e.fairOdds)}</td>
                          <td className="num pr-3">{e.fairProbability === null ? "–" : `${(e.fairProbability * 100).toFixed(1)}%`}</td>
                          <td className="pr-3"><Ev value={e.ev} /></td>
                          <td className="pr-3"><Confidence score={e.confidence?.score} /></td>
                          <td className="pr-3"><CategoryBadge category={e.category} /></td>
                          <td>
                            <button
                              className={btn}
                              disabled={watched.has(k)}
                              onClick={async () => {
                                const r = await watch(result.event.eventId, e.marketKey, e.outcome);
                                if (r.ok) setWatched((s) => new Set(s).add(k));
                              }}
                            >
                              {watched.has(k) ? "Watching" : "Watch"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                EV = Norsk Tipping odds × estimated probability − 1. The probability is the weighted, margin-free consensus of the reference bookmakers, not a certainty.
                Confidence measures data quality (coverage, freshness, agreement), not the chance of winning.
                Until you confirm in Settings that a market type settles the same way at Norsk Tipping and at the reference provider, results are capped at WATCHLIST.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
