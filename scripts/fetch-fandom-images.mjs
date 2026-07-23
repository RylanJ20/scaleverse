// Re-source character images from the One Piece fandom wiki (egress-free — does
// not touch either throttled Supabase project). Reads each character YAML's
// wiki_url, pulls the page's infobox image via the fandom pageimages API,
// optimizes to webp, and writes public/characters/<slug>.webp.
// Resume-capable: existing files are skipped. Writes a manifest.
// Usage: node scripts/fetch-fandom-images.mjs [manifest-out.json]
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import sharp from "sharp";

const CHAR_DIR = "seed/one-piece/characters";
const OUT_DIR = "public/characters";
const MANIFEST = process.argv[2] ?? "fandom-image-manifest.json";
const API = "https://onepiece.fandom.com/api.php";
const UA = "ScaleverseImageBot/1.0 (fan project; contact via github.com/RylanJ20/scaleverse)";
const CONCURRENCY = 3;
const MAX_WIDTH = 640;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function titleFromWikiUrl(wikiUrl) {
  if (!wikiUrl) return null;
  const m = wikiUrl.split("/wiki/")[1];
  if (!m) return null;
  try {
    return decodeURIComponent(m);
  } catch {
    return m;
  }
}

async function fandomImageUrl(title, attempt = 0) {
  const url = `${API}?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=original|thumbnail&pithumbsize=${MAX_WIDTH}&redirects=1&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 && attempt < 4) {
    await sleep(3000 * (attempt + 1));
    return fandomImageUrl(title, attempt + 1);
  }
  if (!res.ok) throw new Error(`api ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) throw new Error("page missing");
  return page.original?.source ?? page.thumbnail?.source ?? null;
}

async function fetchImage(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 && attempt < 4) {
    await sleep(3000 * (attempt + 1));
    return fetchImage(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`img ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processOne(doc) {
  const slug = doc.slug;
  const outPath = path.join(OUT_DIR, `${slug}.webp`);
  if (fs.existsSync(outPath)) return { slug, ok: true, skipped: true };

  const title = titleFromWikiUrl(doc.wiki_url);
  if (!title) return { slug, ok: false, error: "no wiki_url" };
  try {
    const imgUrl = await fandomImageUrl(title);
    if (!imgUrl) return { slug, ok: false, error: "no page image" };
    const input = await fetchImage(imgUrl);
    const out = await sharp(input)
      .resize(MAX_WIDTH, Math.round(MAX_WIDTH * 1.4), { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    fs.writeFileSync(outPath, out);
    return { slug, ok: true, source: imgUrl, kb: Math.round(out.length / 1024) };
  } catch (e) {
    return { slug, ok: false, error: String(e).slice(0, 80) };
  }
}

const docs = fs
  .readdirSync(CHAR_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => yaml.load(fs.readFileSync(path.join(CHAR_DIR, f), "utf8")));

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
let done = 0;
const queue = [...docs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const doc = queue.shift();
      const r = await processOne(doc);
      results.push(r);
      done++;
      if (!r.ok) console.log(`[${done}/${docs.length}] FAIL ${r.slug}: ${r.error}`);
      else if (done % 25 === 0) console.log(`[${done}/${docs.length}] ok`);
      await sleep(120);
    }
  }),
);

fs.writeFileSync(MANIFEST, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
const fetched = results.filter((r) => r.ok && !r.skipped);
console.log(`\nfetched ${fetched.length}, skipped ${results.length - fetched.length - failed.length}, failed ${failed.length}/${results.length}`);
if (failed.length) failed.forEach((f) => console.log("  FAIL:", f.slug, "-", f.error));
