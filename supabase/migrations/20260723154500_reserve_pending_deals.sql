-- Re-serve pending deals: entering the arena returns your open (undecided)
-- deals first and only deals fresh matchups for the remainder. Fixes the
-- reload leak where every arena visit dealt 10 fresh matchups and abandoned
-- the previous batch as pending until the 40-pending cap hard-errored every
-- page load (P0009 → 500). Caps now degrade — a capped user still gets their
-- pending hand back and votes it down — instead of raising.
-- Spoiler invariant: pending deals that violate the user's *current* gate
-- (arc lowered after dealing) or reference deactivated forms are expired,
-- never re-served.

-- servability of one form under a spoiler gate (internal helper)
create or replace function public.form_servable(p_form_id uuid, p_max_arc_position integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select f.is_active
     and (p_max_arc_position is null or c.debut_arc_id is null
          or da.position <= p_max_arc_position)
     and (p_max_arc_position is null or f.reveal_arc_id is null
          or ra.position <= p_max_arc_position)
  from public.forms f
  join public.characters c on c.id = f.character_id
  left join public.arcs da on da.id = c.debut_arc_id
  left join public.arcs ra on ra.id = f.reveal_arc_id
  where f.id = p_form_id;
$$;

revoke execute on function public.form_servable(uuid, integer) from public, anon, authenticated;
grant execute on function public.form_servable(uuid, integer) to service_role;

create or replace function public.deal_matchups(
  p_series_slug text default 'one-piece',
  p_count integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_series_id uuid;
  v_max_pos integer;
  v_caught_up boolean;
  v_pending integer;
  v_dealt_hour integer;
  v_reserved jsonb;
  v_reserved_count integer;
  v_remainder integer;
  v_fresh jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  p_count := least(greatest(p_count, 1), 20);

  select id into v_series_id from public.series where slug = p_series_slug;
  if v_series_id is null then
    raise exception 'unknown series %', p_series_slug;
  end if;

  -- housekeeping: expire this user's stale pending deals
  update public.deals set outcome = 'expired', decided_at = now()
    where user_id = v_uid and outcome = 'pending'
      and dealt_at < now() - interval '2 hours';

  -- current spoiler gate
  select coalesce(a.position, null), usp.caught_up
    into v_max_pos, v_caught_up
    from public.user_series_progress usp
    left join public.arcs a on a.id = usp.last_arc_id
    where usp.user_id = v_uid and usp.series_id = v_series_id;
  if v_caught_up is not false then
    v_max_pos := null;
  end if;

  -- pending deals no longer servable under the current gate are dead, not held
  update public.deals d set outcome = 'expired', decided_at = now()
    from public.matchups m
    where m.id = d.matchup_id
      and d.user_id = v_uid and d.outcome = 'pending'
      and m.series_id = v_series_id
      and not (public.form_servable(m.form_a_id, v_max_pos)
               and public.form_servable(m.form_b_id, v_max_pos));

  -- re-serve the open hand, oldest first
  select coalesce(jsonb_agg(item order by dealt_at), '[]'::jsonb), count(*)
    into v_reserved, v_reserved_count
  from (
    select d.dealt_at, jsonb_build_object(
      'deal_id', d.id,
      'matchup_id', m.id,
      'vote_count', m.vote_count,
      'a_wins', m.a_wins,
      'a', public.form_card(m.form_a_id),
      'b', public.form_card(m.form_b_id)
    ) as item
    from public.deals d
    join public.matchups m on m.id = d.matchup_id
    where d.user_id = v_uid and d.outcome = 'pending'
      and m.series_id = v_series_id
    order by d.dealt_at
    limit p_count
  ) s;

  v_remainder := p_count - v_reserved_count;

  if v_remainder > 0 then
    -- dealing throttles (review: dealing must not be free) — but degrade to
    -- serving only the re-served hand; never raise out of the arena
    select count(*) into v_pending from public.deals
      where user_id = v_uid and outcome = 'pending';
    select count(*) into v_dealt_hour from public.deals
      where user_id = v_uid and dealt_at > now() - interval '1 hour';

    if v_pending < 40 and v_dealt_hour < 400 then
      create temp table _deal_pairs on commit drop as
        select * from public.sample_pairs(p_series_slug, v_max_pos, v_remainder, v_uid);

      -- ordered + do-nothing: no deadlocks between concurrent dealers, no dead tuples
      insert into public.matchups (series_id, form_a_id, form_b_id)
        select v_series_id, fa, fb from (
          select form_a_id as fa, form_b_id as fb from _deal_pairs order by 1, 2
        ) p
      on conflict (form_a_id, form_b_id) do nothing;

      with ids as (
        select m.id, m.form_a_id, m.form_b_id, m.vote_count, m.a_wins
        from public.matchups m
        join _deal_pairs p on p.form_a_id = m.form_a_id and p.form_b_id = m.form_b_id
      ),
      dealt as (
        insert into public.deals (user_id, matchup_id)
        select v_uid, id from ids
        returning id as deal_id, matchup_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'deal_id', d.deal_id,
        'matchup_id', i.id,
        'vote_count', i.vote_count,
        'a_wins', i.a_wins,
        'a', public.form_card(i.form_a_id),
        'b', public.form_card(i.form_b_id)
      )), '[]'::jsonb)
      into v_fresh
      from dealt d join ids i on i.id = d.matchup_id;
    end if;
  end if;

  return v_reserved || v_fresh;
end;
$$;
