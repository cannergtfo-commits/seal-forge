create table if not exists veil_profiles (
  address text primary key,
  name text not null,
  portrait text not null,
  nft_contract text,
  nft_token text,
  nft_image text,
  xp integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  deck text not null default '',
  session text,
  created_at timestamptz not null default now()
);
