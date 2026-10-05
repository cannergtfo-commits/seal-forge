alter table veil_profiles add column if not exists gifted integer not null default 0;
alter table veil_profiles add column if not exists gift_order text not null default '';
alter table veil_profiles add column if not exists gift_cards text not null default '';
