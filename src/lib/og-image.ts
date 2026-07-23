import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SITE_URL } from "@/lib/site";

// Satori (next/og) can't decode webp, and all character art is webp. Load the
// image and transcode to a PNG data URI so it renders inside ImageResponse.
//
// Images live in public/ (served from Vercel's CDN, not Supabase). Prefer reading
// the file from disk; fall back to fetching the deployed static asset if the file
// isn't present in the function bundle.
export async function characterPngDataUri(
  imagePath: string | null | undefined,
  width: number,
): Promise<string | null> {
  if (!imagePath) return null;
  try {
    let input: Buffer | null = null;
    try {
      input = await readFile(path.join(process.cwd(), "public", imagePath));
    } catch {
      const res = await fetch(`${SITE_URL}/${imagePath}`, { cache: "force-cache" });
      if (res.ok) input = Buffer.from(await res.arrayBuffer());
    }
    if (!input) return null;
    const png = await sharp(input)
      .resize(width, Math.round(width * 1.4), { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
