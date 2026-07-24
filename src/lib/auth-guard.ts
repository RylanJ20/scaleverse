import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

let warnedNoSalt = false;

// Salted client-IP hash (plan: never store raw IPs; 90-day retention lives in
// the auth_guard SQL). Server actions run on Vercel, which OVERWRITES
// x-forwarded-for with the observed client IP (so its first entry isn't
// attacker-spoofable), making it the only trustworthy view of the client.
async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const salt = process.env.AUTH_IP_SALT || process.env.FIT_SECRET;
  if (!salt && !warnedNoSalt) {
    warnedNoSalt = true;
    // an unsalted sha256(ip) is reversible over the IPv4 space — surface the
    // misconfiguration instead of silently storing near-raw IPs
    console.warn("auth-guard: no AUTH_IP_SALT/FIT_SECRET set — ip_hash is weakly salted");
  }
  return createHash("sha256").update(`${salt ?? "sv-unsalted"}:${ip}`).digest("hex");
}

// Per-IP rate gate. FAILS OPEN on guard outages: a broken limiter must not lock
// real people out (the ceilings are defense in depth, not the only wall).
// consume=false checks the cap without recording (pair with recordAuthAttempt
// so only failures count — see sign-in).
export async function authGuard(
  kind: "signup" | "signin" | "check_username",
  maxPerHour: number,
  consume = true,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("auth_guard", {
      p_ip_hash: await clientIpHash(),
      p_kind: kind,
      p_max_per_hour: maxPerHour,
      p_consume: consume,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

export async function recordAuthAttempt(kind: "signup" | "signin" | "check_username"): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("auth_record", { p_ip_hash: await clientIpHash(), p_kind: kind });
  } catch {
    // best-effort — a missed record only loosens the cap slightly
  }
}

// Turnstile is CONFIGURED only when BOTH the server secret and the public site
// key are set — otherwise the widget can't render, so enforcing server-side
// would fail every signup closed with no visible challenge. Unconfigured =
// pass-through; fully configured = fail closed on any verify error.
export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

export async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  if (!turnstileConfigured()) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await res.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
