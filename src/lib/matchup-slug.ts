// Canonical matchup slug: character slugs joined by "-vs-", alphabetically ordered
// so (luffy, kaido) and (kaido, luffy) resolve to the same URL. The non-canonical
// order 301-redirects to this one (ratified #22 — one page per character pair).
export function canonicalMatchupSlug(slugA: string, slugB: string): string {
  return [slugA, slugB].sort().join("-vs-");
}

// Parse "luffy-vs-kaido" -> ["kaido", "luffy"] (sorted) plus whether the input
// was already canonical. Returns null if the slug isn't a valid "-vs-" pair.
export function parseMatchupSlug(
  slug: string,
): { a: string; b: string; canonical: string; wasCanonical: boolean } | null {
  const parts = slug.split("-vs-");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [left, right] = parts;
  const canonical = canonicalMatchupSlug(left, right);
  return { a: left, b: right, canonical, wasCanonical: slug === canonical };
}
