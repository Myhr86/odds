import type { Db } from "../db/client";
import { DEFAULT_THRESHOLDS, type SelectionEvaluation, type Thresholds } from "../core/value-finder";
import { marketKey, OUTCOMES, type MarketType } from "../markets/types";
import type { OddsQuote, ProviderEvent } from "../providers/types";
import { settleSelection } from "../core/settlement";
import { unitProfit, type BetOutcome } from "../core/stats";

/** All SQL lives here. Functions take a Db so they can be tested against PGlite. */

export const ALGORITHM_VERSION = "consensus-v1";
export const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001"; // single-user local mode (no auth yet)

// ------------------------------------------------------------------ settings
export interface AppSettings {
  thresholds: Thresholds;
  verifiedMarketTypes: MarketType[];
}

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = (await db.query<{ key: string; value: unknown }>(`select key, value from app_settings`)).rows;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...((map.thresholds as Partial<Thresholds>) ?? {}) },
    verifiedMarketTypes: (map.verified_market_types as MarketType[]) ?? [],
  };
}

export async function saveSetting(db: Db, key: "thresholds" | "verified_market_types", value: unknown) {
  await db.query(
    `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

// ------------------------------------------------------------------ events & bookmakers
export async function upsertEvent(db: Db, ev: ProviderEvent, providerId: string, providerEventId: string): Promise<number> {
  const existing = await db.query<{ event_id: number }>(`select event_id from event_provider_ids where provider_id = $1 and provider_event_id = $2`, [providerId, providerEventId]);
  if (existing.rows[0]) {
    await db.query(`update events set starts_at = $2, updated_at = now() where id = $1`, [existing.rows[0].event_id, ev.startsAt]);
    return Number(existing.rows[0].event_id);
  }
  const league = await db.query<{ id: number }>(
    `insert into leagues (sport_id, name, country) values ('football', $1, '') on conflict (sport_id, name, country) do update set name = excluded.name returning id`,
    [ev.league.name],
  );
  const inserted = await db.query<{ id: number }>(
    `insert into events (sport_id, league_id, home_name, away_name, starts_at, status, is_demo) values ('football', $1, $2, $3, $4, $5, $6) returning id`,
    [league.rows[0]!.id, ev.home, ev.away, ev.startsAt, ev.status, ev.origin === "DEMO"],
  );
  const id = Number(inserted.rows[0]!.id);
  await db.query(`insert into event_provider_ids (event_id, provider_id, provider_event_id) values ($1, $2, $3)`, [id, providerId, providerEventId]);
  return id;
}

const bookmakerIdCache = new WeakMap<Db, Map<string, number>>();
export async function bookmakerId(db: Db, name: string, isTarget = false): Promise<number> {
  let bookmakerIds = bookmakerIdCache.get(db);
  if (!bookmakerIds) bookmakerIdCache.set(db, (bookmakerIds = new Map()));
  const k = name.toLowerCase();
  const hit = bookmakerIds.get(k);
  if (hit) return hit;
  const r = await db.query<{ id: number }>(
    `insert into bookmakers (name, is_target) values ($1, $2) on conflict (name) do update set name = excluded.name returning id`,
    [name, isTarget],
  );
  const id = Number(r.rows[0]!.id);
  bookmakerIds.set(k, id);
  return id;
}

/** Store quotes via upsert_odds (history rows only on price change). Returns number of changes. */
export async function storeQuotes(db: Db, eventId: number, quotes: readonly OddsQuote[], targetBookmaker: string): Promise<number> {
  let changes = 0;
  for (const q of quotes) {
    const bid = await bookmakerId(db, q.bookmaker, q.bookmaker.toLowerCase() === targetBookmaker.toLowerCase());
    const provider = q.origin === "DEMO" ? "demo" : q.provider;
    for (const outcome of OUTCOMES[q.market.type]) {
      const price = q.prices[outcome];
      if (price === undefined) continue;
      const r = await db.query<{ changed: boolean }>(`select upsert_odds($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as changed`, [
        eventId, bid, marketKey(q.market), outcome, price, provider, q.providerMarketName, q.settlementVerified, q.providerUpdatedAt, q.fetchedAt,
      ]);
      if (r.rows[0]?.changed) changes++;
    }
  }
  return changes;
}

// ------------------------------------------------------------------ recommendations
export async function recordEvaluations(
  db: Db,
  eventId: number,
  evals: readonly SelectionEvaluation[],
  meta: { thresholds: Thresholds; isDemo: boolean; targetOrigin: string },
): Promise<number> {
  let n = 0;
  for (const e of evals) {
    if (e.ev === null || e.fairProbability === null || e.targetOdds === null || !e.confidence) continue;
    const r = await db.query(
      `insert into recommendations (event_id, market_key, outcome, category, target_odds, fair_probability, expected_value, confidence,
         confidence_breakdown, reference_snapshot, reasons, algorithm_version, thresholds, is_demo, target_origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14,$15)
       on conflict (event_id, market_key, outcome, target_odds, algorithm_version) do nothing returning id`,
      [
        eventId, e.marketKey, e.outcome, e.category, e.targetOdds, e.fairProbability, e.ev, e.confidence.score,
        JSON.stringify(e.confidence), JSON.stringify(e.consensus), e.reasons, ALGORITHM_VERSION, JSON.stringify(meta.thresholds), meta.isDemo, meta.targetOrigin,
      ],
    );
    n += r.rows.length;
  }
  return n;
}

export interface RecommendationRow {
  id: string;
  event_id: number;
  home_name: string;
  away_name: string;
  league: string | null;
  starts_at: string;
  market_key: string;
  outcome: string;
  category: string;
  target_odds: number;
  fair_probability: number;
  expected_value: number;
  confidence: number;
  reasons: string[];
  is_demo: boolean;
  created_at: string;
  result_outcome: BetOutcome | null;
  unit_profit: number | null;
  home_score_ft: number | null;
  away_score_ft: number | null;
}

export async function listRecommendations(db: Db, opts: { limit?: number; minCategory?: "WATCHLIST" | "ALL"; includeDemo?: boolean } = {}): Promise<RecommendationRow[]> {
  const where: string[] = [];
  if (opts.minCategory === "WATCHLIST") where.push(`r.category in ('EXCELLENT_VALUE','POTENTIAL_VALUE','WATCHLIST')`);
  if (!opts.includeDemo) where.push(`not r.is_demo`);
  const rows = await db.query<RecommendationRow>(
    `select r.id, r.event_id, e.home_name, e.away_name, l.name as league, e.starts_at, r.market_key, r.outcome, r.category,
            r.target_odds::float8 as target_odds, r.fair_probability::float8 as fair_probability, r.expected_value::float8 as expected_value,
            r.confidence, r.reasons, r.is_demo, r.created_at, rr.outcome as result_outcome, rr.unit_profit::float8 as unit_profit,
            e.home_score_ft, e.away_score_ft
       from recommendations r join events e on e.id = r.event_id left join leagues l on l.id = e.league_id
       left join recommendation_results rr on rr.recommendation_id = r.id
      ${where.length ? "where " + where.join(" and ") : ""}
      order by r.created_at desc limit $1`,
    [opts.limit ?? 200],
  );
  return rows.rows;
}

/** Enter the 90-minute final score and settle every recommendation on the event. */
export async function settleEvent(db: Db, eventId: number, home: number, away: number): Promise<number> {
  await db.query(`update events set home_score_ft = $2, away_score_ft = $3, status = 'finished', result_source = 'manual', updated_at = now() where id = $1`, [eventId, home, away]);
  const recs = await db.query<{ id: string; market_key: string; outcome: string; target_odds: number }>(
    `select id, market_key, outcome, target_odds::float8 as target_odds from recommendations where event_id = $1`,
    [eventId],
  );
  let n = 0;
  for (const r of recs.rows) {
    let outcome: BetOutcome;
    try {
      outcome = settleSelection(r.market_key, r.outcome, home, away);
    } catch {
      continue;
    }
    await db.query(
      `insert into recommendation_results (recommendation_id, outcome, unit_profit, settled_at) values ($1, $2, $3, now())
       on conflict (recommendation_id) do update set outcome = excluded.outcome, unit_profit = excluded.unit_profit, settled_at = now()`,
      [r.id, outcome, unitProfit(r.target_odds, outcome)],
    );
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ watchlist
export interface WatchRow {
  id: number;
  event_id: number;
  home_name: string;
  away_name: string;
  starts_at: string;
  market_key: string | null;
  outcome: string | null;
  note: string | null;
  league: string | null;
}

export async function addWatch(db: Db, eventId: number, marketKey: string | null, outcome: string | null, note: string | null) {
  await db.query(
    `insert into watchlist (user_id, event_id, market_key, outcome, note) values ($1,$2,$3,$4,$5)
     on conflict (user_id, event_id, market_key, outcome) do update set note = coalesce(excluded.note, watchlist.note)`,
    [LOCAL_USER_ID, eventId, marketKey, outcome, note],
  );
}
export async function removeWatch(db: Db, id: number) {
  await db.query(`delete from watchlist where id = $1 and user_id = $2`, [id, LOCAL_USER_ID]);
}
export async function listWatch(db: Db): Promise<WatchRow[]> {
  return (
    await db.query<WatchRow>(
      `select w.id, w.event_id, e.home_name, e.away_name, e.starts_at, w.market_key, w.outcome, w.note, l.name as league
         from watchlist w join events e on e.id = w.event_id left join leagues l on l.id = e.league_id
        where w.user_id = $1 order by e.starts_at`,
      [LOCAL_USER_ID],
    )
  ).rows;
}

// ------------------------------------------------------------------ sync log
export async function logSync(db: Db, s: { provider: string; job: string; ok: boolean; requestsUsed: number; quotes: number; changes: number; rateLimit?: unknown; error?: string }) {
  await db.query(
    `insert into sync_runs (provider_id, job, finished_at, ok, requests_used, quotes_seen, changes_written, rate_limit, error)
     values ($1,$2,now(),$3,$4,$5,$6,$7::jsonb,$8)`,
    [s.provider, s.job, s.ok, s.requestsUsed, s.quotes, s.changes, JSON.stringify(s.rateLimit ?? null), s.error ?? null],
  );
}

export async function lastSyncs(db: Db, limit = 10) {
  return (
    await db.query<{ provider_id: string; job: string; finished_at: string; ok: boolean; requests_used: number; quotes_seen: number; rate_limit: Record<string, unknown> | null; error: string | null }>(
      `select provider_id, job, finished_at, ok, requests_used, quotes_seen, rate_limit, error from sync_runs order by id desc limit $1`,
      [limit],
    )
  ).rows;
}
