import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateUsername } from "@/lib/username";

// Coerce a raw Discord name into our username charset: [A-Za-z0-9_], 3–24 chars.
function sanitize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_]/g, "_") // spaces, dots, emoji, etc. → _
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

// Discord metadata field names vary by GoTrue version; try the handle first,
// then the display name.
function rawCandidate(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const custom = meta.custom_claims as Record<string, unknown> | undefined;
  const candidate =
    meta.preferred_username ??
    meta.user_name ??
    meta.nickname ??
    custom?.global_name ??
    meta.name ??
    meta.full_name;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

// Try to auto-assign a username derived from the user's Discord handle. Returns
// the claimed username, or null if none could be claimed (caller should then
// fall back to the manual /choose-username picker).
export async function autoAssignDiscordUsername(
  userId: string,
  meta: Record<string, unknown> | undefined,
): Promise<string | null> {
  const raw = rawCandidate(meta);
  if (!raw) return null;

  let base = sanitize(raw);
  if (base.length > 0 && base.length < 3) base = `${base}_op`.slice(0, 24); // pad very short handles

  // base, then base2, base3… (trimming to leave room for the digit)
  const candidates: string[] = [];
  if (base) {
    candidates.push(base);
    for (let i = 2; i <= 8; i++) candidates.push(`${base.slice(0, 23)}${i}`);
  }

  const admin = createAdminClient();
  for (const c of candidates) {
    if (!validateUsername(c).ok) continue; // skips reserved / malformed
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("username", c)
      .maybeSingle();
    if (existing) continue;
    const { error } = await admin.from("profiles").update({ username: c }).eq("id", userId);
    if (!error) return c;
    // unique-constraint race → try the next candidate
  }
  return null;
}
