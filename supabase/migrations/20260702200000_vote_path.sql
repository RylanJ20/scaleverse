-- Vote path: deals, matchup dealing, cast_vote / change_vote RPCs.
-- Ratified: server-dealt matchups; only signed-in votes count; revotes allowed
-- (max 1 change per matchup per rolling week); 30-day no-re-serve; rate limits
-- 20/min, 500/hr, 1500/day; 1.5s min spacing; spoiler gating applied at deal time.
-- Hardened per adversarial review: per-user advisory lock serializes all rate
-- checks; dealing is capped; demo dealing is server-only; inserts are ordered.

-- seed priors live alongside ratings so refits can anchor to them (θ ~ N(seed, 1))
alter table public.ratings add column if not exists seed_theta double precision not null default 0;
update public.ratings set seed_theta = theta where seed_theta = 0;

-- rate-limit and revote lookups
create index if not exists vote_events_user_created_idx
  on public.vote_events (user_id, created_at desc);
create index if not exists vote_events_user_matchup_idx
  on public.vote_events (user_id, matchup_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Deals: server-dealt matchups (the only path to a first countable vote)
-- ---------------------------------------------------------------------------

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  matchup_id uuid not null references public.matchups (id) on delete cascade,
  dealt_at timestamptz not null default now(),
  outcome text not null default 'pending' check (outcome in ('pending', 'voted', 'skipped', 'expired')),
  decided_at timestamptz
);

create index deals_user_dealt_idx on public.deals (user_id, dealt_at desc);
create index deals_matchup_idx on public.deals (matchup_id);
create index deals_user_pending_idx on public.deals (user_id) where outcome = 'pending';

alter table public.deals enable row level security;
create policy "users read own deals" on public.deals
  for select using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- vote_guard: per-user serialization + pacing + rate limits.
-- The advisory xact lock forces concurrent votes from one user to queue, so
-- every count below sees the prior call's committed events (review blocker #1).
-- Internal helper — not client-callable.
-- ---------------------------------------------------------------------------

create or replace function public.vote_guard(p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('sv-vote:' || p_uid::text, 42));

  if exists (
    select 1 from public.vote_events
    where user_id = p_uid and created_at > now() - interval '1.5 seconds'
  ) then
    raise exception 'voting too fast' using errcode = 'P0005';
  end if;

  if (select count(*) from public.vote_events
      where user_id = p_uid and created_at > now() - interval '1 minute') >= 20
     or (select count(*) from public.vote_events
      where user_id = p_uid and created_at > now() - interval '1 hour') >= 500
     or (select count(*) from public.vote_events
      where user_id = p_uid and created_at > now() - interval '1 day') >= 1500
  then
    raise exception 'rate limit exceeded' using errcode = 'P0006';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- revote_blocked: ratified rule — max one CHANGE per matchup per rolling week.
-- The initial vote (min event id) never counts against the window; any later
-- change event inside 7 days blocks another change (review should-fix).
-- ---------------------------------------------------------------------------

create or replace function public.revote_blocked(p_uid uuid, p_matchup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vote_events ve
    where ve.user_id = p_uid
      and ve.matchup_id = p_matchup_id
      and ve.created_at > now() - interval '7 days'
      and ve.id <> (
        select min(id) from public.vote_events
        where user_id = p_uid and matchup_id = p_matchup_id
      )
  );
$$;

-- card payload for one side of a matchup
create or replace function public.form_card(p_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'form_id', f.id,
    'form_slug', f.slug,
    'form_name', f.name,
    'character_slug', c.slug,
    'character_name', c.name,
    'epithet', c.epithet,
    'image_path', f.image_path,
    'display_rating', r.display_rating,
    'tier', r.tier
  )
  from public.forms f
  join public.characters c on c.id = f.character_id
  left join public.ratings r on r.form_id = f.id
  where f.id = p_form_id;
$$;

-- ---------------------------------------------------------------------------
-- Matchup selection: eligibility + pair sampling.
-- p_max_arc_position: spoiler gate (null = caught up / everything).
-- Mix (ratified): ~70% competitive (gap < 175), ~20% coverage (low votes),
-- remainder wildcard; deduped with random top-up so the hand is always full.
-- vote exposure comes from matchups tallies, never a vote_events scan.
-- ---------------------------------------------------------------------------

