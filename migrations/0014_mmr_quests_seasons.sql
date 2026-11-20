-- Matchmaking rating (Techno P2 #10). Elo, starts at 1000, only human-vs-human rooms move it.
alter table veil_profiles add column if not exists mmr integer not null default 1000;
alter table veil_profiles add column if not exists mmr_games integer not null default 0;

-- One MMR update per room, so retries never move ratings twice.
create table if not exists veil_mmr_matches (
  room_id text primary key,
  winner text not null,
  loser text not null,
  winner_delta integer not null,
  loser_delta integer not null,
  created_at timestamptz not null default now()
);

-- Daily quests and seasons (Techno P2 #12). Schema only. The game ignores these
-- tables until FEATURE_QUESTS=1 / FEATURE_SEASONS=1 are set (both off by default).
create table if not exists veil_quests (
  id text primary key,
  title text not null,
  goal text not null,
  target integer not null default 1,
  reward_xp integer not null default 0,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists veil_quest_progress (
  wallet text not null,
  quest_id text not null references veil_quests (id),
  utc_day text not null,
  progress integer not null default 0,
  completed_at timestamptz,
  primary key (wallet, quest_id, utc_day)
);

create table if not exists veil_seasons (
  id text primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false
);

create table if not exists veil_season_ranks (
  season_id text not null references veil_seasons (id),
  wallet text not null,
  points integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  peak_mmr integer not null default 1000,
  primary key (season_id, wallet)
);
