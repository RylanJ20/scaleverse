import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchBatch, getProgress } from "@/app/actions/arena";
import { getCachedArcs } from "@/lib/cached";
import { ArenaClient } from "@/components/arena/arena-client";
import { IMAGE_BASE } from "@/lib/image";
import type { Batch } from "@/lib/types";

export const metadata: Metadata = {
  title: "Arena",
};

// Fully per-request (auth, spoiler gate, server-dealt matchups) — the arena is
// the one surface that must never be cached. Suspense satisfies PPR.
export default function ArenaPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<div className="flex flex-1 items-center justify-center font-mono text-xs text-muted">…</div>}>
        <ArenaBody params={params} />
      </Suspense>
    </main>
  );
}

async function ArenaBody({ params }: { params: Promise<{ series: string }> }) {
  const { series } = await params;

  // arcs are static content — the shared cached read, in parallel with the gate
  const [progress, arcs] = await Promise.all([getProgress(series), getCachedArcs(series)]);

  // a dealing failure must degrade to a retry state, never crash the page
  let batch: Batch = { mode: "demo", items: [] };
  let loadFailed = false;
  if (progress.chosen) {
    try {
      batch = await fetchBatch(series);
    } catch {
      loadFailed = true;
    }
  }

  const gateArc =
    progress.maxArcPosition === null
      ? null
      : arcs.find((a) => a.position === progress.maxArcPosition) ?? null;

  return (
    <ArenaClient
      seriesSlug={series}
      mode={batch.mode}
      initialItems={batch.items}
      arcs={arcs}
      needsOnboarding={!progress.chosen}
      initialError={loadFailed}
      gateArc={gateArc}
      imageBase={IMAGE_BASE}
    />
  );
}
