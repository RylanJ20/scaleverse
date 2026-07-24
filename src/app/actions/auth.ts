"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateUsername, SYNTHETIC_EMAIL_DOMAIN } from "@/lib/username";
import { authGuard, recordAuthAttempt, verifyTurnstile } from "@/lib/auth-guard";
import { isDisposableEmail } from "@/lib/disposable-domains";

type Result = { ok: true } | { ok: false; error: string };

export async function checkUsername(username: string): Promise<Result> {
  const v = validateUsername(username);
  if (!v.ok) return { ok: false, error: v.reason };
  if (!(await authGuard("check_username", 60))) {
    return { ok: false, error: "Too many checks — slow down a moment." };
  }
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  return data ? { ok: false, error: "That username is taken." } : { ok: true };
}

export async function signUpWithUsername(
  username: string,
  password: string,
  email?: string,
  turnstileToken?: string,
): Promise<Result> {
  // Cheap local checks first — a bad password or throwaway email must never
  // consume the Turnstile token or a per-IP signup slot.
  const v = validateUsername(username);
  if (!v.ok) return { ok: false, error: v.reason };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (email?.trim() && isDisposableEmail(email.trim())) {
    return { ok: false, error: "That looks like a throwaway email — use one you'll keep." };
  }

  // integrity floor (plan): Turnstile on signup + per-IP cap. Turnstile is
  // verified (which redeems the single-use token) only once the cheap checks
  // pass, so a client can reuse a fresh token on a corrected resubmit.
  if (!(await verifyTurnstile(turnstileToken))) {
    return { ok: false, error: "Verification didn't go through — try again." };
  }
  if (!(await authGuard("signup", 3))) {
    return { ok: false, error: "Too many new accounts from your network — try again later." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return { ok: false, error: "That username is taken." };

  const recoveryEmail = email?.trim().toLowerCase();
  const authEmail = recoveryEmail || `${crypto.randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`;

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true, // recovery email is unverified by design; login never needs confirmation
    user_metadata: { has_recovery_email: !!recoveryEmail },
  });
  if (cErr || !created?.user) {
    if (cErr && /already been registered|already registered|exists/i.test(cErr.message)) {
      return { ok: false, error: "That email already has an account." };
    }
    return { ok: false, error: "Could not create your account. Try again." };
  }

  const { error: uErr } = await admin.from("profiles").update({ username }).eq("id", created.user.id);
  if (uErr) {
    // roll back the orphaned auth user so the username stays free
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "That username was just taken. Pick another." };
  }

  const supabase = await createClient();
  const { error: sErr } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (sErr) return { ok: false, error: "Account created — please sign in." };
  return { ok: true };
}

export async function signInWithUsername(username: string, password: string): Promise<Result> {
  // GoTrue's own IP throttle only ever sees Vercel egress IPs, so this per-
  // client cap is the credential-stuffing wall. Count only FAILED attempts
  // (consume=false checks without recording) so shared IPs — CGNAT, dorms,
  // watch parties — aren't locked out by legitimate successful sign-ins.
  if (!(await authGuard("signin", 20, false))) {
    return { ok: false, error: "Too many attempts — wait a few minutes." };
  }
  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  // uniform error to avoid revealing which usernames exist
  const invalid = { ok: false, error: "Invalid username or password." } as const;
  if (!prof) {
    await recordAuthAttempt("signin");
    return invalid;
  }

  const { data: u } = await admin.auth.admin.getUserById(prof.id);
  const email = u?.user?.email;
  if (!email) {
    await recordAuthAttempt("signin");
    return invalid;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await recordAuthAttempt("signin");
    return invalid;
  }
  return { ok: true };
}

// Used by OAuth (Discord) users, who arrive with an email but no username.
export async function setUsername(username: string): Promise<Result> {
  const v = validateUsername(username);
  if (!v.ok) return { ok: false, error: v.reason };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing && existing.id !== user.id) return { ok: false, error: "That username is taken." };

  // RLS grants the owner update(username); the unique index catches a race
  const { error } = await supabase.from("profiles").update({ username }).eq("id", user.id);
  if (error) return { ok: false, error: "That username was just taken. Pick another." };
  // a pre-claim visit may have cached /u/<name> as not-found — clear it
  updateTag(`profile:${username}`);
  return { ok: true };
}
