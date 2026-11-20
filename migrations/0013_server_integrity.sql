-- Server integrity (Techno P0 #1/#2): survive restarts without losing the
-- daily reward cap, the voucher ledger, live tables, or applying XP twice.

-- One row per wallet per UTC day. `n` is the number of win vouchers issued.
create table if not exists veil_daily_wins (
  wallet text not null,
  utc_day text not null,
  n integer not null default 0,
  primary key (wallet, utc_day)
);

-- One voucher per server room, ever. Re-served unchanged on every reconnect.
create table if not exists veil_prizes (
  room_id text primary key,
  match_id text not null unique,
  wallet text not null,
  utc_day text not null,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  claimed_tx text
);
create index if not exists veil_prizes_wallet on veil_prizes (wallet, utc_day);

-- Snapshot of each server room (match state + seats), rewritten after every change
-- and loaded back at boot so a restart does not drop live games.
create table if not exists veil_rooms (
  id text primary key,
  state text not null,
  finished boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists veil_rooms_updated on veil_rooms (updated_at);

-- One scored result per (room, wallet). XP is only applied when this insert wins,
-- so a replayed or retried score can never count twice.
create table if not exists veil_room_results (
  room_id text not null,
  wallet text not null,
  win boolean not null,
  turns integer not null default 0,
  conceded boolean not null default false,
  vs_bot boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (room_id, wallet)
);
create index if not exists veil_room_results_wallet on veil_room_results (wallet, created_at);

-- Per-card transfer receipts for the gift pack, so a retry never decides from balances.
create table if not exists veil_gift_transfers (
  wallet text not null,
  order_id text not null,
  token_id text not null,
  amount integer not null default 1,
  tx_hash text not null,
  created_at timestamptz not null default now(),
  primary key (wallet, order_id, token_id)
);
