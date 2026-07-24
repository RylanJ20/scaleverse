-- Split check from record so sign-in can count only FAILED attempts (a shared
-- CGNAT/venue IP legitimately exceeds 20 *successful* sign-ins/hr — only
-- failures should burn the credential-stuffing budget). p_consume=false checks
-- the cap without inserting; auth_record inserts a single attempt row.
-- Signup / check_username keep the old check+insert behavior (p_consume=true).

create or replace function public.auth_guard(
  p_ip_hash text,
  p_kind text,
  p_max_per_hour integer,
  p_consume boolean default true
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
  perform pg_advisory_xact_lock(hashtextextended('sv-auth:' || p_kind || ':' || p_ip_hash, 42));
  delete from public.auth_attempts where created_at < now() - interval '90 days';

  select count(*) into v_count from public.auth_attempts
    where ip_hash = p_ip_hash and kind = p_kind
      and created_at > now() - interval '1 hour';
  if v_count >= p_max_per_hour then
    return false;
  end if;

  if p_consume then
    insert into public.auth_attempts (ip_hash, kind) values (p_ip_hash, p_kind);
  end if;
  return true;
end;
$$;

create or replace function public.auth_record(p_ip_hash text, p_kind text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.auth_attempts (ip_hash, kind) values (p_ip_hash, p_kind);
$$;

revoke execute on function public.auth_guard(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.auth_guard(text, text, integer, boolean) to service_role;
revoke execute on function public.auth_record(text, text) from public, anon, authenticated;
grant execute on function public.auth_record(text, text) to service_role;
