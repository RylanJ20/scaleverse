"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level routes that are not verse pages; anything else slug-shaped is a
// verse path (mirrors the guard in src/app/[series]/page.tsx).
const RESERVED = new Set(["login", "choose-username", "u", "api", "auth"]);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Verse-scoped header links. The front door offers nothing but the verse
// selector (founder decision 2026-07-23) — Arena/Tier list/Characters appear
// only once the viewer is inside a verse, and follow that verse's slug.
export function SeriesNav() {
  const pathname = usePathname();
  const seg = pathname.split("/")[1] ?? "";
  if (!seg || RESERVED.has(seg) || seg.length > 64 || !SLUG_RE.test(seg)) return null;

  return (
    <>
      <Link href={`/${seg}/arena`} className="transition hover:text-foreground">
        Arena
      </Link>
      <Link href={`/${seg}/tier-list`} className="transition hover:text-foreground">
        Tier list
      </Link>
      <Link href={`/${seg}/characters`} className="hidden transition hover:text-foreground sm:block">
        Characters
      </Link>
    </>
  );
}
