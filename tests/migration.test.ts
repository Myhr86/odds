import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Applies the real migration to an in-process PostgreSQL (PGlite) with a minimal stub of
// Supabase's `auth` schema and roles, then checks the behaviour the app relies on.
const sql = readFileSync(new URL("../supabase/migrations/20261101000000_init.sql", import.meta.url), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(sql);
  await db.exec(`
    insert into bookmakers (name, is_target) values ('Norsk Tipping', true);
    insert into bookmakers (name, is_sharp, reliability_weight) values ('Pinnacle', true, 3);
    insert into events (sport_id, home_name, away_name, starts_at) values ('football', 'H', 'A', '2026-11-02T18:00:00Z');
  `);
}, 30_000);

const upsert = (odds: number, at: string) =>
  db.query<{ upsert_odds: boolean }>(
    `select upsert_odds(1, 1, 'football|TOTAL_GOALS|FT_REGULAR|2.5|-', 'over', $1, 'odds-api.io', 'Totals', false, $2::timestamptz - interval '10 seconds', $2::timestamptz)`,
    [odds, at],
  );

describe("migration", () => {
  it("only one target bookmaker allowed", async () => {
    await expect(db.exec(`insert into bookmakers (name, is_target) values ('Other', true)`)).rejects.toThrow();
  });

  it("upsert_odds writes a change row only when the price changes", async () => {
    expect((await upsert(2.05, "2026-11-01T12:00:00Z")).rows[0]!.upsert_odds).toBe(true);
    expect((await upsert(2.05, "2026-11-01T12:01:00Z")).rows[0]!.upsert_odds).toBe(false);
    expect((await upsert(2.0, "2026-11-01T12:02:00Z")).rows[0]!.upsert_odds).toBe(true);
    const changes = await db.query<{ previous_odds: string | null; new_odds: string; data_age_seconds: number }>(
      `select previous_odds, new_odds, data_age_seconds from odds_changes order by id`,
    );
    expect(changes.rows.map((r) => [r.previous_odds === null ? null : Number(r.previous_odds), Number(r.new_odds)])).toEqual([[null, 2.05], [2.05, 2.0]]);
    expect(changes.rows[0]!.data_age_seconds).toBe(10);
    const cur = await db.query<{ odds: string; fetched_at: Date }>(`select odds, fetched_at from odds_current`);
    expect(Number(cur.rows[0]!.odds)).toBe(2.0);
  });

  it("rejects invalid odds", async () => {
    await expect(upsert(1.0, "2026-11-01T12:03:00Z")).rejects.toThrow();
  });

  it("recommendations are immutable and de-duplicated per price", async () => {
    const ins = `insert into recommendations (event_id, market_key, outcome, category, target_odds, fair_probability, expected_value, confidence,
      confidence_breakdown, reference_snapshot, reasons, algorithm_version, thresholds)
      values (1, 'football|TOTAL_GOALS|FT_REGULAR|2.5|-', 'over', 'POTENTIAL_VALUE', 2.05, 0.51, 0.0455, 72, '{}', '{}', array['x'], 'v1', '{}')
      on conflict do nothing returning id`;
    const a = await db.query<{ id: string }>(ins);
    const b = await db.query<{ id: string }>(ins);
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(0);
    await expect(db.exec(`update recommendations set confidence = 99`)).rejects.toThrow(/immutable/);
    await expect(db.exec(`delete from recommendations`)).rejects.toThrow(/immutable/);
  });

  it("performance view aggregates settled results", async () => {
    await db.exec(`insert into recommendation_results (recommendation_id, clv, outcome, unit_profit)
                   select id, 0.03, 'win', 1.05 from recommendations limit 1`);
    const r = await db.query<{ n: string; roi: string; avg_clv: string }>(`select n, roi, avg_clv from recommendation_performance`);
    expect(Number(r.rows[0]!.n)).toBe(1);
    expect(Number(r.rows[0]!.roi)).toBeCloseTo(1.05, 6);
  });

  it("lag_seconds is computed", async () => {
    await db.exec(`insert into lag_observations (event_id, market_key, outcome, reference_moved_at, reference_move_pct, target_adjusted_at)
                   values (1, 'k', 'over', '2026-11-01T12:00:00Z', 0.04, '2026-11-01T12:03:30Z')`);
    const r = await db.query<{ lag_seconds: number }>(`select lag_seconds from lag_observations`);
    expect(r.rows[0]!.lag_seconds).toBe(210);
  });

  it("watchlist allows event-level entries (null market) without duplicates", async () => {
    const u = "00000000-0000-0000-0000-000000000001";
    await db.exec(`insert into watchlist (user_id, event_id) values ('${u}', 1)`);
    await expect(db.exec(`insert into watchlist (user_id, event_id) values ('${u}', 1)`)).rejects.toThrow();
  });

  it("prune keeps odds history for events with recommendations", async () => {
    await db.exec(`update odds_changes set observed_at = now() - interval '200 days'`);
    const r = await db.query<{ n: number }>(`select prune_odds_changes() as n`);
    expect(r.rows[0]!.n).toBe(0);
  });
});
