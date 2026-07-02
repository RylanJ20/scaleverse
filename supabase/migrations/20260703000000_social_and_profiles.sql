-- Matchup of the Day + takes (the single MVP social surface, ratified #15) and
-- profile stats. Takes are UGC: escaped on render (React), length-capped in the
-- DB, one editable post per user per matchup, and mod-hideable.

-- ---------------------------------------------------------------------------
-- Matchup of the Day: one featured matchup per series per calendar day.
-- Selected server-side (service role) and persisted, so anon page views never
-- trigger a client-driven write.
-- ---------------------------------------------------------------------------

create table public.daily_matchups (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  matchup_id uuid not null references public.matchups (id) on delete cascade,
  feature_date date not null,
  created_at timestamptz not null default now(),
  unique (series_id, feature_date)
);

alter table public.daily_matchups enable row level security;
create policy "daily matchups are public" on public.daily_matchups for select using (true);

-- ---------------------------------------------------------------------------
-- Takes: short opinions on a matchup. One per user per matchup (editable).
-- ---------------------------------------------------------------------------

create table public.takes (
  id uuid primary key default gen_random_uuid(),
  matchup_id uuid not null references public.matchups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 140),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matchup_id, user_id)
);

create index takes_matchup_idx on public.takes (matchup_id, created_at desc);
create index takes_user_idx on public.takes (user_id);

alter table public.takes enable row level security;
-- everyone reads non-hidden takes; authors can always see their own
create policy "visible takes are public" on public.takes
  for select using (not hidden or (select auth.uid()) = user_id);
create policy "users post own takes" on public.takes
  for insert with check ((select auth.uid()) = user_id and not hidden);
create policy "users edit own takes" on public.takes
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and not hidden);

-- authors can't self-hide/unhide or touch others'; hidden is mod-only.
-- (mods act via service role until a mod UI exists.)
revoke update on public.takes from anon, authenticated;
grant update (body, updated_at) on public.takes to authenticated;

-- ---------------------------------------------------------------------------
-- get_daily_matchup: ensure + return today's featured matchup with cards.
-- Service-role only (called from a server component via the admin client).
-- ---------------------------------------------------------------------------

create or replace function public.get_daily_matchup(p_series_slug text default 'one-piece')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
  v_matchup_id uuid;
  v_fa uuid;
  v_fb uuid;
  v_result jsonb;
begin
  select id into v_series_id from public.series where slug = p_series_slug;
  if v_series_id is null then
    raise exception 'unknown series %', p_series_slug;
  end if;

  select dm.matchup_id into v_matchup_id
    from public.daily_matchups dm
    where dm.series_id = v_series_id and dm.feature_date = current_date;

  if v_matchup_id is null then
    -- pick a competitive pairing among notable active forms
    select least(e1.form_id, e2.form_id), greatest(e1.form_id, e2.form_id)
      into v_fa, v_fb
      from (
        select f.id as form_id, f.character_id, r.display_rating
        from public.forms f
        join public.characters c on c.id = f.character_id and c.series_id = v_series_id
        join public.ratings r on r.form_id = f.id
        where f.is_active and r.display_rating >= 1150
      ) e1
      join (
        select f.id as form_id, f.character_id, r.display_rating
        from public.forms f
        join public.characters c on c.id = f.character_id and c.series_id = v_series_id
        join public.ratings r on r.form_id = f.id
        where f.is_active and r.display_rating >= 1150
      ) e2
        on e1.form_id < e2.form_id
       and e1.character_id <> e2.character_id
       and abs(e1.display_rating - e2.display_rating) < 60
      order by random()
      limit 1;

    if v_fa is null then
      return null;  -- not enough roster to feature
    end if;

    insert into public.matchups (series_id, form_a_id, form_b_id)
      values (v_series_id, v_fa, v_fb)
    on conflict (form_a_id, form_b_id) do nothing;
    select id into v_matchup_id from public.matchups where form_a_id = v_fa and form_b_id = v_fb;

    insert into public.daily_matchups (series_id, matchup_id, feature_date)
      values (v_series_id, v_matchup_id, current_date)
    on conflict (series_id, feature_date) do nothing;

    -- re-read in case a concurrent caller won the insert race
    select dm.matchup_id into v_matchup_id
      from public.daily_matchups dm
      where dm.series_id = v_series_id and dm.feature_date = current_date;
  end if;

  select m.form_a_id, m.form_b_id into v_fa, v_fb
    from public.matchups m where m.id = v_matchup_id;

  select jsonb_build_object(
    'matchup_id', m.id,
    'vote_count', m.vote_count,
    'a_wins', m.a_wins,
    'a', public.form_card(m.form_a_id),
    'b', public.form_card(m.form_b_id)
  )
  into v_result
  from public.matchups m where m.id = v_matchup_id;

  return v_result;
end;
$$;

revoke execute on function public.get_daily_matchup(text) from public, anon, authenticated;
grant execute on function public.get_daily_matchup(text) to service_role;

-- ---------------------------------------------------------------------------
-- get_profile: public read-only take record for /u/[username].
-- ---------------------------------------------------------------------------

create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_username text;
  v_since timestamptz;
  v_votes integer;
  v_agree numeric;
  v_takes jsonb;
begin
  select id, username, created_at into v_uid, v_username, v_since
    from public.profiles where username = p_username;
  if v_uid is null then
    return null;
  end if;

  select count(*),
         avg(case
           when (v.winner_form_id = m.form_a_id and m.a_wins * 2 >= m.vote_count)
             or (v.winner_form_id = m.form_b_id and m.a_wins * 2 < m.vote_count)
           then 1.0 else 0.0 end)
    into v_votes, v_agree
    from public.votes v
    join public.matchups m on m.id = v.matchup_id
    where v.user_id = v_uid and m.vote_count >= 5;

  -- hottest takes: the user's most contrarian picks (lowest side %)
  select jsonb_agg(t) into v_takes from (
    select jsonb_build_object(
      'matchup_id', m.id,
      'pick', public.form_card(v.winner_form_id),
      'other', public.form_card(case when v.winner_form_id = m.form_a_id then m.form_b_id else m.form_a_id end),
      'your_side_pct', case when v.winner_form_id = m.form_a_id
                            then round(100.0 * m.a_wins / m.vote_count)
                            else round(100.0 * (m.vote_count - m.a_wins) / m.vote_count) end,
      'vote_count', m.vote_count
    ) as t
    from public.votes v
    join public.matchups m on m.id = v.matchup_id
    where v.user_id = v_uid and m.vote_count >= 10
    order by (case when v.winner_form_id = m.form_a_id
                   then m.a_wins::numeric / m.vote_count
                   else (m.vote_count - m.a_wins)::numeric / m.vote_count end) asc
    limit 5
  ) sub;

  return jsonb_build_object(
    'username', v_username,
    'member_since', v_since,
    'total_votes', coalesce((select count(*) from public.votes where user_id = v_uid), 0),
    'scored_votes', coalesce(v_votes, 0),
    'agreement_pct', case when v_votes > 0 then round(v_agree * 100) else null end,
    'hottest_takes', coalesce(v_takes, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_profile(text) to anon, authenticated;
