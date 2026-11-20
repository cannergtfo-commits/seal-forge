-- Free-mint gifting queue (plan section 5, option 1+3). Inert unless FEATURE_FREE_MINT=1
-- and a separate treasury key (FREE_MINT_SIGNER) is configured. A user-funded treasury
-- wallet buys normal packs through the existing pack contracts, settles them, and
-- transfers the cards to the player. No contract changes.
create table if not exists veil_free_mints (
  id text primary key,
  wallet text not null,
  window_id text not null,
  n integer not null,
  edition text not null,
  faction integer not null default 0,
  price_wei text not null,
  status text not null default 'queued',
  order_id text,
  buy_tx text,
  buy_block text,
  card_ids text,
  settle_tx text,
  transfer_txs text not null default '{}',
  error text,
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wallet, window_id, n)
);
create index if not exists veil_free_mints_status on veil_free_mints (status, created_at);
create index if not exists veil_free_mints_window on veil_free_mints (window_id, created_at);
