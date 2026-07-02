// Copies character images from the OPdle public bucket into the scaleverse
// project's character-images bucket, optimizing to webp (max 1024px, q82).
// Idempotent: re-running overwrites (x-upsert). Writes a manifest JSON.
// Usage: node scripts/copy-images.mjs <manifest-out.json>
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import sharp from "sharp";

const manifestOut = process.argv[2] ?? "image-manifest.json";
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !SECRET) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");

const BUCKET = "character-images";
const CHAR_DIR = "seed/one-piece/characters";
const CONCURRENCY = Number(process.env.COPY_CONCURRENCY ?? 8);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    await sleep(5000 * (i + 1));
  }
  return fetch(url);
}

async function ensureBucket() {
  const res = await fetch(`${URL_BASE}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, apikey: SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    if (!body.includes("already exists")) throw new Error(`bucket create failed: ${res.status} ${body}`);
  }
  console.log(`bucket ${BUCKET} ready`);
}

async function processOne(doc) {
  const { slug } = doc;
  const src = doc.image?.source_url;
  if (!src) return { slug, ok: false, error: "no source_url" };
  try {
    const dl = await fetchWithRetry(src);
    if (!dl.ok) return { slug, ok: false, error: `download ${dl.status}` };
    const input = Buffer.from(await dl.arrayBuffer());
    const img = sharp(input).rotate();
    const meta = await img.metadata();
    const out = await img
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${doc.image.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        apikey: SECRET,
        "Content-Type": "image/webp",
        "x-upsert": "true",
      },
      body: out,
    });
    if (!up.ok) return { slug, ok: false, error: `upload ${up.status}: ${await up.text()}` };
    return { slug, ok: true, src_width: meta.width, src_height: meta.height, webp_kb: Math.round(out.length / 1024) };
  } catch (e) {
    return { slug, ok: false, error: String(e) };
  }
}

let docs = fs
  .readdirSync(CHAR_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => yaml.load(fs.readFileSync(path.join(CHAR_DIR, f), "utf8")));

// resume mode: keep prior successes from an existing manifest, only retry the rest
const priorOk = [];
if (fs.existsSync(manifestOut)) {
  for (const r of JSON.parse(fs.readFileSync(manifestOut, "utf8"))) if (r.ok) priorOk.push(r);
  const okSlugs = new Set(priorOk.map((r) => r.slug));
  docs = docs.filter((d) => !okSlugs.has(d.slug));
  console.log(`resume: ${priorOk.length} already copied, ${docs.length} to go`);
}

await ensureBucket();
const results = [...priorOk];
let done = 0;
const queue = [...docs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const doc = queue.shift();
      const r = await processOne(doc);
      results.push(r);
      done++;
      if (done % 25 === 0 || !r.ok) console.log(`[${done}/${docs.length}]`, r.ok ? "ok" : `FAIL ${r.slug}: ${r.error}`);
    }
  }),
);

fs.writeFileSync(manifestOut, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
const small = results.filter((r) => r.ok && Math.max(r.src_width ?? 0, r.src_height ?? 0) < 400);
console.log(`\ncopied ${results.length - failed.length}/${results.length}; ${failed.length} failed; ${small.length} low-res sources (<400px)`);
if (failed.length) failed.forEach((f) => console.log("  FAILED:", f.slug, f.error));