create or replace function public.sample_pairs(
  p_series_slug text,
  p_max_arc_position integer,
  p_count integer,
  p_exclude_user uuid
)
returns table (form_a_id uuid, form_b_id uuid, bucket text)
language sql
stable
security definer
set search_path = ''
as $$
  with gate as (
    select a.id, a.position from public.arcs a
    join public.series s on s.id = a.series_id
    where s.slug = p_series_slug
  ),
  eligible as (
    select f.id as form_id, f.character_id,
           coalesce(r.display_rating, 1000) as display_rating,
           coalesce(mv.cnt, 0) as votes_seen
    from public.forms f
    join public.characters c on c.id = f.character_id
    join public.series s on s.id = c.series_id and s.slug = p_series_slug
    left join public.ratings r on r.form_id = f.id
    left join lateral (
      select sum(m.vote_count) as cnt from public.matchups m
      where m.form_a_id = f.id or m.form_b_id = f.id
    ) mv on true
    where f.is_active
      and (p_max_arc_position is null or c.debut_arc_id is null
           or (select position from gate where id = c.debut_arc_id) <= p_max_arc_position)
      and (p_max_arc_position is null or f.reveal_arc_id is null
           or (select position from gate where id = f.reveal_arc_id) <= p_max_arc_position)
  ),
  cand as (
    select least(e1.form_id, e2.form_id) as fa,
           greatest(e1.form_id, e2.form_id) as fb,
           abs(e1.display_rating - e2.display_rating) as gap,
           (e1.votes_seen + e2.votes_seen) as pair_votes
    from eligible e1
    join eligible e2
      on e1.form_id < e2.form_id
     and e1.character_id <> e2.character_id
    where random() < 0.06
  ),
  fresh as (
    select c.* from cand c
    left join public.matchups m on m.form_a_id = c.fa and m.form_b_id = c.fb
    where p_exclude_user is null or (
      not exists (
        select 1 from public.deals d
        where d.matchup_id = m.id and d.user_id = p_exclude_user
          and d.dealt_at > now() - interval '30 days'
      )
      and not exists (
        select 1 from public.votes v
        where v.matchup_id = m.id and v.user_id = p_exclude_user
          and v.updated_at > now() - interval '30 days'
      )
    )
  ),
  competitive as (
    select fa, fb, 'competitive'::text as bucket from fresh
    where gap < 175 order by random() limit greatest(1, (p_count * 7) / 10)
  ),
  coverage as (
    select fa, fb, 'coverage'::text from fresh
    order by pair_votes asc, random() limit greatest(1, (p_count * 2) / 10)
  ),
  wildcard as (
    select fa, fb, 'wildcard'::text from fresh
    order by random()
    limit greatest(1, p_count - (p_count * 7) / 10 - (p_count * 2) / 10)
  ),
  merged as (
    select distinct on (fa, fb) fa, fb, bucket, 0 as priority
    from (
      select * from competitive
      union all select * from coverage
      union all select * from wildcard
    ) u
  ),
  topup as (
    select f.fa, f.fb, 'topup'::text as bucket, 1 as priority
    from (select distinct fa, fb from fresh) f
    where not exists (select 1 from merged m where m.fa = f.fa and m.fb = f.fb)
    order by random()
    limit p_count
  )
  select fa, fb, bucket
  from (select * from merged union all select * from topup) final
  order by priority, random()
  limit p_count;
$$;

