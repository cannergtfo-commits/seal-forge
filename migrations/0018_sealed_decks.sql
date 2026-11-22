-- Multiple sealed decks per wallet. veil_profiles.deck / deck_name stay as the
-- ACTIVE deck (a mirror), so matchmaking, progress backups and the signed
-- progress message keep reading the same columns they always have.
create table if not exists veil_decks (
  id text primary key,
  wallet text not null,
  name text not null default '',
  cards text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists veil_decks_wallet on veil_decks (wallet, created_at);

alter table veil_profiles add column if not exists active_deck text not null default '';

-- Carry every existing sealed deck over as that wallet's first deck, and make it active.
insert into veil_decks (id, wallet, name, cards)
  select 'dk' || substr(md5(address), 1, 16), address, coalesce(deck_name, ''), deck
    from veil_profiles
   where deck <> ''
     and not exists (select 1 from veil_decks d where d.wallet = veil_profiles.address)
  on conflict (id) do nothing;
update veil_profiles
   set active_deck = 'dk' || substr(md5(address), 1, 16)
 where deck <> '' and active_deck = '';
