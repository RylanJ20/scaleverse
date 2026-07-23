import type { Metadata } from "next";
import { fetchBatch, hasChosenProgress } from "@/app/actions/arena";
import { createClient } from "@/lib/supabase/server";
import { ArenaClient } from "@/components/arena/arena-client";
import { IMAGE_BASE } from "@/lib/image";
import type { ArcOption } from "@/lib/types";

export const metadata: Metadata = {
  title: "Arena",
};

export default async function ArenaPage({
  params,
}: {
  params: Promise<{ series: string }>;
}) {
  const { series } = await params;
  const supabase = await createClient();

  const chosen = await hasChosenProgress(series);
  const { data: arcData } = await supabase
    .from("arcs")
    .select("slug, name, position, series!inner(slug)")
    .eq("series.slug", series)
    .order("position");
  const arcs: ArcOption[] = (arcData ?? []).map(({ slug, name, position }) => ({ slug, name, position }));

  const batch = chosen ? await fetchBatch(series) : { mode: "demo" as const, items: [] };

  return (
    <main className="flex flex-1 flex-col">
      <ArenaClient
        seriesSlug={series}
        mode={batch.mode}
        initialItems={batch.items}
        arcs={arcs}
        needsOnboarding={!chosen}
        imageBase={IMAGE_BASE}
      />
    </main>
  );
}
