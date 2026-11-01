-- ODDS INTELLIGENCE – initial schema
-- Conventions: all timestamps timestamptz (UTC); decimal odds numeric(8,3); probabilities numeric(9,8).
-- Odds storage strategy (see docs/02-architecture.md §6):
--   odds_current  : one row per (event, bookmaker, market_key, outcome) – upserted each poll.
--   odds_changes  : append-only, written ONLY when the price actually changes (no duplicate snapshots).
--   closing_lines : frozen at kick-off; kept forever (needed for CLV).
--   recommendations: immutable record of every recommendation generated, bet on or not.

-- gen_random_uuid() is built into PostgreSQL 13+.

-- ---------------------------------------------------------------- reference data
create table sports (
  id   text primary key,               -- 'football'
  name text not null
);

create table leagues (
  id         bigint generated always as identity primary key,
  sport_id   text not null references sports(id),
  name       text not null,
  country    text,
  unique (sport_id, name, country)
);

create table teams (
  id        bigint generated always as identity primary key,
  sport_id  text not null references sports(id),
  name      text not null,
  unique (sport_id, name)
);

-- Alternative spellings per provider, used by cross-provider event matching.
create table team_aliases (
  team_id  bigint not null references teams(id) on delete cascade,
  provider text not null,
  alias    text not null,
  primary key (provider, alias)
);

create table providers (
  id          text primary key,         -- 'odds-api.io', 'api-football', 'demo'
  kind        text not null check (kind in ('odds', 'stats')),
  is_demo     boolean not null default false
);

create table bookmakers (
  id                  bigint generated always as identity primary key,
  name                text not null unique,     -- canonical display name
  is_target           boolean not null default false,  -- Norsk Tipping
  reliability_weight  numeric(5,2) not null default 1,
  is_sharp            boolean not null default false,
  active              boolean not null default true
);
create unique index bookmakers_single_target on bookmakers (is_target) where is_target;

create table bookmaker_provider_names (
  bookmaker_id  bigint not null references bookmakers(id) on delete cascade,
  provider_id   text not null references providers(id),
  provider_name text not null,
  primary key (provider_id, provider_name)
);

