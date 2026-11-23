-- Run in Supabase SQL Editor. This creates only the initial game-account and
-- leaderboard data; it does not touch Busline's city publication tables.
create extension if not exists pgcrypto;

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar\.(webp|jpeg)$'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now()
);
-- Existing installations created before avatar support need this additive
-- migration because CREATE TABLE IF NOT EXISTS does not alter old columns.
alter table public.game_profiles add column if not exists avatar_path text;
alter table public.game_profiles add column if not exists avatar_url text;
alter table public.game_profiles drop constraint if exists game_profiles_avatar_path_check;
alter table public.game_profiles add constraint game_profiles_avatar_path_check check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar\.(webp|jpeg)$');
create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('line','station','city','county')),
  difficulty text not null check (difficulty in ('easy','hell','hard')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  game_city text not null default '北京市' check (char_length(game_city) between 1 and 64),
  check ((game in ('line','station') and difficulty in ('easy','hell')) or (game in ('city','county') and difficulty = 'hard')),
  check (score is null or score between 0 and 2000)
);
alter table public.game_runs add column if not exists game_city text not null default '北京市';
create index if not exists game_runs_board_idx on public.game_runs (game, difficulty, score desc, finished_at asc) where finished_at is not null;
create index if not exists game_runs_city_board_idx on public.game_runs (game_city, game, difficulty, score desc, finished_at asc) where finished_at is not null;
-- `game_runs` remains the audit trail for individual attempts.  Leaderboards
-- themselves are materialized below: each city/scope + game + difficulty has
-- one header and one row per player.  This makes a leaderboard read a direct
-- indexed read, rather than a scan and re-ranking of the full attempt history.
create table if not exists public.game_leaderboards (
  game_city text not null check (char_length(game_city) between 1 and 64),
  game text not null check (game in ('line','station','city','county')),
  difficulty text not null check (difficulty in ('easy','hell','hard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_city, game, difficulty),
  check ((game in ('line','station') and difficulty in ('easy','hell')) or (game in ('city','county') and difficulty = 'hard'))
);
create table if not exists public.game_leaderboard_entries (
  game_city text not null,
  game text not null,
  difficulty text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  avatar_path text,
  avatar_url text,
  score integer not null check (score between 0 and 2000),
  achieved_at timestamptz not null,
  primary key (game_city, game, difficulty, user_id),
  foreign key (game_city, game, difficulty)
    references public.game_leaderboards (game_city, game, difficulty) on delete cascade
);
create index if not exists game_leaderboard_entries_read_idx
  on public.game_leaderboard_entries (game_city, game, difficulty, score desc, achieved_at asc);
-- A completed score must always have a settlement timestamp.  An unfinished
-- row has never passed the server-side settlement checks, so any score placed
-- on one (for example through the table editor) is not a valid leaderboard
-- score and must not be promoted into the ranking.
update public.game_runs
set score = null
where score is not null and finished_at is null;
alter table public.game_runs drop constraint if exists game_runs_score_requires_finished_check;
alter table public.game_runs add constraint game_runs_score_requires_finished_check
  check (score is null or finished_at is not null);

alter table public.game_profiles enable row level security;
alter table public.game_runs enable row level security;
alter table public.game_leaderboards enable row level security;
alter table public.game_leaderboard_entries enable row level security;
insert into storage.buckets (id, name, public) values ('game-avatars', 'game-avatars', true)
on conflict (id) do update set public = true;
drop policy if exists "game avatar read" on storage.objects;
drop policy if exists "game avatar insert" on storage.objects;
drop policy if exists "game avatar update" on storage.objects;
create policy "game avatar read" on storage.objects for select using (bucket_id = 'game-avatars');
create policy "game avatar insert" on storage.objects for insert to authenticated with check (bucket_id = 'game-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "game avatar update" on storage.objects for update to authenticated using (bucket_id = 'game-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.set_game_profile_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.game_profiles (id, display_name)
  values (new.id, '巴士玩家')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop function if exists public.current_game_profile();
create function public.current_game_profile()
returns table (id uuid, display_name text, avatar_path text, avatar_url text) language sql security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path, p.avatar_url from public.game_profiles p where p.id = auth.uid();
$$;

drop function if exists public.update_game_profile(text, text);
create function public.update_game_profile(p_display_name text, p_avatar_path text default null)
returns table (display_name text, avatar_path text, avatar_url text) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if char_length(trim(p_display_name)) not between 2 and 24 then raise exception '昵称须为 2–24 个字'; end if;
  if p_avatar_path is not null and p_avatar_path !~ ('^' || auth.uid()::text || '/avatar\.(webp|jpeg)$') then raise exception '头像路径无效'; end if;
  insert into public.game_profiles (id, display_name, avatar_path) values (auth.uid(), trim(p_display_name), p_avatar_path)
  on conflict (id) do update set display_name = excluded.display_name, avatar_path = coalesce(excluded.avatar_path, public.game_profiles.avatar_path), avatar_url = case when excluded.avatar_path is null then public.game_profiles.avatar_url else null end;
  return query select p.display_name, p.avatar_path, p.avatar_url from public.game_profiles p where p.id = auth.uid();
end;
$$;

-- Entries carry profile display fields so the leaderboard endpoint needs only
-- its own data. Keep those copies current when a player edits their profile.
create or replace function public.sync_game_leaderboard_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.game_leaderboard_entries
  set display_name = new.display_name,
      avatar_path = new.avatar_path,
      avatar_url = new.avatar_url
  where user_id = new.id;
  return new;
end;
$$;
drop trigger if exists sync_game_leaderboard_profile on public.game_profiles;
create trigger sync_game_leaderboard_profile
after insert or update of display_name, avatar_path, avatar_url on public.game_profiles
for each row execute procedure public.sync_game_leaderboard_profile();

-- One-time, idempotent migration of settled historical runs.  NULL and
-- unfinished rows are intentionally ignored: neither is a valid score.
insert into public.game_leaderboards (game_city, game, difficulty)
select distinct r.game_city, r.game, r.difficulty
from public.game_runs r
where r.finished_at is not null and r.score is not null
on conflict (game_city, game, difficulty) do nothing;

insert into public.game_leaderboard_entries
  (game_city, game, difficulty, user_id, display_name, avatar_path, avatar_url, score, achieved_at)
select distinct on (r.game_city, r.game, r.difficulty, r.user_id)
  r.game_city,
  r.game,
  r.difficulty,
  r.user_id,
  coalesce(p.display_name, '巴士玩家'),
  p.avatar_path,
  p.avatar_url,
  r.score,
  r.finished_at
from public.game_runs r
left join public.game_profiles p on p.id = r.user_id
where r.finished_at is not null and r.score is not null
order by r.game_city, r.game, r.difficulty, r.user_id, r.score desc, r.finished_at asc
on conflict (game_city, game, difficulty, user_id) do update
set display_name = excluded.display_name,
    avatar_path = excluded.avatar_path,
    avatar_url = excluded.avatar_url,
    score = excluded.score,
    achieved_at = excluded.achieved_at
where excluded.score > public.game_leaderboard_entries.score
   or (excluded.score = public.game_leaderboard_entries.score
       and excluded.achieved_at < public.game_leaderboard_entries.achieved_at);

drop trigger if exists on_auth_user_game_profile on auth.users;
create trigger on_auth_user_game_profile after insert on auth.users
for each row execute procedure public.set_game_profile_name();

drop function if exists public.start_game_run(text, text, text);
create function public.start_game_run(p_game text, p_difficulty text, p_city text)
returns public.game_runs language plpgsql security definer set search_path = public as $$
declare result public.game_runs;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if not ((p_game in ('line','station') and p_difficulty in ('easy','hell')) or (p_game in ('city','county') and p_difficulty = 'hard')) then
    raise exception '不存在这个游戏榜单';
  end if;
  -- Discard stale abandoned attempts.  They have no score and never appear on
  -- a leaderboard, but removing them prevents the table from accumulating
  -- endless NULL rows after users close a game midway through.
  delete from public.game_runs
  where user_id = auth.uid() and score is null and finished_at is null
    and started_at < now() - interval '15 minutes';
  -- A short per-user cooldown makes scripted run creation less useful.
  if exists (select 1 from public.game_runs where user_id = auth.uid() and started_at > now() - interval '3 seconds') then
    raise exception '请勿重复开始挑战';
  end if;
  if char_length(trim(coalesce(p_city,''))) not between 1 and 64 then raise exception '排行榜城市无效'; end if;
  insert into public.game_runs (user_id, game, difficulty, game_city) values (auth.uid(), p_game, p_difficulty, trim(p_city)) returning * into result;
  return result;
end;
$$;

create or replace function public.finish_game_run(p_run_id uuid, p_score integer)
returns table (accepted boolean, best_score integer, rank bigint) language plpgsql security definer set search_path = public as $$
declare
  run_row public.game_runs;
  elapsed_seconds integer;
  pace_cap integer;
  leaderboard_score integer;
  leaderboard_achieved_at timestamptz;
  profile_row public.game_profiles;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select * into run_row from public.game_runs where id = p_run_id and user_id = auth.uid() for update;
  if not found then raise exception '挑战不存在'; end if;
  if run_row.finished_at is not null then raise exception '挑战已结算'; end if;
  if p_score is null or p_score < 0 then raise exception '分数无效'; end if;
  if now() - run_row.started_at > interval '8 hours' then raise exception '挑战已过期'; end if;
  elapsed_seconds := extract(epoch from now() - run_row.started_at)::integer;
  -- Score is never accepted as a free client write: it must belong to a fresh,
  -- single-use authenticated run and fit a conservative server-time pace cap.
  pace_cap := least(2000, greatest(1, elapsed_seconds / 2 + 1));
  if run_row.game = 'city' then pace_cap := least(pace_cap, 10); end if;
  if run_row.game = 'county' then pace_cap := least(pace_cap, 90); end if;
  if p_score > pace_cap then raise exception '得分与本局服务器计时不符'; end if;
  update public.game_runs set score = p_score, finished_at = now() where id = p_run_id;

  -- The first settled player for a scope creates its independent leaderboard.
  -- This upsert locks the scope row during concurrent first finishes.
  insert into public.game_leaderboards (game_city, game, difficulty)
  values (run_row.game_city, run_row.game, run_row.difficulty)
  on conflict (game_city, game, difficulty) do update
  set updated_at = now();

  select * into profile_row
  from public.game_profiles
  where id = auth.uid();

  -- A player owns exactly one row in one leaderboard.  A lower or equal score
  -- keeps the existing value and achieved time unchanged, as required.
  insert into public.game_leaderboard_entries
    (game_city, game, difficulty, user_id, display_name, avatar_path, avatar_url, score, achieved_at)
  values (
    run_row.game_city,
    run_row.game,
    run_row.difficulty,
    auth.uid(),
    coalesce(profile_row.display_name, '巴士玩家'),
    profile_row.avatar_path,
    profile_row.avatar_url,
    p_score,
    now()
  )
  on conflict (game_city, game, difficulty, user_id) do update
  set display_name = excluded.display_name,
      avatar_path = excluded.avatar_path,
      avatar_url = excluded.avatar_url,
      score = excluded.score,
      achieved_at = excluded.achieved_at
  where excluded.score > public.game_leaderboard_entries.score;

  select e.score, e.achieved_at
  into leaderboard_score, leaderboard_achieved_at
  from public.game_leaderboard_entries e
  where e.game_city = run_row.game_city
    and e.game = run_row.game
    and e.difficulty = run_row.difficulty
    and e.user_id = auth.uid();

  return query
  select true,
    leaderboard_score,
    count(*) + 1
  from public.game_leaderboard_entries e
  where e.game_city = run_row.game_city
    and e.game = run_row.game
    and e.difficulty = run_row.difficulty
    and (e.score > leaderboard_score
      or (e.score = leaderboard_score and e.achieved_at < leaderboard_achieved_at));
end;
$$;

-- PostgreSQL cannot replace a function when its OUT-column shape changes.
-- This function has no dependent database objects and reads existing runs.
drop function if exists public.get_game_leaderboard(text, text);
drop function if exists public.get_game_leaderboard(text, text, text);
create function public.get_game_leaderboard(p_game text, p_difficulty text, p_city text)
returns table (rank bigint, display_name text, avatar_path text, avatar_url text, score integer, achieved_at timestamptz, is_current_user boolean) language sql security definer set search_path = public as $$
  with ranked as (
    select dense_rank() over (order by e.score desc) as rank,
      e.user_id, e.display_name, e.avatar_path, e.avatar_url, e.score, e.achieved_at
    from public.game_leaderboard_entries e
    where e.game_city = p_city and e.game = p_game and e.difficulty = p_difficulty
  )
  select ranked.rank, ranked.display_name, ranked.avatar_path, ranked.avatar_url, ranked.score, ranked.achieved_at, ranked.user_id = auth.uid()
  from ranked
  where ranked.rank <= 5 or ranked.user_id = auth.uid()
  order by ranked.rank, ranked.achieved_at asc;
$$;
grant execute on function public.start_game_run(text, text, text) to authenticated;
grant execute on function public.finish_game_run(uuid, integer) to authenticated;
grant execute on function public.get_game_leaderboard(text, text, text) to anon, authenticated;
grant execute on function public.current_game_profile() to authenticated;
grant execute on function public.update_game_profile(text, text) to authenticated;

-- WeChat public-account identity.  These tables deliberately have no client
-- policies: the EdgeOne function uses service_role for message handling, while
-- the one completion RPC below derives the user only from auth.uid().
create table if not exists public.wechat_bindings (
  openid text primary key check (char_length(openid) between 1 and 128),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  bound_at timestamptz not null default now()
);
create table if not exists public.wechat_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  openid text not null check (char_length(openid) between 1 and 128),
  purpose text not null check (purpose in ('register','bind','login')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wechat_link_tokens_openid_idx on public.wechat_link_tokens (openid, expires_at desc);
create table if not exists public.wechat_inbound_events (
  event_key text primary key check (char_length(event_key) between 5 and 160),
  received_at timestamptz not null default now()
);
create table if not exists public.wechat_web_logins (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  user_id uuid references auth.users(id) on delete cascade,
  approved_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
-- A registration link carries only server-verified, short-lived metadata.
-- It lets a first-time scanner set an account name and password in WeChat,
-- then authorizes the browser QR session that created it.
alter table public.wechat_link_tokens add column if not exists scene_hash text check (scene_hash is null or scene_hash ~ '^[0-9a-f]{64}$');
alter table public.wechat_link_tokens add column if not exists nickname text;
alter table public.wechat_link_tokens add column if not exists avatar_url text;
alter table public.wechat_bindings enable row level security;
alter table public.wechat_link_tokens enable row level security;
alter table public.wechat_inbound_events enable row level security;
alter table public.wechat_web_logins enable row level security;

create or replace function public.claim_wechat_inbound(p_event_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.wechat_inbound_events(event_key) values (p_event_key);
  return true;
exception when unique_violation then return false;
end;
$$;

create or replace function public.create_wechat_link_token(p_openid text, p_purpose text, p_token_hash text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_openid is null or char_length(p_openid) not between 1 and 128 or p_purpose not in ('register','bind','login') or p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at > now() + interval '16 minutes' or p_expires_at <= now() then
    raise exception 'invalid WeChat link token';
  end if;
  if p_purpose = 'login' and not exists (select 1 from public.wechat_bindings where openid = p_openid) then raise exception 'unbound WeChat account'; end if;
  delete from public.wechat_link_tokens where openid = p_openid and purpose = p_purpose and used_at is null;
  insert into public.wechat_link_tokens(token_hash, openid, purpose, expires_at) values (p_token_hash, p_openid, p_purpose, p_expires_at);
end;
$$;

create or replace function public.complete_wechat_link_token(p_token_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare row public.wechat_link_tokens;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select * into row from public.wechat_link_tokens where token_hash = p_token_hash and used_at is null and expires_at > now() for update;
  if not found or row.purpose not in ('register','bind') then raise exception '注册链接无效或已过期'; end if;
  insert into public.wechat_bindings(openid, user_id) values (row.openid, auth.uid());
  update public.wechat_link_tokens set used_at = now() where id = row.id;
  return true;
end;
$$;

create or replace function public.consume_wechat_login_token(p_token_hash text)
returns table(user_id uuid) language plpgsql security definer set search_path = public as $$
declare row public.wechat_link_tokens;
begin
  select * into row from public.wechat_link_tokens where token_hash = p_token_hash and purpose = 'login' and used_at is null and expires_at > now() for update;
  if not found then return; end if;
  update public.wechat_link_tokens set used_at = now() where id = row.id;
  return query select b.user_id from public.wechat_bindings b where b.openid = row.openid;
end;
$$;

create or replace function public.create_wechat_web_login(p_code_hash text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() or p_expires_at > now() + interval '6 minutes' then raise exception 'invalid web login'; end if;
  delete from public.wechat_web_logins where expires_at <= now() or used_at is not null;
  insert into public.wechat_web_logins(code_hash, expires_at) values (p_code_hash, p_expires_at);
end;
$$;

create or replace function public.approve_wechat_web_login(p_code_hash text, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.wechat_web_logins set user_id = p_user_id, approved_at = now() where code_hash = p_code_hash and expires_at > now() and approved_at is null and used_at is null;
  return found;
end;
$$;

create or replace function public.consume_wechat_web_login(p_code_hash text)
returns table(user_id uuid) language plpgsql security definer set search_path = public as $$
begin
  update public.wechat_web_logins set used_at = now() where code_hash = p_code_hash and expires_at > now() and approved_at is not null and used_at is null returning wechat_web_logins.user_id into user_id;
  if user_id is not null then return next; end if;
end;
$$;

revoke all on function public.claim_wechat_inbound(text) from public, anon, authenticated;
revoke all on function public.create_wechat_link_token(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_wechat_login_token(text) from public, anon, authenticated;
revoke all on function public.complete_wechat_link_token(text) from public, anon;
revoke all on function public.create_wechat_web_login(text, timestamptz) from public, anon, authenticated;
revoke all on function public.approve_wechat_web_login(text, uuid) from public, anon, authenticated;
revoke all on function public.consume_wechat_web_login(text) from public, anon, authenticated;
grant execute on function public.claim_wechat_inbound(text) to service_role;
grant execute on function public.create_wechat_link_token(text, text, text, timestamptz) to service_role;
grant execute on function public.consume_wechat_login_token(text) to service_role;
grant execute on function public.complete_wechat_link_token(text) to authenticated, service_role;
grant execute on function public.create_wechat_web_login(text, timestamptz) to service_role;
grant execute on function public.approve_wechat_web_login(text, uuid) to service_role;
grant execute on function public.consume_wechat_web_login(text) to service_role;
