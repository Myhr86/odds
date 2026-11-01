"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { getReferenceSource } from "@/lib/services/references";
import { evaluateManual, type EvaluationResponse, type ManualMarketInput } from "@/lib/services/value-service";
import { addWatch, removeWatch, saveSetting, settleEvent } from "@/lib/services/repo";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/core/value-finder";
import type { MarketType } from "@/lib/markets/types";
import type { ProviderEvent } from "@/lib/providers/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const wrap = async <T,>(fn: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
};

export async function loadEvents(league: string): Promise<Result<ProviderEvent[]>> {
  return wrap(async () => (await getReferenceSource().events(league)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
}

export async function runEvaluation(league: string, providerEventId: string, inputs: ManualMarketInput[]): Promise<Result<EvaluationResponse>> {
  return wrap(async () => {
    const r = await evaluateManual(await getDb(), getReferenceSource(), league, providerEventId, inputs);
    revalidatePath("/");
    revalidatePath("/history");
    return r;
  });
}

export async function watch(eventId: number, marketKey: string | null, outcome: string | null): Promise<Result<true>> {
  return wrap(async () => {
    await addWatch(await getDb(), eventId, marketKey, outcome, null);
    revalidatePath("/watchlist");
    return true as const;
  });
}

export async function unwatch(formData: FormData) {
  await removeWatch(await getDb(), Number(formData.get("id")));
  revalidatePath("/watchlist");
}

export async function settle(formData: FormData) {
  const h = Number(formData.get("home"));
  const a = Number(formData.get("away"));
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) throw new Error("Scores must be whole numbers ≥ 0");
  await settleEvent(await getDb(), Number(formData.get("eventId")), h, a);
  revalidatePath("/history");
  revalidatePath("/");
}

export async function saveSettings(formData: FormData) {
  const db = await getDb();
  const t: Thresholds = { ...DEFAULT_THRESHOLDS };
  const num = (k: keyof Thresholds, scale = 1) => {
    const v = Number(formData.get(k));
    if (Number.isFinite(v)) (t[k] as number) = v / scale;
  };
  num("minReferenceBooks");
  num("maxDataAgeSeconds");
  num("minEv", 100);
  num("excellentEv", 100);
  num("watchlistEv", 100);
  num("suspectEv", 100);
  num("minConfidence");
  num("excellentConfidence");
  await saveSetting(db, "thresholds", t);
  const types = formData.getAll("verified").map(String) as MarketType[];
  await saveSetting(db, "verified_market_types", types);
  revalidatePath("/settings");
}
