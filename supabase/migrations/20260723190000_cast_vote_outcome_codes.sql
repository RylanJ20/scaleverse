-- cast_vote: distinguish WHY a deal isn't pending. The optimistic client
-- treats P0003 as "the vote landed" (correct for lost-response retries), but
-- the old catch-all P0003 also covered deals skipped in another tab or expired
-- by housekeeping — where the vote did NOT land. Split the codes so the client
-- can acknowledge honestly:
--   P0003 = already VOTED (treat as success)
--   P0012 = skipped (vote did not land)
--   P0004 = expired (vote did not land; same code as the dealt_at check)
-- Everything else is byte-identical to 20260702200000.

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
  if v_deal.outcome = 'voted' then
    raise exception 'deal already voted' using errcode = 'P0003';
  end if;
  if v_deal.outcome = 'skipped' then
    raise exception 'deal was skipped' using errcode = 'P0012';
  end if;
  if v_deal.outcome <> 'pending' then
    -- 'expired' (housekeeping) — the vote never landed
    raise exception 'deal expired' using errcode = 'P0004';
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
