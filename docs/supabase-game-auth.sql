-- Run in Supabase SQL Editor. This creates only the initial game-account and
-- leaderboard data; it does not touch Busline's city publication tables.
create extension if not exists pgcrypto;

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar\.(webp|jpeg)$'),
  created_at timestamptz not null default now()
);
create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('line','station','city','county')),
  difficulty text not null check (difficulty in ('easy','hell','hard')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer,
  check ((game in ('line','station') and difficulty in ('easy','hell')) or (game in ('city','county') and difficulty = 'hard')),
  check (score is null or score between 0 and 2000)
);
create index if not exists game_runs_board_idx on public.game_runs (game, difficulty, score desc, finished_at asc) where finished_at is not null;

alter table public.game_profiles enable row level security;
alter table public.game_runs enable row level security;
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

create or replace function public.current_game_profile()
returns table (display_name text, avatar_path text) language sql security definer set search_path = public as $$
  select p.display_name, p.avatar_path from public.game_profiles p where p.id = auth.uid();
$$;

create or replace function public.update_game_profile(p_display_name text, p_avatar_path text default null)
returns table (display_name text, avatar_path text) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if char_length(trim(p_display_name)) not between 2 and 24 then raise exception '昵称须为 2–24 个字'; end if;
  if p_avatar_path is not null and p_avatar_path !~ ('^' || auth.uid()::text || '/avatar\.(webp|jpeg)$') then raise exception '头像路径无效'; end if;
  insert into public.game_profiles (id, display_name, avatar_path) values (auth.uid(), trim(p_display_name), p_avatar_path)
  on conflict (id) do update set display_name = excluded.display_name, avatar_path = coalesce(excluded.avatar_path, public.game_profiles.avatar_path);
  return query select p.display_name, p.avatar_path from public.game_profiles p where p.id = auth.uid();
end;
$$;
drop trigger if exists on_auth_user_game_profile on auth.users;
create trigger on_auth_user_game_profile after insert on auth.users
for each row execute procedure public.set_game_profile_name();

create or replace function public.start_game_run(p_game text, p_difficulty text)
returns public.game_runs language plpgsql security definer set search_path = public as $$
declare result public.game_runs;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if not ((p_game in ('line','station') and p_difficulty in ('easy','hell')) or (p_game in ('city','county') and p_difficulty = 'hard')) then
    raise exception '不存在这个游戏榜单';
  end if;
  -- A short per-user cooldown makes scripted run creation less useful.
  if exists (select 1 from public.game_runs where user_id = auth.uid() and started_at > now() - interval '3 seconds') then
    raise exception '请勿重复开始挑战';
  end if;
  insert into public.game_runs (user_id, game, difficulty) values (auth.uid(), p_game, p_difficulty) returning * into result;
  return result;
end;
$$;

create or replace function public.finish_game_run(p_run_id uuid, p_score integer)
returns table (accepted boolean, best_score integer, rank bigint) language plpgsql security definer set search_path = public as $$
declare run_row public.game_runs; elapsed_seconds integer; pace_cap integer;
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
  return query
  select true, coalesce(max(r.score), 0)::integer,
    (select count(*) + 1 from (select distinct on (user_id) user_id, score, finished_at from public.game_runs where game = run_row.game and difficulty = run_row.difficulty and finished_at is not null order by user_id, score desc, finished_at asc) board where board.score > p_score or (board.score = p_score and board.finished_at < now()))
  from public.game_runs r where r.user_id = auth.uid() and r.game = run_row.game and r.difficulty = run_row.difficulty and r.finished_at is not null;
end;
$$;

create or replace function public.get_game_leaderboard(p_game text, p_difficulty text)
returns table (rank bigint, display_name text, avatar_path text, score integer, achieved_at timestamptz, is_current_user boolean) language sql security definer set search_path = public as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.score, r.finished_at
    from public.game_runs r where r.game = p_game and r.difficulty = p_difficulty and r.finished_at is not null
    order by r.user_id, r.score desc, r.finished_at asc
  ), ranked as (
    select dense_rank() over (order by score desc) as rank, user_id, score, finished_at from best
  )
  select ranked.rank, coalesce(p.display_name, '巴士玩家'), p.avatar_path, ranked.score, ranked.finished_at, ranked.user_id = auth.uid()
  from ranked left join public.game_profiles p on p.id = ranked.user_id
  order by ranked.rank, ranked.finished_at asc limit 50;
$$;
grant execute on function public.start_game_run(text, text) to authenticated;
grant execute on function public.finish_game_run(uuid, integer) to authenticated;
grant execute on function public.get_game_leaderboard(text, text) to anon, authenticated;
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
alter table public.wechat_bindings enable row level security;
alter table public.wechat_link_tokens enable row level security;
alter table public.wechat_inbound_events enable row level security;

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

revoke all on function public.claim_wechat_inbound(text) from public, anon, authenticated;
revoke all on function public.create_wechat_link_token(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_wechat_login_token(text) from public, anon, authenticated;
revoke all on function public.complete_wechat_link_token(text) from public, anon;
grant execute on function public.claim_wechat_inbound(text) to service_role;
grant execute on function public.create_wechat_link_token(text, text, text, timestamptz) to service_role;
grant execute on function public.consume_wechat_login_token(text) to service_role;
grant execute on function public.complete_wechat_link_token(text) to authenticated, service_role;