-- ---------------------------------------------------------------------------
-- deal_matchups: authed users get real deals (rows in `deals`)
-- ---------------------------------------------------------------------------

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
  v_result jsonb;
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

  -- dealing throttles (review: dealing must not be free)
  select count(*) into v_pending from public.deals
    where user_id = v_uid and outcome = 'pending';
  if v_pending >= 40 then
    raise exception 'too many pending matchups — vote or skip some first' using errcode = 'P0009';
  end if;
  select count(*) into v_dealt_hour from public.deals
    where user_id = v_uid and dealt_at > now() - interval '1 hour';
  if v_dealt_hour >= 400 then
    raise exception 'dealing rate limit exceeded' using errcode = 'P0010';
  end if;

  select coalesce(a.position, null), usp.caught_up
    into v_max_pos, v_caught_up
    from public.user_series_progress usp
    left join public.arcs a on a.id = usp.last_arc_id
    where usp.user_id = v_uid and usp.series_id = v_series_id;
  if v_caught_up is not false then
    v_max_pos := null;
  end if;

  create temp table _deal_pairs on commit drop as
    select * from public.sample_pairs(p_series_slug, v_max_pos, p_count, v_uid);

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
  select jsonb_agg(jsonb_build_object(
    'deal_id', d.deal_id,
    'matchup_id', i.id,
    'vote_count', i.vote_count,
    'a_wins', i.a_wins,
    'a', public.form_card(i.form_a_id),
    'b', public.form_card(i.form_b_id)
  ))
  into v_result
  from dealt d join ids i on i.id = d.matchup_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- demo_matchups: display-only serving for anonymous visitors.
-- NOT client-callable (review: anon write path) — the app's server action
-- invokes it with the service role.
-- ---------------------------------------------------------------------------

