"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export type RosterEntry = {
  slug: string;
  name: string;
  epithet: string | null;
  image_url: string | null;
  rating: number;
  tier: string | null;
};

type Sort = "rating" | "alpha";

export function RosterGrid({ series, entries }: { series: string; entries: RosterEntry[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("rating");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) => e.name.toLowerCase().includes(q) || e.epithet?.toLowerCase().includes(q),
        )
      : entries;
    const sorted = [...filtered].sort((a, b) =>
      sort === "rating" ? b.rating - a.rating : a.name.localeCompare(b.name),
    );
    return sorted;
  }, [entries, query, sort]);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search characters…"
          className="flex-1 rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
        />
        <div className="flex gap-1 rounded-md border border-white/10 p-1 text-sm">
          <button
            type="button"
            onClick={() => setSort("rating")}
            className={`rounded px-3 py-1.5 transition ${sort === "rating" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            By rating
          </button>
          <button
            type="button"
            onClick={() => setSort("alpha")}
            className={`rounded px-3 py-1.5 transition ${sort === "alpha" ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
          >
            A–Z
          </button>
        </div>
      </div>

      <p className="mb-3 font-mono text-xs text-muted">{shown.length} characters</p>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">No characters match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {shown.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/${series}/characters/${e.slug}`}
                className="block rounded-lg border border-white/5 bg-surface p-1.5 transition hover:border-white/20"
              >
                <div className="relative aspect-square overflow-hidden rounded bg-black/40">
                  {e.image_url && (
                    <Image
                      src={e.image_url}
                      alt={e.name}
                      fill
                      sizes="120px"
                      className="object-cover object-top"
                    />
                  )}
                  {e.tier && (
                    <span
                      className="font-display absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-xs text-black"
                      style={{ backgroundColor: `var(--color-tier-${e.tier.toLowerCase()})` }}
                    >
                      {e.tier}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-center text-[11px] leading-tight">{e.name}</p>
                <p className="text-center font-mono text-[10px] text-muted">{e.rating}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
