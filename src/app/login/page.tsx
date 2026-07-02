"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signInWithUsername, signUpWithUsername } from "@/app/actions/auth";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauth = async (provider: "google" | "discord") => {
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/one-piece/arena` },
    });
    if (error) setMessage(error.message);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res =
      mode === "signin"
        ? await signInWithUsername(username, password)
        : await signUpWithUsername(username, password, email || undefined);
    if (res.ok) {
      window.location.assign("/one-piece/arena");
    } else {
      setMessage(res.error);
      setBusy(false);
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display -skew-x-6 text-3xl uppercase">
          Get on the <span className="text-accent">record</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          Signed-in votes count toward the community rankings. Guest votes never do.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void oauth("google")}
            className="rounded-md border border-white/15 px-4 py-2.5 font-medium transition hover:border-white/30"
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => void oauth("discord")}
            className="rounded-md border border-white/15 px-4 py-2.5 font-medium transition hover:border-white/30"
          >
            Continue with Discord
          </button>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-white/10" />
          or with a username
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signin" ? "Password" : "Password (8+ characters)"}
            className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
          />
          {mode === "signup" && (
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Recovery email (optional)"
                className="w-full rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
              />
              <p className="mt-1 text-xs text-muted">
                Only used to reset a forgotten password. Skip it if you want — but without it, a
                lost password can&apos;t be recovered.
              </p>
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2.5 font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {message && <p className="mt-3 text-sm text-accent-2">{message}</p>}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMessage(null);
          }}
          className="mt-4 text-sm text-muted underline-offset-4 hover:underline"
        >
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