-- ---------------------------------------------------------------- events
create table events (
  id            bigint generated always as identity primary key,
  sport_id      text not null references sports(id),
  league_id     bigint references leagues(id),
  home_team_id  bigint references teams(id),
  away_team_id  bigint references teams(id),
  home_name     text not null,
  away_name     text not null,
  starts_at     timestamptz not null,
  status        text not null default 'scheduled'
                check (status in ('scheduled', 'live', 'finished', 'cancelled', 'unknown')),
  home_score_ft smallint,          -- 90 min + stoppage
  away_score_ft smallint,
  home_score_ht smallint,
  away_score_ht smallint,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index events_starts_at_idx on events (starts_at);
create index events_status_starts_idx on events (status, starts_at);

create table event_provider_ids (
  event_id          bigint not null references events(id) on delete cascade,
  provider_id       text not null references providers(id),
  provider_event_id text not null,
  match_confidence  numeric(4,3) not null default 1,     -- 1 = same provider id, <1 = fuzzy matched
  primary key (provider_id, provider_event_id)
);
create index event_provider_ids_event_idx on event_provider_ids (event_id);

-- ---------------------------------------------------------------- odds
-- market_key format: sport|TYPE|PERIOD|line|team (see src/lib/markets/types.ts)
create table odds_current (
  event_id            bigint not null references events(id) on delete cascade,
  bookmaker_id        bigint not null references bookmakers(id),
  market_key          text not null,
  outcome             text not null,
  odds                numeric(8,3) not null check (odds > 1),
  provider_id         text not null references providers(id),
  provider_market     text not null,                 -- raw provider market name, for audit
  settlement_verified boolean not null default false,
  provider_updated_at timestamptz,                   -- when the bookmaker changed the price
  fetched_at          timestamptz not null,          -- when we saw it
  primary key (event_id, bookmaker_id, market_key, outcome)
);
create index odds_current_event_market_idx on odds_current (event_id, market_key);

create table odds_changes (
  id                  bigint generated always as identity primary key,
  event_id            bigint not null references events(id) on delete cascade,
  bookmaker_id        bigint not null references bookmakers(id),
  market_key          text not null,
  outcome             text not null,
  previous_odds       numeric(8,3),
  new_odds            numeric(8,3) not null check (new_odds > 1),
  provider_id         text not null references providers(id),
  provider_updated_at timestamptz,
  observed_at         timestamptz not null,
  data_age_seconds    integer                        -- observed_at - provider_updated_at at capture
);
create index odds_changes_lookup_idx on odds_changes (event_id, market_key, outcome, observed_at);
create index odds_changes_observed_idx on odds_changes (observed_at);

-- Upsert current price; append to odds_changes only if the price changed (or is new).
create or replace function upsert_odds(
  p_event_id bigint, p_bookmaker_id bigint, p_market_key text, p_outcome text, p_odds numeric,
  p_provider_id text, p_provider_market text, p_settlement_verified boolean,
  p_provider_updated_at timestamptz, p_fetched_at timestamptz
) returns boolean language plpgsql as $$
declare
  v_prev numeric(8,3);
begin
  select odds into v_prev from odds_current
   where event_id = p_event_id and bookmaker_id = p_bookmaker_id and market_key = p_market_key and outcome = p_outcome
   for update;

  insert into odds_current as oc (event_id, bookmaker_id, market_key, outcome, odds, provider_id, provider_market,
                                  settlement_verified, provider_updated_at, fetched_at)
  values (p_event_id, p_bookmaker_id, p_market_key, p_outcome, p_odds, p_provider_id, p_provider_market,
          p_settlement_verified, p_provider_updated_at, p_fetched_at)
  on conflict (event_id, bookmaker_id, market_key, outcome) do update
    set odds = excluded.odds, provider_id = excluded.provider_id, provider_market = excluded.provider_market,
        settlement_verified = excluded.settlement_verified,
        provider_updated_at = excluded.provider_updated_at, fetched_at = excluded.fetched_at;

  if v_prev is distinct from p_odds::numeric(8,3) then
    insert into odds_changes (event_id, bookmaker_id, market_key, outcome, previous_odds, new_odds, provider_id,
                              provider_updated_at, observed_at, data_age_seconds)
    values (p_event_id, p_bookmaker_id, p_market_key, p_outcome, v_prev, p_odds, p_provider_id,
            p_provider_updated_at, p_fetched_at,
            case when p_provider_updated_at is null then null
                 else greatest(0, extract(epoch from (p_fetched_at - p_provider_updated_at)))::int end);
    return true;
  end if;
  return false;
end $$;

create table closing_lines (
  event_id               bigint not null references events(id) on delete cascade,
  market_key             text not null,
  outcome                text not null,
  target_closing_odds    numeric(8,3),            -- Norsk Tipping's last price
  consensus_fair_prob    numeric(9,8),            -- margin-free reference consensus at close
  consensus_n_books      smallint,
  captured_at            timestamptz not null,
  primary key (event_id, market_key, outcome)
);

-- ---------------------------------------------------------------- recommendations & results
create table recommendations (
  id                    uuid primary key default gen_random_uuid(),
  event_id              bigint not null references events(id),
  market_key            text not null,
  outcome               text not null,
  category              text not null check (category in ('EXCELLENT_VALUE','POTENTIAL_VALUE','WATCHLIST','INSUFFICIENT_DATA','NO_VALUE')),
  target_odds           numeric(8,3) not null check (target_odds > 1),
  fair_probability      numeric(9,8) not null check (fair_probability > 0 and fair_probability < 1),
  expected_value        numeric(8,5) not null,
  confidence            smallint not null check (confidence between 0 and 100),
  confidence_breakdown  jsonb not null,
  reference_snapshot    jsonb not null,           -- books used/rejected, their fair probs, ages
  reasons               text[] not null,
  probability_source    text not null default 'market_consensus',   -- or model id
  algorithm_version     text not null,
  thresholds            jsonb not null,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  -- one active recommendation per selection per price: re-recording the same price is a no-op
  unique (event_id, market_key, outcome, target_odds, algorithm_version)
);
create index recommendations_created_idx on recommendations (created_at desc);
create index recommendations_event_idx on recommendations (event_id);
create index recommendations_category_idx on recommendations (category, created_at desc);

-- Recommendations are immutable evidence: block updates/deletes.
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'recommendations are immutable';
end $$;
create trigger recommendations_immutable before update or delete on recommendations
  for each row execute function forbid_change();

create table recommendation_results (
  recommendation_id  uuid primary key references recommendations(id),
  closing_odds       numeric(8,3),
  closing_fair_prob  numeric(9,8),
  clv                numeric(8,5),           -- target_odds × closing_fair_prob − 1
  outcome            text check (outcome in ('win','loss','push','half_win','half_loss','void')),
  unit_profit        numeric(8,4),
  settled_at         timestamptz
);

-- ---------------------------------------------------------------- market lag detector
create table lag_observations (
  id                       bigint generated always as identity primary key,
  event_id                 bigint not null references events(id) on delete cascade,
  market_key               text not null,
  outcome                  text not null,
  first_mover_bookmaker_id bigint references bookmakers(id),
  reference_moved_at       timestamptz not null,
  reference_move_pct       numeric(8,5) not null,   -- change in consensus fair prob (relative)
  target_odds_before       numeric(8,3),
  target_adjusted_at       timestamptz,             -- null while still unadjusted
  target_odds_after        numeric(8,3),
  lag_seconds              integer generated always as
                           (case when target_adjusted_at is null then null
                                 else extract(epoch from (target_adjusted_at - reference_moved_at))::int end) stored,
  created_at               timestamptz not null default now()
);
create index lag_observations_event_idx on lag_observations (event_id, market_key);

-- ---------------------------------------------------------------- operations
create table sync_runs (
  id            bigint generated always as identity primary key,
  provider_id   text not null references providers(id),
  job           text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  requests_used integer not null default 0,
  events_seen   integer not null default 0,
  quotes_seen   integer not null default 0,
  changes_written integer not null default 0,
  rate_limit    jsonb,
  error         text
);
create index sync_runs_provider_started_idx on sync_runs (provider_id, started_at desc);

-- ---------------------------------------------------------------- user data
create table watchlist (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  event_id    bigint not null references events(id) on delete cascade,
  market_key  text,
  outcome     text,
  note        text,
  created_at  timestamptz not null default now(),
  unique nulls not distinct (user_id, event_id, market_key, outcome)
);
create index watchlist_user_idx on watchlist (user_id);

create table user_settings (
  user_id     uuid primary key,
  thresholds  jsonb not null default '{}'::jsonb,
  -- Responsible-gambling limits (only used if bankroll tracking is enabled)
  monthly_limit_nok  numeric(10,2),
  max_stake_nok      numeric(10,2),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- retention
-- Keep raw odds_changes for 90 days, EXCEPT for events that have a recommendation (kept forever for audit).
create or replace function prune_odds_changes(p_keep interval default interval '90 days') returns integer
language plpgsql as $$
declare n integer;
begin
  delete from odds_changes oc
   where oc.observed_at < now() - p_keep
     and not exists (select 1 from recommendations r where r.event_id = oc.event_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- performance view
create view recommendation_performance as
select r.category,
       count(*)                                         as n,
       count(rr.outcome) filter (where rr.outcome not in ('void','push')) as n_settled,
       avg(r.expected_value)                            as avg_ev,
       avg(r.target_odds)                               as avg_odds,
       avg(rr.clv)                                      as avg_clv,
       sum(rr.unit_profit)                              as profit_units,
       sum(rr.unit_profit) / nullif(count(rr.outcome) filter (where rr.outcome not in ('void','push')), 0) as roi
  from recommendations r
  left join recommendation_results rr on rr.recommendation_id = r.id
 where not r.is_demo
 group by r.category;

-- ---------------------------------------------------------------- RLS
alter table watchlist enable row level security;
alter table user_settings enable row level security;
create policy watchlist_owner on watchlist for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy settings_owner on user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Market data is written only by the server (service role) and read by authenticated users.
alter table events enable row level security;
alter table odds_current enable row level security;
alter table odds_changes enable row level security;
alter table recommendations enable row level security;
alter table recommendation_results enable row level security;
alter table closing_lines enable row level security;
alter table lag_observations enable row level security;
create policy read_events on events for select to authenticated using (true);
create policy read_odds_current on odds_current for select to authenticated using (true);
create policy read_odds_changes on odds_changes for select to authenticated using (true);
create policy read_recs on recommendations for select to authenticated using (true);
create policy read_rec_results on recommendation_results for select to authenticated using (true);
create policy read_closing on closing_lines for select to authenticated using (true);
create policy read_lag on lag_observations for select to authenticated using (true);

insert into sports (id, name) values ('football', 'Football');
insert into providers (id, kind, is_demo) values ('odds-api.io', 'odds', false), ('api-football', 'stats', false), ('demo', 'odds', true);
