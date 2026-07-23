import { ImageResponse } from "next/og";
import { getCachedCharacter } from "@/lib/cached";
import { characterPngDataUri } from "@/lib/og-image";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Character on Scaleverse";

export default async function OgImage({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}) {
  const { series, slug } = await params;
  // cached + cookie-free (the old default fell back to the cookie client)
  const char = await getCachedCharacter(series, slug);
  const def = char?.forms.find((f) => f.is_default) ?? char?.forms[0];

  const bg = "#0a0a12";
  const red = "#e11d48";
  const cyan = "#22d3ee";
  const img = await characterPngDataUri(def?.image_path, 500);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: bg }}>
        <div style={{ display: "flex", width: 500, height: "100%", position: "relative" }}>
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} width={500} height={630} style={{ objectFit: "cover", objectPosition: "top" }} alt="" />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              background: "linear-gradient(to right, rgba(10,10,18,0.05), rgba(10,10,18,0.95))",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 56px", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 900, fontStyle: "italic", color: "white", textTransform: "uppercase", marginBottom: 28 }}>
            SCALE<span style={{ color: red }}>VERSE</span>
          </div>
          {char?.epithet && (
            <div style={{ display: "flex", fontSize: 24, color: cyan, textTransform: "uppercase", letterSpacing: 4, marginBottom: 8 }}>
              {char.epithet}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 64, fontWeight: 900, fontStyle: "italic", color: "white", textTransform: "uppercase", lineHeight: 1.05, maxWidth: 560 }}>
            {char?.name ?? "Unknown"}
          </div>
          {def?.display_rating != null && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 32 }}>
              {def.tier && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, background: cyan, color: "#04222a", fontSize: 34, fontWeight: 900, borderRadius: 8 }}>
                  {def.tier}
                </div>
              )}
              <div style={{ display: "flex", fontSize: 40, color: "white", fontWeight: 700 }}>{def.display_rating}</div>
              <div style={{ display: "flex", fontSize: 22, color: "#8b8b9e", alignSelf: "flex-end", paddingBottom: 6 }}>community rating</div>
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
