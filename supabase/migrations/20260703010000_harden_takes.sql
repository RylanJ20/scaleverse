-- Harden takes per adversarial review: route ALL writes through a SECURITY
-- DEFINER RPC so the "current Matchup of the Day only" gate, created_at, and
-- length are enforced at the trust boundary — not just in the server action.
-- Closes: direct-PostgREST posting on arbitrary matchups, created_at spoofing,
-- and the UTC-vs-DB-timezone skew (both sides now use current_date).

create or replace function public.post_take(p_matchup_id uuid, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(p_body);
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 140 then
    raise exception 'takes are 1-140 characters' using errcode = 'P0007';
  end if;
  -- single moderated surface: only today's featured matchup. current_date is the
  -- same clock get_daily_matchup uses, so there is no timezone skew.
  if not exists (
    select 1 from public.daily_matchups d
    where d.matchup_id = p_matchup_id and d.feature_date = current_date
  ) then
    raise exception 'takes are closed for this matchup' using errcode = 'P0008';
  end if;

  insert into public.takes (matchup_id, user_id, body)
    values (p_matchup_id, v_uid, v_body)
  on conflict (matchup_id, user_id)
    do update set body = excluded.body, updated_at = now();
end;
$$;

-- clients can no longer write takes directly; the RPC is the only write path
revoke insert, update on public.takes from anon, authenticated;
revoke execute on function public.post_take(uuid, text) from public, anon;
grant execute on function public.post_take(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_profile: exclude exact ties from the "with the crowd" average so tie
-- handling isn't silently biased by canonical UUID ordering.
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
           when (v.winner_form_id = m.form_a_id and m.a_wins * 2 > m.vote_count)
             or (v.winner_form_id = m.form_b_id and m.a_wins * 2 < m.vote_count)
           then 1.0 else 0.0 end)
    into v_votes, v_agree
    from public.votes v
    join public.matchups m on m.id = v.matchup_id
    where v.user_id = v_uid and m.vote_count >= 5
      and m.a_wins * 2 <> m.vote_count;  -- exclude exact ties (no crowd consensus)

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
