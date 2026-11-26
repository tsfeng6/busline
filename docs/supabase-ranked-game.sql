-- Apply after supabase-game-auth.sql. Run as the project database owner.
begin;

revoke execute on function public.start_game_run(text,text,text) from public, anon, authenticated;
revoke execute on function public.finish_game_run(uuid,integer) from public, anon, authenticated;

create table if not exists public.ranked_game_state (
  run_id uuid primary key references public.game_runs(id) on delete cascade,
  question jsonb,
  question_id uuid,
  number integer not null default 0,
  deadline timestamptz,
  remaining_ms integer not null,
  score integer not null default 0,
  hints integer not null default 0,
  hints_on_question integer not null default 0,
  previous_answer text not null default '',
  last_result jsonb,
  touched_at timestamptz not null default now()
);
alter table public.ranked_game_state add column if not exists touched_at timestamptz not null default now();
create index if not exists ranked_game_state_touched_idx on public.ranked_game_state(touched_at);
alter table public.ranked_game_state enable row level security;
revoke all on public.ranked_game_state from public, anon, authenticated;

create or replace function public.ranked_game_action(p_user uuid, p_action text, p_run uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run_row public.game_runs;
  state public.ranked_game_state;
  tick timestamptz;
  ms integer;
  expired boolean;
  correct boolean;
  finished boolean;
  result jsonb;
  next_number integer;
  profile public.game_profiles;
begin
  if p_user is null then raise exception '请先登录'; end if;
  if p_action = 'start' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user::text));
    -- Keep settled and abandoned answer snapshots only for the retry window.
    -- Scores and leaderboard entries live in separate tables.
    delete from public.ranked_game_state where run_id in (
      select run_id from public.ranked_game_state
      where touched_at < now() - interval '8 hours' order by touched_at limit 100 for update skip locked
    );
    delete from public.game_runs where user_id = p_user and finished_at is null and started_at < now() - interval '15 minutes';
    if exists (select 1 from public.game_runs where user_id = p_user and started_at > now() - interval '3 seconds') then
      raise exception '请勿重复开始挑战';
    end if;
    insert into public.game_runs(user_id, game, difficulty, game_city)
    values (p_user, p_input->>'game', p_input->>'difficulty', p_input->>'scope') returning * into run_row;
    insert into public.ranked_game_state(run_id, remaining_ms)
    values (run_row.id, case when run_row.game in ('city','county') then 180000 when run_row.difficulty='hell' then 90000 else 120000 end);
    return jsonb_build_object('id', run_row.id, 'game', run_row.game, 'difficulty', run_row.difficulty,
      'scope', run_row.game_city, 'startedAt', run_row.started_at);
  end if;

  select * into run_row from public.game_runs where id = p_run and user_id = p_user for update;
  if not found then raise exception '挑战不存在'; end if;
  select * into state from public.ranked_game_state where run_id = p_run for update;
  if not found or now() - run_row.started_at > interval '8 hours' then raise exception '挑战已过期'; end if;
  tick := clock_timestamp();

  if p_action = 'read' then
    return jsonb_build_object('game', run_row.game, 'difficulty', run_row.difficulty, 'scope', run_row.game_city,
      'number', state.number, 'id', state.question_id, 'question', state.question, 'previousAnswer', state.previous_answer,
      'remainingMs', greatest(0, coalesce(floor(extract(epoch from state.deadline - tick) * 1000)::integer, state.remaining_ms)),
      'hints', state.hints, 'hintsOnQuestion', state.hints_on_question, 'finished', run_row.finished_at is not null);
  end if;
  if p_action = 'answer' and state.last_result->>'id' = p_input->>'id' then return state.last_result; end if;
  if run_row.finished_at is not null then raise exception '挑战已结算'; end if;

  if p_action = 'issue' then
    next_number := (p_input->>'number')::integer;
    if state.question is not null and state.number = next_number then
      return public.ranked_game_action(p_user, 'read', p_run, '{}'::jsonb);
    end if;
    if state.question is not null or next_number <> state.number + 1 then raise exception '题目顺序无效'; end if;
    ms := case when run_row.game in ('city','county') then state.remaining_ms when run_row.difficulty='hell' then 90000 else 120000 end;
    if ms <= 0 then raise exception '挑战已超时'; end if;
    update public.ranked_game_state set question = p_input->'question', question_id = gen_random_uuid(),
      number = next_number, hints_on_question = 0, deadline = tick + ms * interval '1 millisecond', touched_at = tick
    where run_id = p_run;
    return public.ranked_game_action(p_user, 'read', p_run, '{}'::jsonb);
  end if;

  if state.question is null or state.question_id::text is distinct from p_input->>'id' then raise exception '题目已失效'; end if;
  expired := tick >= state.deadline;
  if p_action = 'hint' then
    if expired then raise exception '题目已超时'; end if;
    next_number := (p_input->>'step')::integer;
    if next_number = state.hints_on_question + 1 and state.hints < 7 then
      update public.ranked_game_state set hints = hints + 1, hints_on_question = hints_on_question + 1 where run_id = p_run;
    elsif next_number <> state.hints_on_question then
      raise exception '提示次数无效';
    end if;
    return public.ranked_game_action(p_user, 'read', p_run, '{}'::jsonb);
  end if;

  if p_action <> 'answer' then raise exception '未知操作'; end if;
  if coalesce((p_input->>'timeout')::boolean, false) and not expired then
    return jsonb_build_object('pendingMs', greatest(1, ceil(extract(epoch from state.deadline - tick) * 1000)::integer));
  end if;
  correct := not expired and coalesce((p_input->>'correct')::boolean, false);
  ms := greatest(0, floor(extract(epoch from state.deadline - tick) * 1000)::integer);
  state.score := state.score + case when correct then 1 else 0 end;
  finished := not correct or (run_row.game = 'city' and state.number >= 10) or state.score >= 2000;
  result := jsonb_build_object('id', state.question_id, 'number', state.number, 'question', state.question,
    'answer', case when expired then '' else p_input->>'answer' end, 'correct', correct,
    'timedOut', expired, 'score', state.score, 'finished', finished);
  update public.ranked_game_state set score = state.score, last_result = result,
    previous_answer = state.question->>'correctAnswer', remaining_ms = ms, question = null, deadline = null, touched_at = tick
  where run_id = p_run;

  if finished then
    update public.game_runs set score = state.score, finished_at = tick where id = p_run;
    insert into public.game_leaderboards(game_city, game, difficulty)
    values(run_row.game_city, run_row.game, run_row.difficulty)
    on conflict(game_city, game, difficulty) do update set updated_at = tick;
    select * into profile from public.game_profiles where id = p_user;
    insert into public.game_leaderboard_entries(game_city, game, difficulty, user_id, display_name, avatar_path, avatar_url, score, achieved_at)
    values (run_row.game_city, run_row.game, run_row.difficulty, p_user, coalesce(profile.display_name,'巴士玩家'),
      profile.avatar_path, profile.avatar_url, state.score, tick)
    on conflict(game_city, game, difficulty, user_id) do update
    set display_name = excluded.display_name, avatar_path = excluded.avatar_path, avatar_url = excluded.avatar_url,
      score = excluded.score, achieved_at = excluded.achieved_at
    where excluded.score > game_leaderboard_entries.score;
  end if;
  return result;
end;
$$;
revoke all on function public.ranked_game_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ranked_game_action(uuid,text,uuid,jsonb) to service_role;

commit;
