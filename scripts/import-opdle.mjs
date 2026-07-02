// One-time importer: OPdle character export (JSON) -> seed/one-piece/characters/*.yaml
// Usage: node scripts/import-opdle.mjs <path-to-opdle-characters.json>
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/import-opdle.mjs <opdle-characters.json>");

const OUT_DIR = "seed/one-piece/characters";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const arcsDoc = yaml.load(fs.readFileSync("seed/one-piece/arcs.yaml", "utf8"));
const arcSlugByName = new Map(arcsDoc.arcs.map((a) => [a.name.toLowerCase(), a.slug]));
// OPdle data quirk: both spellings appear
arcSlugByName.set("arabasta", "alabasta");

const chars = JSON.parse(fs.readFileSync(src, "utf8"));
fs.mkdirSync(OUT_DIR, { recursive: true });

const parseNum = (s) => {
  if (s == null) return null;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

const problems = [];
let written = 0;

for (const c of chars) {
  const slug = c.slug?.toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) {
    problems.push(`bad slug: ${c.slug} (${c.name})`);
    continue;
  }
  const arcSlug = c.first_arc ? arcSlugByName.get(c.first_arc.toLowerCase()) : null;
  if (c.first_arc && !arcSlug) problems.push(`unmapped arc "${c.first_arc}" for ${slug}`);

  const doc = {
    slug,
    name: c.name,
    epithet: c.nickname?.[0] ?? null,
    nicknames: c.nickname ?? [],
    debut: {
      arc: arcSlug,
      chapter: parseNum(c.first_chapter),
      episode: parseNum(c.first_episode),
    },
    status: c.status ?? null,
    bounty: c.bounty ?? null,
    haki: {
      conqueror: !!c.has_conqueror,
      armament: !!c.has_armament,
      observation: !!c.has_observation,
    },
    devil_fruit:
      c.devil_fruit_type || c.devil_fruit_name_english
        ? {
            type: c.devil_fruit_type ?? null,
            name_en: c.devil_fruit_name_english ?? null,
            name_ja: c.devil_fruit_name_japanese ?? null,
          }
        : null,
    demographics: {
      gender: c.gender ?? null,
      race: c.race ?? null,
      origin: c.origin ?? null,
      age: c.age ?? null,
      height_cm: c.height ?? null,
    },
    affiliation: c.affiliation ?? null,
    other_affiliations: c.other_affiliations ?? [],
    wiki_url: c.wiki_url ?? null,
    // OPdle hand-tuned scale; seeds the initial Bradley-Terry prior (ratified)
    power_level: c.power_level ?? null,
    image: {
      source_url: c.image_url,
      path: `characters/${slug}.webp`,
    },
    forms: [{ slug: "base", name: c.name, default: true }],
  };

  fs.writeFileSync(path.join(OUT_DIR, `${slug}.yaml`), yaml.dump(doc, { lineWidth: 120 }));
  written++;
}

console.log(`wrote ${written}/${chars.length} character YAML files to ${OUT_DIR}`);
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`);
  problems.forEach((p) => console.log("  -", p));
  process.exitCode = 1;
}
