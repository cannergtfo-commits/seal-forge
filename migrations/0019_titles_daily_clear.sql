-- Daily-clear bonus (4th claimed win voucher of a UTC day) and the title/badge catalog.
-- Titles are granted server-side from already-tracked stats. No contract changes.

alter table veil_prizes add column if not exists claimed_at timestamptz;

create table if not exists veil_daily_clears (
  wallet text not null,
  utc_day text not null,
  xp integer not null,
  tx_hash text not null,
  granted_at timestamptz not null default now(),
  primary key (wallet, utc_day)
);
create index if not exists veil_daily_clears_day on veil_daily_clears (utc_day);

create table if not exists veil_titles (
  id text primary key,
  name text not null,
  flavor text not null,
  rarity text not null,
  badge text not null,
  rule text not null,
  threshold integer not null default 0,
  param text not null default '',
  sort integer not null default 0
);

create table if not exists veil_title_unlocks (
  wallet text not null,
  title_id text not null references veil_titles (id),
  unlocked_at timestamptz not null default now(),
  primary key (wallet, title_id)
);
create index if not exists veil_title_unlocks_wallet on veil_title_unlocks (wallet);

alter table veil_profiles add column if not exists title_id text not null default '';

insert into veil_titles (id, name, flavor, rarity, badge, rule, threshold, param, sort) values
  ('first-oath', 'First Oath', 'The first mark on the ledger.', 'common', 'spark', 'wins', 1, '', 10),
  ('founding-bearer', 'Founding Bearer', 'A Founding Forge pack, once, from the gift pool.', 'rare', 'pack', 'gifted', 1, '', 20),
  ('ashborne', 'Ashborne', 'Out of the spark, into the ash.', 'common', 'ash', 'xp', 40, '', 30),
  ('the-sealed', 'The Sealed', 'The name is bound. The work begins.', 'rare', 'crest', 'xp', 120, '', 40),
  ('wardens-oath', 'Warden''s Oath', 'The five seals keep their watch.', 'rare', 'crest', 'xp', 300, '', 50),
  ('champions-crest', 'Champion''s Crest', 'A crest earned, not given.', 'epic', 'crest', 'xp', 700, '', 60),
  ('sovereign-crown', 'Sovereign', 'The high seat, at the end of the long climb.', 'legendary', 'crown', 'xp', 1400, '', 70),
  ('proven', 'Proven', 'Ten victories, counted by the server.', 'common', 'spark', 'wins', 10, '', 80),
  ('warhost', 'Warhost', 'Fifty wins. The hall knows the name.', 'rare', 'crest', 'wins', 50, '', 90),
  ('hundred-seals', 'Hundred Seals', 'A hundred wins, each one signed in.', 'epic', 'crown', 'wins', 100, '', 100),
  ('ember-path', 'Ember Path', 'Three days of claiming every daily win.', 'rare', 'flame', 'streak', 3, '', 110),
  ('week-of-seals', 'Week of Seals', 'Seven straight days of a full claim.', 'epic', 'flame', 'streak', 7, '', 120),
  ('iron-month', 'Iron Month', 'Thirty days. The path does not break.', 'legendary', 'flame', 'streak', 30, '', 130),
  ('aureth-adept', 'Aureth Adept', 'Ten wins under the goldwood seal.', 'rare', 'seal-elf', 'seal-wins', 10, 'elf', 140),
  ('veymar-adept', 'Veymar Adept', 'Ten wins under the iron oath.', 'rare', 'seal-human', 'seal-wins', 10, 'human', 150),
  ('rixen-adept', 'Rixen Adept', 'Ten wins under the raider drum.', 'rare', 'seal-goblin', 'seal-wins', 10, 'goblin', 160),
  ('quorin-adept', 'Quorin Adept', 'Ten wins under the forge-light.', 'rare', 'seal-robot', 'seal-wins', 10, 'robot', 170),
  ('malrec-adept', 'Malrec Adept', 'Ten wins under the crimson seal.', 'rare', 'seal-demon', 'seal-wins', 10, 'demon', 180),
  ('five-walks', 'Walker of Five Seals', 'A win in every seal. The pentacle closes.', 'legendary', 'pentacle', 'seals-touched', 5, '', 190),
  ('two-oaths', 'Two Oaths', 'Two sealed decks, ready to be called.', 'common', 'decks', 'decks', 2, '', 200),
  ('hex-of-oaths', 'Hex of Oaths', 'Six decks sealed. The forge is full.', 'epic', 'decks', 'decks', 6, '', 210),
  ('season-contender', 'Season Contender', 'Season ranks are not open yet. This title waits.', 'epic', 'season', 'season', 1, '', 220)
on conflict (id) do nothing;
