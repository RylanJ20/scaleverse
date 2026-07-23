"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgress } from "@/app/actions/arena";
import type { ArcOption } from "@/lib/types";

export type SeriesSpoilerSetting = {
  slug: string;
  name: string;
  arcs: ArcOption[];
  current: string | null; // "all" = caught up, arc slug, or null = never set
};

// Owner-only card on the profile page — the "change this anytime" the arc
// picker promises. Matchups and tier lists never show past this setting.
export function SpoilerSettings({ series }: { series: SeriesSpoilerSetting[] }) {
  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent-2">
          Spoiler settings
        </h2>
        <span className="text-[10px] text-muted">Only you see this</span>
      </div>
      <ul className="mt-4 space-y-4">
        {series.map((s) => (
          <SeriesRow key={s.slug} series={s} />
        ))}
      </ul>
    </section>
  );
}

function SeriesRow({ series }: { series: SeriesSpoilerSetting }) {
  const router = useRouter();
  const [value, setValue] = useState(series.current ?? "all");
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = value !== (series.current ?? "all");

  const save = () =>
    startTransition(async () => {
      setFailed(false);
      try {
        await saveProgress(series.slug, value === "all" ? { caughtUp: true } : { arcSlug: value });
        setSaved(true);
        router.refresh();
      } catch {
        setFailed(true);
      }
    });

  return (
    <li>
      <label htmlFor={`spoiler-${series.slug}`} className="text-sm">
        {series.name} — show characters through
      </label>
      <div className="mt-2 flex items-center gap-2">
        <select
          id={`spoiler-${series.slug}`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-background px-3 py-2 text-sm"
        >
          <option value="all">I&apos;m caught up — show everything</option>
          {series.arcs.map((a) => (
            <option key={a.slug} value={a.slug}>
              #{a.position} · {a.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {saved && !dirty && <p className="mt-1.5 font-mono text-xs text-accent-2">Saved</p>}
      {failed && <p className="mt-1.5 text-sm text-accent">Couldn&apos;t save that. Try again.</p>}
    </li>
  );
}
