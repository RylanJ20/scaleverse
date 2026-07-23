-- Movement baselines query rating_history by fit_at alone (nearest snapshot
-- older than a cutoff, then all rows at that fit_at). The existing
-- (form_id, fit_at) index can't serve either shape, so both were sequential
-- scans on an append-only table that grows ~roster-size rows per fit.
create index if not exists rating_history_fit_at_idx
  on public.rating_history (fit_at desc);
