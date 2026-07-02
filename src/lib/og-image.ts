import "server-only";
import sharp from "sharp";

const imageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/character-images`;

// Satori (next/og) can't decode webp, and all character art is webp. Fetch the
// image and transcode to a PNG data URI so it renders inside ImageResponse.
export async function characterPngDataUri(
  imagePath: string | null | undefined,
  width: number,
): Promise<string | null> {
  if (!imagePath) return null;
  try {
    const res = await fetch(`${imageBase}/${imagePath}`, { cache: "force-cache" });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const png = await sharp(input)
      .resize(width, Math.round(width * 1.4), { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
