-- Scaleverse initial schema
-- Implements ratified decisions (PRODUCT_PLAN.md §0):
--   * series-scoped everything (verse #2 = content insert, not rewrite)
--   * votable entities are character FORMS; never same-character matchups
--   * append-only vote_events + current `votes`; no rating math in request path
--   * demo (anonymous) votes in a fully separate table
--   * single unified arc timeline per series (chapter + episode ranges)
--   * per-user arc progress for spoiler gating (enforced in app code, not RLS —
--     ratified: direct-API access past your own setting is self-spoiling)
--   * account deletion cascades: votes die with the account; rankings adjust
--     at the next batch refit

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Series & arcs
-- ---------------------------------------------------------------------------

create table public.series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.arcs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  -- unified timeline order; the spoiler-gating index.
  -- deferrable so mid-timeline inserts can shift positions in one transaction
  position integer not null,
  chapter_start integer,
  chapter_end integer,
  episode_start integer,
  episode_end integer,
  unique (series_id, slug),
  unique (series_id, position) deferrable initially immediate,
  -- composite target so referencing tables can enforce same-series arcs
  unique (id, series_id)
);

-- ---------------------------------------------------------------------------
-- Characters & forms (forms are the votable entities)
-- ---------------------------------------------------------------------------

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  epithet text,
  -- null = visible from the very start of the series (fail-open by design);
  -- composite FK keeps the debut arc inside the character's own series
  debut_arc_id uuid,
  created_at timestamptz not null default now(),
  unique (series_id, slug),
  foreign key (debut_arc_id, series_id) references public.arcs (id, series_id)
);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  is_default boolean not null default false,
  -- form is spoiler-hidden before this arc (null = visible from character debut);
  -- same-series integrity is guaranteed by the seed pipeline (admin-only writes)
  reveal_arc_id uuid references public.arcs (id),
  -- every votable form requires its own image (ratified #12)
  image_path text check (image_path is null or btrim(image_path) <> ''),
  is_active boolean not null default false check (not is_active or image_path is not null),
  created_at timestamptz not null default now(),
  unique (character_id, slug)
);

-- at most one default form per character (seed script guarantees exactly one)
create unique index forms_one_default_per_character
  on public.forms (character_id)
  where is_default;

create index forms_character_id_idx on public.forms (character_id);

-- forms must not move between characters: matchup validity was checked against
-- the character at insert time, and reassignment would silently break the
-- same-character invariant (ratified #6)
create or replace function public.forms_character_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.character_id is distinct from old.character_id then
    raise exception 'forms cannot be reassigned to another character';
  end if;
  return new;
end;
$$;

create trigger forms_character_id_immutable
  before update on public.forms
  for each row
  execute function public.forms_character_id_immutable();

-- ---------------------------------------------------------------------------
-- Matchups (form vs form, canonical pair ordering dedups)
-- ---------------------------------------------------------------------------

create table public.matchups (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  form_a_id uuid not null references public.forms (id) on delete cascade,
  form_b_id uuid not null references public.forms (id) on delete cascade,
  -- denormalized tallies, maintained by the vote RPC (later migration)
  vote_count integer not null default 0,
  a_wins integer not null default 0,
  created_at timestamptz not null default now(),
  -- canonical ordering makes (a,b) == (b,a) impossible to duplicate
  check (form_a_id < form_b_id),
  unique (form_a_id, form_b_id)
);

create index matchups_series_id_idx on public.matchups (series_id);
-- character-pair pages look up matchups from either side
create index matchups_form_b_id_idx on public.matchups (form_b_id);

-- ratified #6: two forms of the same character must never form a matchup,
-- and both forms must belong to the matchup's series
create or replace function public.matchups_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  char_a uuid;
  char_b uuid;
  series_a uuid;
  series_b uuid;
begin
  select c.id, c.series_id into char_a, series_a
    from public.forms f join public.characters c on c.id = f.character_id
    where f.id = new.form_a_id;
  select c.id, c.series_id into char_b, series_b
    from public.forms f join public.characters c on c.id = f.character_id
    where f.id = new.form_b_id;
  if char_a = char_b then
    raise exception 'same-character matchups are not allowed (ratified decision #6)';
  end if;
  if series_a <> new.series_id or series_b <> new.series_id then
    raise exception 'matchup series_id must match both forms'' series';
  end if;
  return new;
end;
$$;

create trigger matchups_validate
  before insert or update on public.matchups
  for each row
  execute function public.matchups_validate();

-- ---------------------------------------------------------------------------
-- Profiles & spoiler progress
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext unique
    check (username is null or (length(username) between 3 and 24 and username ~ '^[A-Za-z0-9_]+$')),
  role text not null default 'user' check (role in ('user', 'mod', 'admin')),
  created_at timestamptz not null default now()
);

-- auto-create a profile row for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

create table public.user_series_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  series_id uuid not null references public.series (id) on delete cascade,
  -- last arc the user has finished; null + caught_up=false means "not set yet".
  -- composite FK: a client can only point at an arc of this row's series
  last_arc_id uuid,
  caught_up boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, series_id),
  foreign key (last_arc_id, series_id) references public.arcs (id, series_id)
);

