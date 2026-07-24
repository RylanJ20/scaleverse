"use client";

import { saveProgress } from "@/app/actions/arena";
import { ArcPicker } from "@/components/arena/arc-picker";
import type { ArcOption } from "@/lib/types";

// First-touch spoiler gate for browse surfaces (tier list, characters index).
// The page is server-rendered in full underneath (crawlers see everything —
// the SEO surface is untouched); a first-touch human chooses an arc before the
// UI reveals it. "I'm caught up" is one tap; the choice lands in the same
// cookie the whole app reads.
export function FirstTouchGate({ arcs, seriesSlug }: { arcs: ArcOption[]; seriesSlug: string }) {
  return (
    <ArcPicker
      arcs={arcs}
      onChoose={async (choice) => {
        await saveProgress(seriesSlug, choice);
        window.location.reload();
      }}
    />
  );
}