create or replace function public.demo_matchups(
  p_series_slug text default 'one-piece',
  p_max_arc_position integer default null,
  p_count integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
  v_result jsonb;
begin
  p_count := least(greatest(p_count, 1), 20);
  select id into v_series_id from public.series where slug = p_series_slug;
  if v_series_id is null then
    raise exception 'unknown series %', p_series_slug;
  end if;

  create temp table _demo_pairs on commit drop as
    select * from public.sample_pairs(p_series_slug, p_max_arc_position, p_count, null);

  insert into public.matchups (series_id, form_a_id, form_b_id)
    select v_series_id, fa, fb from (
      select form_a_id as fa, form_b_id as fb from _demo_pairs order by 1, 2
    ) p
  on conflict (form_a_id, form_b_id) do nothing;

  select jsonb_agg(jsonb_build_object(
    'matchup_id', m.id,
    'vote_count', m.vote_count,
    'a_wins', m.a_wins,
    'a', public.form_card(m.form_a_id),
    'b', public.form_card(m.form_b_id)
  ))
  into v_result
  from public.matchups m
  join _demo_pairs p on p.form_a_id = m.form_a_id and p.form_b_id = m.form_b_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- cast_vote: vote on a dealt matchup (first vote, or a change if re-dealt)
-- ---------------------------------------------------------------------------

create or replace function public.cast_vote(p_deal_id uuid, p_winner_form_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deal public.deals%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_deal from public.deals
    where id = p_deal_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  if v_deal.outcome <> 'pending' then
    raise exception 'deal already resolved' using errcode = 'P0003';
  end if;
  if v_deal.dealt_at < now() - interval '2 hours' then
    -- no state write here: the raise would roll it back anyway (review);
    -- stale deals are expired by deal_matchups housekeeping
    raise exception 'deal expired' using errcode = 'P0004';
  end if;

  perform public.vote_guard(v_uid);

  return public.apply_vote(v_uid, v_deal.matchup_id, p_winner_form_id, v_deal.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- change_vote: revote WITHOUT a deal (matchup pages). Makes the ratified
-- revote rule actually reachable — the 30-day no-re-serve applies to the
-- Arena, not to changing your mind on a matchup you already voted.
-- ---------------------------------------------------------------------------

create or replace function public.change_vote(p_matchup_id uuid, p_winner_form_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.votes where matchup_id = p_matchup_id and user_id = v_uid
  ) then
    raise exception 'no existing vote to change' using errcode = 'P0011';
  end if;

  perform public.vote_guard(v_uid);

  return public.apply_vote(v_uid, p_matchup_id, p_winner_form_id, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_vote: shared write logic. Internal helper — not client-callable.
-- Caller must have passed vote_guard.
-- ---------------------------------------------------------------------------

create or replace function public.apply_vote(
  p_uid uuid,
  p_matchup_id uuid,
  p_winner_form_id uuid,
  p_deal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_matchup public.matchups%rowtype;
  v_existing public.votes%rowtype;
  v_changed boolean := false;
  v_no_op boolean := false;
  v_winner_rating integer;
  v_loser_rating integer;
  v_delta integer;
begin
  select * into v_matchup from public.matchups where id = p_matchup_id for update;
  if not found then
    raise exception 'matchup not found' using errcode = 'P0002';
  end if;
  if p_winner_form_id <> v_matchup.form_a_id and p_winner_form_id <> v_matchup.form_b_id then
    raise exception 'winner must be one of the matchup''s forms' using errcode = 'P0007';
  end if;

  select * into v_existing from public.votes
    where matchup_id = v_matchup.id and user_id = p_uid;

  if found then
    if v_existing.winner_form_id = p_winner_form_id then
      v_no_op := true;
    else
      if public.revote_blocked(p_uid, v_matchup.id) then
        raise exception 'revote limit: one change per matchup per week' using errcode = 'P0008';
      end if;
      update public.votes
        set winner_form_id = p_winner_form_id, updated_at = now()
        where matchup_id = v_matchup.id and user_id = p_uid;
      update public.matchups
        set a_wins = a_wins + case when p_winner_form_id = form_a_id then 1 else -1 end
        where id = v_matchup.id;
      insert into public.vote_events (matchup_id, user_id, winner_form_id)
        values (v_matchup.id, p_uid, p_winner_form_id);
      v_changed := true;
    end if;
  else
    insert into public.votes (matchup_id, user_id, winner_form_id)
      values (v_matchup.id, p_uid, p_winner_form_id);
    update public.matchups
      set vote_count = vote_count + 1,
          a_wins = a_wins + case when p_winner_form_id = form_a_id then 1 else 0 end
      where id = v_matchup.id;
    insert into public.vote_events (matchup_id, user_id, winner_form_id)
      values (v_matchup.id, p_uid, p_winner_form_id);
  end if;

  if p_deal_id is not null then
    update public.deals set outcome = 'voted', decided_at = now() where id = p_deal_id;
  end if;

  select * into v_matchup from public.matchups where id = v_matchup.id;

  -- cosmetic Elo-style delta for the reveal animation (display only — the batch
  -- Bradley-Terry fit is the sole source of ranking truth)
  select coalesce(r.display_rating, 1000) into v_winner_rating
    from public.ratings r where r.form_id = p_winner_form_id;
  select coalesce(r.display_rating, 1000) into v_loser_rating
    from public.ratings r
    where r.form_id = case when p_winner_form_id = v_matchup.form_a_id
                           then v_matchup.form_b_id else v_matchup.form_a_id end;
  v_delta := greatest(1, round(16 * (1 - 1 / (1 + power(10, (coalesce(v_loser_rating, 1000) - coalesce(v_winner_rating, 1000)) / 400.0)))));

  return jsonb_build_object(
    'matchup_id', v_matchup.id,
    'vote_count', v_matchup.vote_count,
    'a_wins', v_matchup.a_wins,
    'your_pick', p_winner_form_id,
    'changed', v_changed,
    'no_op', v_no_op,
    'cosmetic_delta', v_delta
  );
end;
$$;

-- skip: "can't call it" — recorded as signal
create or replace function public.skip_deal(p_deal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.deals set outcome = 'skipped', decided_at = now()
    where id = p_deal_id and user_id = (select auth.uid()) and outcome = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- execution grants
--   authed clients: deal, cast, change, skip
--   nobody (server-only via service role): demo_matchups, helpers
-- ---------------------------------------------------------------------------

revoke execute on function public.sample_pairs(text, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.vote_guard(uuid) from public, anon, authenticated;
revoke execute on function public.apply_vote(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.revote_blocked(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.demo_matchups(text, integer, integer) from public, anon, authenticated;
grant execute on function public.demo_matchups(text, integer, integer) to service_role;

revoke execute on function public.deal_matchups(text, integer) from public, anon;
grant execute on function public.deal_matchups(text, integer) to authenticated;
revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;
revoke execute on function public.change_vote(uuid, uuid) from public, anon;
grant execute on function public.change_vote(uuid, uuid) to authenticated;
revoke execute on function public.skip_deal(uuid) from public, anon;
grant execute on function public.skip_deal(uuid) to authenticated;
grant execute on function public.form_card(uuid) to anon, authenticated;
