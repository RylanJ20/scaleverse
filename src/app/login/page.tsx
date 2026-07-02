"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
      else window.location.assign("/one-piece/arena");
    } else {
      const { error, data } = await supabase.auth.signUp({ email, password });
      if (error) setMessage(error.message);
      else if (data.session) window.location.assign("/one-piece/arena");
      else setMessage("Check your email to confirm your account.");
    }
    setBusy(false);
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
          or with email
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submitEmail} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
          />
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
          />
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
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 text-sm text-muted underline-offset-4 hover:underline"
        >
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
