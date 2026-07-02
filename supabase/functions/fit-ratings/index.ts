// Scaleverse rating fit — regularized Bradley-Terry MAP (ratified #3).
// Runs every 10 minutes via pg_cron -> pg_net. The ONLY writer of ratings truth.
// Model: P(i beats j) = sigmoid(theta_i - theta_j), prior theta_i ~ N(seed_theta_i, 1).
// Fit over CURRENT votes (latest per user+matchup); vote_events is the audit log.
import { createClient } from "npm:@supabase/supabase-js@2";

type PairCount = { a: string; b: string; aWins: number; bWins: number };

const TIER_BANDS: Array<[string, number]> = [
  ["S", 0.05],
  ["A", 0.15],
  ["B", 0.35],
  ["C", 0.65],
  ["D", 0.9],
  ["F", 1.0],
];

Deno.serve(async (req) => {
  const secret = Deno.env.get("FIT_SECRET");
  if (secret && req.headers.get("x-fit-secret") !== secret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // skip if nothing changed since the last fit
  const { data: lastFit } = await db
    .from("rating_history")
    .select("fit_at")
    .order("fit_at", { ascending: false })
    .limit(1);
  const since = lastFit?.[0]?.fit_at;
  if (since) {
    const { count } = await db
      .from("vote_events")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since);
    if (!count) return Response.json({ skipped: true, reason: "no new votes" });
  }

  // load ratings (seeds) — one page is plenty for <1000 forms; paginate anyway
  const ratings: Array<{ form_id: string; seed_theta: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("ratings")
      .select("form_id, seed_theta")
      .range(from, from + 999);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    ratings.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // load current votes with their matchup's form pair
  const votes: Array<{ winner_form_id: string; matchups: { form_a_id: string; form_b_id: string } }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("votes")
      .select("winner_form_id, matchups(form_a_id, form_b_id)")
      .range(from, from + 999);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    votes.push(...((data as typeof votes) ?? []));
    if (!data || data.length < 1000) break;
  }

  // aggregate pair counts (weight 1.0 per vote at MVP — reliability weights are v1)
  const pairs = new Map<string, PairCount>();
  for (const v of votes) {
    const m = v.matchups;
    if (!m) continue;
    const key = `${m.form_a_id}|${m.form_b_id}`;
    let p = pairs.get(key);
    if (!p) {
      p = { a: m.form_a_id, b: m.form_b_id, aWins: 0, bWins: 0 };
      pairs.set(key, p);
    }
    if (v.winner_form_id === m.form_a_id) p.aWins++;
    else p.bWins++;
  }

  // coordinate-wise Newton on the MAP objective
  const idx = new Map(ratings.map((r, i) => [r.form_id, i]));
  const seed = ratings.map((r) => r.seed_theta);
  const theta = [...seed];
  const opponents: Array<Array<{ j: number; wins: number; losses: number }>> = ratings.map(() => []);
  for (const p of pairs.values()) {
    const i = idx.get(p.a);
    const j = idx.get(p.b);
    if (i == null || j == null) continue;
    opponents[i].push({ j, wins: p.aWins, losses: p.bWins });
    opponents[j].push({ j: i, wins: p.bWins, losses: p.aWins });
  }

  const PRIOR_VAR = 1.0;
  let maxDelta = Infinity;
  for (let iter = 0; iter < 200 && maxDelta > 1e-6; iter++) {
    maxDelta = 0;
    for (let i = 0; i < theta.length; i++) {
      let grad = -(theta[i] - seed[i]) / PRIOR_VAR;
      let hess = 1 / PRIOR_VAR;
      for (const o of opponents[i]) {
        const p = 1 / (1 + Math.exp(-(theta[i] - theta[o.j])));
        const n = o.wins + o.losses;
        grad += o.wins - n * p;
        hess += n * p * (1 - p);
      }
      const step = grad / hess;
      theta[i] += step;
      maxDelta = Math.max(maxDelta, Math.abs(step));
    }
  }

  // standard errors from the diagonal Hessian at the optimum
  const se = theta.map((t, i) => {
    let hess = 1 / PRIOR_VAR;
    for (const o of opponents[i]) {
      const p = 1 / (1 + Math.exp(-(t - theta[o.j])));
      hess += (o.wins + o.losses) * p * (1 - p);
    }
    return 1 / Math.sqrt(hess);
  });

  // percentile tiers (5/10/20/30/25/10) among active forms
  const { data: activeForms } = await db.from("forms").select("id").eq("is_active", true).limit(2000);
  const activeSet = new Set((activeForms ?? []).map((f) => f.id));
  const ranked = ratings
    .map((r, i) => ({ form_id: r.form_id, i }))
    .filter((r) => activeSet.has(r.form_id))
    .sort((x, y) => theta[y.i] - theta[x.i]);
  const tierOf = new Map<string, string>();
  ranked.forEach((r, rank) => {
    const pct = (rank + 1) / ranked.length;
    tierOf.set(r.form_id, TIER_BANDS.find(([, cut]) => pct <= cut)![0]);
  });

  const fitAt = new Date().toISOString();
  const rows = ratings.map((r, i) => ({
    form_id: r.form_id,
    theta: theta[i],
    se: se[i],
    display_rating: Math.round(1000 + 173.7 * theta[i]),
    tier: tierOf.get(r.form_id) ?? null,
    fit_at: fitAt,
    seed_theta: r.seed_theta,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("ratings").upsert(rows.slice(i, i + 500), { onConflict: "form_id" });
    if (error) return Response.json({ error: `ratings write: ${error.message}` }, { status: 500 });
  }
  const historyRows = rows.map(({ seed_theta: _s, se: _se, ...h }) => h);
  for (let i = 0; i < historyRows.length; i += 500) {
    const { error } = await db.from("rating_history").insert(historyRows.slice(i, i + 500));
    if (error) return Response.json({ error: `history write: ${error.message}` }, { status: 500 });
  }

  return Response.json({
    fitted: rows.length,
    pairs: pairs.size,
    votes: votes.length,
    fit_at: fitAt,
  });
});
