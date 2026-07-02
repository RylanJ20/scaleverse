export function formatBounty(bounty: number | null | undefined): string | null {
  if (bounty == null) return null;
  if (bounty === 0) return "Unknown / none";
  return `Ƀ${bounty.toLocaleString()}`;
}

export function hakiList(
  haki: { conqueror: boolean; armament: boolean; observation: boolean } | null | undefined,
): string | null {
  if (!haki) return null;
  const types = [
    haki.conqueror && "Conqueror's",
    haki.armament && "Armament",
    haki.observation && "Observation",
  ].filter(Boolean);
  return types.length ? types.join(", ") : "None shown";
}
