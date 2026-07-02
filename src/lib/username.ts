// Username rules mirror the DB constraint on profiles.username:
// 3-24 chars, letters/digits/underscore, citext-unique.
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

// Reserved to avoid impersonation and collisions with brand/route names.
const RESERVED = new Set([
  "admin", "administrator", "mod", "moderator", "staff", "root", "support",
  "help", "about", "api", "login", "logout", "signin", "signup", "auth",
  "arena", "tier-list", "tierlist", "vs", "character", "characters", "u",
  "user", "users", "me", "settings", "scaleverse", "official", "system",
  "one-piece", "onepiece", "null", "undefined", "anonymous", "guest",
  "choose-username", "everyone", "team",
]);

export function validateUsername(input: string): { ok: true } | { ok: false; reason: string } {
  const username = input.trim();
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      reason: "Use 3–24 letters, numbers, or underscores.",
    };
  }
  if (RESERVED.has(username.toLowerCase())) {
    return { ok: false, reason: "That username is reserved. Pick another." };
  }
  return { ok: true };
}

export const SYNTHETIC_EMAIL_DOMAIN = "users.scaleverse.app";

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}
