import { ImageResponse } from "next/og";
import { getCharacter, getMatchupTally, formToCard } from "@/lib/queries";
import { createPublicClient } from "@/lib/supabase/public";
import { characterPngDataUri } from "@/lib/og-image";
import { parseMatchupSlug } from "@/lib/matchup-slug";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Matchup on Scaleverse";

export default async function OgImage({
  params,
}: {
  params: Promise<{ series: string; slug: string }>;
}) {
  const { series, slug } = await params;
  const parsed = parseMatchupSlug(slug);
  const db = createPublicClient();
  const [charA, charB] = parsed
    ? await Promise.all([getCharacter(series, parsed.a, db), getCharacter(series, parsed.b, db)])
    : [null, null];

  const defA = charA?.forms.find((f) => f.is_default) ?? charA?.forms[0];
  const defB = charB?.forms.find((f) => f.is_default) ?? charB?.forms[0];

  let aPct: number | null = null;
  let voteCount = 0;
  if (charA && charB && defA && defB) {
    const t = await getMatchupTally(defA, defB, formToCard(defA, charA), formToCard(defB, charB), db);
    voteCount = t.vote_count;
    aPct = voteCount > 0 ? Math.round((t.a_wins / voteCount) * 100) : null;
  }

  const bg = "#0a0a12";
  const red = "#e11d48";
  const cyan = "#22d3ee";
  const [imgA, imgB] = await Promise.all([
    characterPngDataUri(defA?.image_path, 600),
    characterPngDataUri(defB?.image_path, 600),
  ]);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: bg, position: "relative" }}>
        {/* two fighters */}
        {[
          { img: imgA, name: charA?.name ?? "?", color: red, align: "flex-start" as const },
          { img: imgB, name: charB?.name ?? "?", color: cyan, align: "flex-end" as const },
        ].map((f, i) => (
          <div key={i} style={{ display: "flex", width: "50%", height: "100%", position: "relative" }}>
            {f.img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.img} width={600} height={630} style={{ objectFit: "cover", objectPosition: "top" }} alt="" />
            )}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                background:
                  i === 0
                    ? "linear-gradient(to right, rgba(10,10,18,0.1), rgba(10,10,18,0.85))"
                    : "linear-gradient(to left, rgba(10,10,18,0.1), rgba(10,10,18,0.85))",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 90,
                [i === 0 ? "left" : "right"]: 48,
                display: "flex",
                fontSize: 52,
                fontWeight: 900,
                fontStyle: "italic",
                color: "white",
                textTransform: "uppercase",
                maxWidth: 440,
                lineHeight: 1,
                borderBottom: `6px solid ${f.color}`,
                paddingBottom: 12,
              }}
            >
              {f.name}
            </div>
          </div>
        ))}

        {/* center VS */}
        <div
          style={{
            position: "absolute",
            top: "42%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            fontSize: 90,
            fontWeight: 900,
            fontStyle: "italic",
            color: "white",
            background: bg,
            padding: "8px 24px",
            borderRadius: 12,
          }}
        >
          VS
        </div>

        {/* result bar or prompt */}
        <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", display: "flex", flexDirection: "column" }}>
          {aPct != null ? (
            <div style={{ display: "flex", width: "100%", height: 48 }}>
              <div style={{ display: "flex", width: `${aPct}%`, background: red, alignItems: "center", paddingLeft: 20, color: "white", fontSize: 26, fontWeight: 700 }}>
                {aPct}%
              </div>
              <div style={{ display: "flex", width: `${100 - aPct}%`, background: cyan, alignItems: "center", justifyContent: "flex-end", paddingRight: 20, color: "#04222a", fontSize: 26, fontWeight: 700 }}>
                {100 - aPct}%
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", width: "100%", height: 48, background: red, alignItems: "center", justifyContent: "center", color: "white", fontSize: 26, fontWeight: 700 }}>
              WHO WINS? VOTE NOW
            </div>
          )}
        </div>

        {/* wordmark */}
        <div style={{ position: "absolute", top: 28, left: 40, display: "flex", fontSize: 30, fontWeight: 900, fontStyle: "italic", color: "white", textTransform: "uppercase" }}>
          SCALE<span style={{ color: red }}>VERSE</span>
        </div>
      </div>
    ),
    size,
  );
}
