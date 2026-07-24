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

  const items = [
    { href: `/${seg}/arena`, label: "Arena" },
    { href: `/${seg}/tier-list`, label: "Tier list" },
    { href: `/${seg}/characters`, label: "Characters", desktopOnly: true },
  ];

  return (
    <>
      {items.map(({ href, label, desktopOnly }) => {
        // subpages count: /one-piece/characters/luffy still highlights Characters
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${desktopOnly ? "hidden sm:block " : ""}transition ${
              active
                ? "text-foreground underline decoration-accent decoration-2 underline-offset-8"
                : "hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
