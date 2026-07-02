-- Character stat payload (display-only, current-canon) + direct matchup-page voting.
-- stats is a flexible JSONB blob for MVP; v1's arc-versioned character_attributes
-- will supersede it. Values are current-canon (ratified: character pages show all
-- stats behind a page-level spoiler interstitial, not per-stat gating).

alter table public.characters
  add column if not exists stats jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- vote_on_matchup: first-vote OR change directly from a matchup page (no deal).
-- Authed-only + rate-limited via vote_guard; creates the matchup row lazily on
-- first real vote (like the Arena does via deals) so anon page views never write.
-- ---------------------------------------------------------------------------

create or replace function public.vote_on_matchup(
  p_form_a_id uuid,
  p_form_b_id uuid,
  p_winner_form_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_a uuid := least(p_form_a_id, p_form_b_id);
  v_b uuid := greatest(p_form_a_id, p_form_b_id);
  v_series_id uuid;
  v_matchup_id uuid;
  v_char_a uuid;
  v_char_b uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_a = v_b then
    raise exception 'a matchup needs two different forms' using errcode = 'P0007';
  end if;

  -- both forms must be active, same series, different characters (ratified #6)
  select c.series_id, c.id into v_series_id, v_char_a
    from public.forms f join public.characters c on c.id = f.character_id
    where f.id = v_a and f.is_active;
  if not found then
    raise exception 'form not available' using errcode = 'P0002';
  end if;
  select c.id into v_char_b
    from public.forms f join public.characters c on c.id = f.character_id
    where f.id = v_b and f.is_active and c.series_id = v_series_id;
  if not found then
    raise exception 'form not available' using errcode = 'P0002';
  end if;
  if v_char_a = v_char_b then
    raise exception 'same-character matchups are not allowed' using errcode = 'P0006';
  end if;

  perform public.vote_guard(v_uid);

  insert into public.matchups (series_id, form_a_id, form_b_id)
    values (v_series_id, v_a, v_b)
  on conflict (form_a_id, form_b_id) do nothing;
  select id into v_matchup_id from public.matchups
    where form_a_id = v_a and form_b_id = v_b;

  return public.apply_vote(v_uid, v_matchup_id, p_winner_form_id, null);
end;
$$;

revoke execute on function public.vote_on_matchup(uuid, uuid, uuid) from public, anon;
grant execute on function public.vote_on_matchup(uuid, uuid, uuid) to authenticated;
