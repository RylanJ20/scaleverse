-- Commit the fit-ratings schedule as infrastructure (it previously existed only
-- as a hand-made dashboard job). cron.schedule() with an existing jobname
-- REPLACES the job in place — no double-firing, idempotent on re-apply.
--
-- Secrets are read from Supabase Vault AT RUN TIME so nothing sensitive lives
-- in git. One-time setup (dashboard SQL editor or service connection):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/fit-ratings', 'fit_url');
--   select vault.create_secret('<FIT_SECRET>', 'fit_secret');
-- Until both exist, each run errors visibly in cron.job_run_details (never silently).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fit-ratings',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fit_url'),
    headers := jsonb_build_object(
      'x-fit-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fit_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
