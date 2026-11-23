-- Run in Supabase SQL Editor. This creates only the initial game-account and
-- leaderboard data; it does not touch Busline's city publication tables.
create extension if not exists pgcrypto;

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
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
-- No direct table policies: clients can use only the narrowly scoped RPCs below.

create or replace function public.set_game_profile_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.game_profiles (id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data->>'display_name', 24), ''), '巴士玩家'))
  on conflict (id) do nothing;
  return new;
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
returns table (rank bigint, display_name text, score integer, achieved_at timestamptz, is_current_user boolean) language sql security definer set search_path = public as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.score, r.finished_at
    from public.game_runs r where r.game = p_game and r.difficulty = p_difficulty and r.finished_at is not null
    order by r.user_id, r.score desc, r.finished_at asc
  ), ranked as (
    select dense_rank() over (order by score desc) as rank, user_id, score, finished_at from best
  )
  select ranked.rank, coalesce(p.display_name, '巴士玩家'), ranked.score, ranked.finished_at, ranked.user_id = auth.uid()
  from ranked left join public.game_profiles p on p.id = ranked.user_id
  order by ranked.rank, ranked.finished_at asc limit 50;
$$;
grant execute on function public.start_game_run(text, text) to authenticated;
grant execute on function public.finish_game_run(uuid, integer) to authenticated;
grant execute on function public.get_game_leaderboard(text, text) to anon, authenticated;
