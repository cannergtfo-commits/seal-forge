-- First-win gift: the hash of every keeper transaction (begin, buy, commit, settle)
-- is stored the moment it is broadcast, so a retry or a restart resumes from the
-- chain instead of sending (and paying for) the same step twice.
create table if not exists veil_gift_steps (
  wallet text not null,
  step text not null,
  tx_hash text not null,
  created_at timestamptz not null default now(),
  primary key (wallet, step)
);
