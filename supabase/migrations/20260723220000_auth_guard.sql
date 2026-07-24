-- Integrity floor for the auth funnel (plan §launch-defenses): per-IP caps on
-- signup / sign-in / username checks. Server actions reach Supabase from
-- Vercel egress IPs, so GoTrue's own per-IP throttles never see the real
-- client — the app passes a salted ip_hash (never the raw IP; 90-day
-- retention) and this guard is the effective limiter.

create table public.auth_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  kind text not null check (kind in ('signup', 'signin', 'check_username')),
  created_at timestamptz not null default now()
);

create index auth_attempts_ip_kind_time_idx
  on public.auth_attempts (ip_hash, kind, created_at desc);
create index auth_attempts_created_idx on public.auth_attempts (created_at);

alter table public.auth_attempts enable row level security;
-- no client policies: service-role only

create or replace function public.auth_guard(
  p_ip_hash text,
  p_kind text,
  p_max_per_hour integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- serialize per (ip, kind) so concurrent attempts see each other's inserts
  perform pg_advisory_xact_lock(hashtextextended('sv-auth:' || p_kind || ':' || p_ip_hash, 42));

  -- opportunistic retention (plan: 90 days)
  delete from public.auth_attempts where created_at < now() - interval '90 days';

  select count(*) into v_count from public.auth_attempts
    where ip_hash = p_ip_hash and kind = p_kind
      and created_at > now() - interval '1 hour';
  if v_count >= p_max_per_hour then
    return false;
  end if;

  insert into public.auth_attempts (ip_hash, kind) values (p_ip_hash, p_kind);
  return true;
end;
$$;

revoke execute on function public.auth_guard(text, text, integer) from public, anon, authenticated;
grant execute on function public.auth_guard(text, text, integer) to service_role;
