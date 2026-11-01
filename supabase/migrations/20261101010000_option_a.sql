-- Option A: manual Norsk Tipping entry + The Odds API reference odds.
insert into providers (id, kind, is_demo) values ('the-odds-api', 'odds', false), ('manual', 'odds', false)
  on conflict (id) do nothing;

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Final score entered by the user (90 minutes incl. stoppage) used to settle recommendations.
alter table events add column if not exists result_source text;

-- Origin of a recommendation's target price (MANUAL entry vs provider feed).
alter table recommendations add column if not exists target_origin text not null default 'LIVE_PROVIDER';
