-- Infinite-arena vote ceilings (founder decision #38, 2026-07-23).
-- The no-sets arena makes 500 votes/hr reachable in ~30-40 min of legitimate
-- engaged play, so the hourly/daily ceilings rise to 1000/4000. The anti-bot
-- core is untouched: 1.5s min spacing and the 20/min burst cap stay as ratified.

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
      where user_id = p_uid and created_at > now() - interval '1 hour') >= 1000
     or (select count(*) from public.vote_events
      where user_id = p_uid and created_at > now() - interval '1 day') >= 4000
  then
    raise exception 'rate limit exceeded' using errcode = 'P0006';
  end if;
end;
$$;

-- replace preserves privileges; re-asserted anyway (internal helper — not client-callable)
revoke execute on function public.vote_guard(uuid) from public, anon, authenticated;