-- ---------------------------------------------------------------------------
-- Votes: append-only event log + current vote per (user, matchup).
-- Ratified: votes die with the account (on delete cascade); content deletion
-- cascades all the way down so admin roster removal never hits FK errors.
-- ---------------------------------------------------------------------------

create table public.vote_events (
  id bigint generated always as identity primary key,
  matchup_id uuid not null references public.matchups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  winner_form_id uuid not null references public.forms (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index vote_events_matchup_id_idx on public.vote_events (matchup_id);
create index vote_events_user_id_idx on public.vote_events (user_id);
create index vote_events_winner_form_id_idx on public.vote_events (winner_form_id);

create table public.votes (
  matchup_id uuid not null references public.matchups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  winner_form_id uuid not null references public.forms (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (matchup_id, user_id)
);

create index votes_user_id_idx on public.votes (user_id);
create index votes_winner_form_id_idx on public.votes (winner_form_id);

-- the winner must be one of the matchup's two forms
create or replace function public.votes_validate_winner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a uuid;
  b uuid;
begin
  select form_a_id, form_b_id into a, b
    from public.matchups where id = new.matchup_id;
  if new.winner_form_id <> a and new.winner_form_id <> b then
    raise exception 'winner_form_id must be one of the matchup''s forms';
  end if;
  return new;
end;
$$;

create trigger vote_events_validate_winner
  before insert or update on public.vote_events
  for each row
  execute function public.votes_validate_winner();

create trigger votes_validate_winner
  before insert or update on public.votes
  for each row
  execute function public.votes_validate_winner();

-- demo votes from anonymous visitors: fully separate, never counted (ratified #23)
create table public.demo_votes (
  id bigint generated always as identity primary key,
  -- client-generated session id; no FK anywhere near real votes
  session_id uuid not null,
  matchup_id uuid references public.matchups (id) on delete set null,
  winner_form_id uuid references public.forms (id) on delete set null,
  created_at timestamptz not null default now()
);

create index demo_votes_matchup_id_idx on public.demo_votes (matchup_id);
create index demo_votes_winner_form_id_idx on public.demo_votes (winner_form_id);

-- ---------------------------------------------------------------------------
-- Ratings (written only by the batch Bradley-Terry cron job)
-- ---------------------------------------------------------------------------

create table public.ratings (
  form_id uuid primary key references public.forms (id) on delete cascade,
  theta double precision not null default 0,
  se double precision,
  display_rating integer not null default 1000,
  tier text check (tier in ('S', 'A', 'B', 'C', 'D', 'F')),
  fit_at timestamptz
);

create table public.rating_history (
  id bigint generated always as identity primary key,
  form_id uuid not null references public.forms (id) on delete cascade,
  theta double precision not null,
  display_rating integer not null,
  tier text,
  fit_at timestamptz not null
);

-- one snapshot per form per fit; also serves sparkline queries
create unique index rating_history_form_fit_idx
  on public.rating_history (form_id, fit_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Content is world-readable; ALL writes go through server-side code
-- (service role or SECURITY DEFINER RPCs added in later migrations).
-- ---------------------------------------------------------------------------

alter table public.series enable row level security;
alter table public.arcs enable row level security;
alter table public.characters enable row level security;
alter table public.forms enable row level security;
alter table public.matchups enable row level security;
alter table public.profiles enable row level security;
alter table public.user_series_progress enable row level security;
alter table public.vote_events enable row level security;
alter table public.votes enable row level security;
alter table public.demo_votes enable row level security;
alter table public.ratings enable row level security;
alter table public.rating_history enable row level security;

-- public content: readable by everyone, writable by no client
create policy "series are public" on public.series for select using (true);
create policy "arcs are public" on public.arcs for select using (true);
create policy "characters are public" on public.characters for select using (true);
create policy "forms are public" on public.forms for select using (true);
create policy "matchups are public" on public.matchups for select using (true);
create policy "ratings are public" on public.ratings for select using (true);
create policy "rating history is public" on public.rating_history for select using (true);

-- profiles: public read (take records are the product), owner may update.
-- RLS is row-scoped only, so column-level grants stop privilege escalation:
-- without this, any signed-in user could set role='admin' on their own row.
create policy "profiles are public" on public.profiles for select using (true);
create policy "users update own profile" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke update on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- spoiler progress: private to the owner
create policy "users read own progress" on public.user_series_progress
  for select using ((select auth.uid()) = user_id);
create policy "users insert own progress" on public.user_series_progress
  for insert with check ((select auth.uid()) = user_id);
create policy "users update own progress" on public.user_series_progress
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- votes: readable (the public take record is part of the product);
-- no direct client writes — the cast_vote RPC (later migration) is the only write path
create policy "vote events are public" on public.vote_events for select using (true);
create policy "votes are public" on public.votes for select using (true);

-- demo votes: no client access at all; server actions use the secret key
-- (client readback would return empty rows — by design, demos never read back)
