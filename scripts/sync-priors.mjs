// Sync hand-authored power_level priors into the live rating model (ratified 2026-07-24).
//
// power_level (seed YAML) is the ONLY human-authored prior. This script is the ONLY way an
// edited power_level reaches the tier list:
//   power_level --fixed map--> seed_theta --regularized Bradley-Terry MAP over votes--> display_rating
//
// It mirrors the fit-ratings edge function's math exactly (same PRIOR_VAR, solver, tier bands)
// so a manual prior sync and the 10-minute cron always agree — keep the two in sync if either changes.
// Voted forms keep their community-earned rating (the prior only nudges them); low/no-vote forms
// snap to the new prior. display_rating stays the one shown rating; power_level is never read at runtime.
//
// Usage:
//   node --env-file=.env.local scripts/sync-priors.mjs [--dry-run]
//   npm run sync-priors -- --dry-run
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run") || process.argv.includes("--dry");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !SECRET) {
  throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (run with --env-file=.env.local)");
}
const db = createClient(URL_BASE, SECRET, { auth: { persistSession: false } });

// Fixed absolute prior map. Frozen at the original seed's anchors (power_level 50..10000 -> theta
// -2.5..+2.5) so a given power_level always means the same rating and nothing shifts when the roster
// changes; it linearly extrapolates for values authored outside [PL_MIN, PL_MAX]. A null power_level
// gets a below-average, extra-uncertain prior (matches the original seed).
const PL_MIN = 50, PL_MAX = 10000, NULL_THETA = -1.5, PRIOR_VAR = 1.0;
const thetaOf = (pl) => (pl == null ? NULL_THETA : 5 * ((pl - PL_MIN) / (PL_MAX - PL_MIN)) - 2.5);
const ratingOf = (t) => Math.round(1000 + 173.7 * t);
const TIER_BANDS = [["S", 0.05], ["A", 0.15], ["B", 0.35], ["C", 0.65], ["D", 0.9], ["F", 1.0]];

const die = (label) => (res) => {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res;
};
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// --- series ---------------------------------------------------------------
const { data: [series] } = die("series")(await db.from("series").select("id").eq("slug", "one-piece"));

// --- power_level per character (from seed YAML) ---------------------------
const dir = "seed/one-piece/characters";
const plBySlug = new Map();
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yaml"))) {
  const d = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"));
  plBySlug.set(d.slug, d.power_level ?? null);
}
console.log(`seed: ${plBySlug.size} characters`);

// --- default form per character carries that character's prior -------------
const { data: forms } = die("forms")(
  await db.from("forms")
    .select("id, is_default, is_active, characters!inner(slug, series_id)")
    .eq("characters.series_id", series.id)
    .limit(2000),
);
const slugByForm = new Map(forms.map((f) => [f.id, f.characters.slug]));
const desiredSeed = new Map(); // form_id -> new seed_theta
for (const f of forms) {
  if (f.is_default && plBySlug.has(f.characters.slug)) {
    desiredSeed.set(f.id, thetaOf(plBySlug.get(f.characters.slug)));
  }
}

// --- current ratings (for diff, and to preserve non-default forms' seed) ---
const { data: current } = die("ratings")(
  await db.from("ratings").select("form_id, seed_theta, display_rating").limit(2000),
);
const curById = new Map(current.map((r) => [r.form_id, r]));

// Working set: every form with a rating row, plus every default form (may lack a row).
const workIds = new Set([...current.map((r) => r.form_id), ...desiredSeed.keys()]);
const ratings = [...workIds].map((form_id) => ({
  form_id,
  seed_theta: desiredSeed.has(form_id) ? desiredSeed.get(form_id) : (curById.get(form_id)?.seed_theta ?? NULL_THETA),
}));

// --- current votes with their matchup's form pair --------------------------
const { data: votes } = die("votes")(
  await db.from("votes").select("winner_form_id, matchups(form_a_id, form_b_id)").limit(5000),
);
const pairs = new Map();
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

// --- coordinate-wise Newton on the MAP objective (mirror of fit-ratings) ---
const idx = new Map(ratings.map((r, i) => [r.form_id, i]));
const seed = ratings.map((r) => r.seed_theta);
const theta = [...seed];
const opponents = ratings.map(() => []);
for (const p of pairs.values()) {
  const i = idx.get(p.a), j = idx.get(p.b);
  if (i == null || j == null) continue;
  opponents[i].push({ j, wins: p.aWins, losses: p.bWins });
  opponents[j].push({ j: i, wins: p.bWins, losses: p.aWins });
}
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
const se = theta.map((t, i) => {
  let hess = 1 / PRIOR_VAR;
  for (const o of opponents[i]) {
    const p = 1 / (1 + Math.exp(-(t - theta[o.j])));
    hess += (o.wins + o.losses) * p * (1 - p);
  }
  return 1 / Math.sqrt(hess);
});

// --- percentile tiers among active forms (mirror of fit-ratings) -----------
const activeSet = new Set(forms.filter((f) => f.is_active).map((f) => f.id));
const ranked = ratings
  .map((r, i) => ({ form_id: r.form_id, i }))
  .filter((r) => activeSet.has(r.form_id))
  .sort((x, y) => theta[y.i] - theta[x.i]);
const tierOf = new Map();
ranked.forEach((r, rank) => {
  const pct = (rank + 1) / ranked.length;
  tierOf.set(r.form_id, TIER_BANDS.find(([, cut]) => pct <= cut)[0]);
});

// --- assemble rows + report the diff ---------------------------------------
const rows = ratings.map((r, i) => ({
  form_id: r.form_id,
  theta: theta[i],
  se: se[i],
  display_rating: ratingOf(theta[i]),
  tier: tierOf.get(r.form_id) ?? null,
  seed_theta: r.seed_theta,
}));
const changed = rows
  .map((r) => ({ slug: slugByForm.get(r.form_id) ?? r.form_id, prev: curById.get(r.form_id)?.display_rating ?? null, next: r.display_rating }))
  .filter((r) => r.prev !== r.next)
  .sort((a, b) => Math.abs(b.next - (b.prev ?? b.next)) - Math.abs(a.next - (a.prev ?? a.next)));

console.log(`forms: ${rows.length} | votes: ${votes.length} | pairs: ${pairs.size}`);
console.log(`display_rating changes: ${changed.length}`);
for (const c of changed.slice(0, 40)) {
  console.log(`  ${String(c.slug).padEnd(24)} ${String(c.prev ?? "—").padStart(5)} -> ${String(c.next).padStart(5)}`);
}
if (changed.length > 40) console.log(`  … and ${changed.length - 40} more`);

if (DRY) {
  console.log("\n[dry-run] no writes");
} else {
  const fitAt = new Date().toISOString();
  const writeRows = rows.map((r) => ({ ...r, fit_at: fitAt }));
  for (const c of chunk(writeRows, 500)) die("ratings write")(await db.from("ratings").upsert(c, { onConflict: "form_id" }));
  console.log(`\nsynced ${writeRows.length} ratings`);
}
