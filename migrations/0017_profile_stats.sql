-- Profile page: a short owner-written motto, and which seal/deck each scored
-- match was played with (so "most played seal" and "favourite card" come from
-- real server records). Rows written before this migration keep '' and are
-- counted as "unknown seal" rather than guessed.
alter table veil_profiles add column if not exists motto text not null default '';
alter table veil_room_results add column if not exists faction text not null default '';
alter table veil_room_results add column if not exists deck text not null default '';
