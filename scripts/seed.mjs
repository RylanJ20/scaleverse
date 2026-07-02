// Idempotent seed: seed/one-piece/*.yaml -> scaleverse database (ratified #25).
// Safe to re-run: content upserts by natural key; rating seeds never overwrite
// an existing fit (insert-if-absent only).
// Usage: node scripts/seed.mjs [image-manifest.json]
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !SECRET) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
const db = createClient(URL_BASE, SECRET, { auth: { persistSession: false } });

const manifestPath = process.argv[2];
const copiedOk = new Set();
if (manifestPath && fs.existsSync(manifestPath)) {
  for (const r of JSON.parse(fs.readFileSync(manifestPath, "utf8"))) if (r.ok) copiedOk.add(r.slug);
  console.log(`manifest: ${copiedOk.size} characters have a copied image`);
} else {
  console.log("no image manifest — all forms will seed as inactive");
}

const die = (label) => (res) => {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res;
};
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// --- series ---------------------------------------------------------------
const arcsDoc = yaml.load(fs.readFileSync("seed/one-piece/arcs.yaml", "utf8"));
die("series")(await db.from("series").upsert({ slug: "one-piece", name: "One Piece" }, { onConflict: "slug" }));
const { data: [series] } = die("series fetch")(await db.from("series").select("id").eq("slug", "one-piece"));

// --- arcs ------------------------------------------------------------------
const arcRows = arcsDoc.arcs.map((a, i) => ({
  series_id: series.id,
  slug: a.slug,
  name: a.name,
  position: i + 1,
  chapter_start: a.chapters?.[0] ?? null,
  chapter_end: a.chapters?.[1] ?? null,
  episode_start: a.episodes?.[0] ?? null,
  episode_end: a.episodes?.[1] ?? null,
}));
die("arcs")(await db.from("arcs").upsert(arcRows, { onConflict: "series_id,slug" }));
const { data: arcData } = die("arcs fetch")(await db.from("arcs").select("id, slug").eq("series_id", series.id));
const arcId = new Map(arcData.map((a) => [a.slug, a.id]));
console.log(`arcs: ${arcData.length}`);

// --- characters -------------------------------------------------------------
const docs = fs
  .readdirSync("seed/one-piece/characters")
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => yaml.load(fs.readFileSync(path.join("seed/one-piece/characters", f), "utf8")));

const charRows = docs.map((d) => ({
  series_id: series.id,
  slug: d.slug,
  name: d.name,
  epithet: d.epithet ?? null,
  debut_arc_id: d.debut?.arc ? (arcId.get(d.debut.arc) ?? null) : null,
  stats: {
    nicknames: d.nicknames ?? [],
    status: d.status ?? null,
    bounty: d.bounty ?? null,
    haki: d.haki ?? null,
    devil_fruit: d.devil_fruit ?? null,
    affiliation: d.affiliation ?? null,
    other_affiliations: d.other_affiliations ?? [],
    demographics: d.demographics ?? null,
    debut: d.debut ?? null,
    power_level: d.power_level ?? null,
    wiki_url: d.wiki_url ?? null,
  },
}));
for (const c of chunk(charRows, 100)) die("characters")(await db.from("characters").upsert(c, { onConflict: "series_id,slug" }));
const { data: charData } = die("characters fetch")(
  await db.from("characters").select("id, slug").eq("series_id", series.id).limit(1000),
);
const charId = new Map(charData.map((c) => [c.slug, c.id]));
console.log(`characters: ${charData.length}`);

// --- forms -------------------------------------------------------------------
const formRows = [];
for (const d of docs) {
  for (const f of d.forms ?? []) {
    formRows.push({
      character_id: charId.get(d.slug),
      slug: f.slug,
      name: f.name,
      is_default: !!f.default,
      reveal_arc_id: f.reveal_arc ? (arcId.get(f.reveal_arc) ?? null) : null,
      image_path: d.image?.path ?? null,
      is_active: copiedOk.has(d.slug) && !!d.image?.path,
    });
  }
}
for (const c of chunk(formRows, 100)) die("forms")(await db.from("forms").upsert(c, { onConflict: "character_id,slug" }));
const { data: formData } = die("forms fetch")(
  await db.from("forms").select("id, is_active, characters!inner(slug, series_id)").eq("characters.series_id", series.id).limit(2000),
);
console.log(`forms: ${formData.length} (${formData.filter((f) => f.is_active).length} active)`);

// --- rating seeds (insert-if-absent only — never clobber a real fit) ---------
const pls = docs.filter((d) => d.power_level != null).map((d) => d.power_level);
const min = Math.min(...pls);
const max = Math.max(...pls);
const formIdByCharSlug = new Map(formData.map((f) => [f.characters.slug, f.id]));
const ratingRows = docs
  .filter((d) => formIdByCharSlug.has(d.slug))
  .map((d) => {
    // linear map of OPdle's hand-tuned power_level onto theta in [-2.5, 2.5];
    // characters without a power_level get a below-average, extra-uncertain prior
    const theta =
      d.power_level != null ? 5 * ((d.power_level - min) / (max - min)) - 2.5 : -1.5;
    return {
      form_id: formIdByCharSlug.get(d.slug),
      theta,
      se: d.power_level != null ? 1.0 : 1.2,
      display_rating: Math.round(1000 + 173.7 * theta),
    };
  });
for (const c of chunk(ratingRows, 100))
  die("ratings")(await db.from("ratings").upsert(c, { onConflict: "form_id", ignoreDuplicates: true }));
const { count: ratingCount } = die("ratings count")(
  await db.from("ratings").select("*", { count: "exact", head: true }),
);
console.log(`ratings: ${ratingCount} seeded (power_level range ${min}-${max})`);
console.log("seed complete");
