"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkUsername, signInWithUsername, signUpWithUsername } from "@/app/actions/auth";

type Mode = "signin" | "signup";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; theme?: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string;
      reset: (id: string) => void;
    };
  }
}

// Signup-only bot check (integrity floor — never inside the voting loop).
// Renders nothing until NEXT_PUBLIC_TURNSTILE_SITE_KEY exists.
function TurnstileWidget({
  onToken,
  onError,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  onError: () => void;
  resetSignal: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    const el = ref.current;
    const render = () => {
      if (window.turnstile && el.childElementCount === 0) {
        widgetId.current = window.turnstile.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          callback: onToken,
          "expired-callback": () => onToken(null),
          "error-callback": onError,
        });
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    s.onerror = onError; // adblocked / offline — surface a message, don't hang
    document.head.appendChild(s);
  }, [onToken, onError]);
  // a consumed token can't be reused — reset the widget after a failed submit
  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onToken(null);
    }
  }, [resetSignal, onToken]);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className="min-h-16" />;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState(false);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [usernameTaken, setUsernameTaken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onTurnstileError = useCallback(() => setTurnstileError(true), []);

  // live availability so a taken name is caught before it burns a signup slot
  const onUsernameBlur = async () => {
    if (mode !== "signup" || username.trim().length < 3) {
      setUsernameTaken(null);
      return;
    }
    const res = await checkUsername(username.trim());
    setUsernameTaken(res.ok ? null : res.error);
  };

  const needsToken = mode === "signup" && !!TURNSTILE_SITE_KEY;

  const discordSignIn = async () => {
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
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
        : await signUpWithUsername(username, password, email || undefined, turnstileToken ?? undefined);
    if (res.ok) {
      window.location.assign("/one-piece/arena");
    } else {
      setMessage(res.error);
      setBusy(false);
      // the submitted Turnstile token is now spent — force a fresh challenge
      if (needsToken) {
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      }
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

        <div className="mt-6">
          <button
            type="button"
            onClick={() => void discordSignIn()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#5865F2] px-4 py-2.5 font-medium text-white transition hover:brightness-110"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
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
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameTaken(null);
            }}
            onBlur={() => void onUsernameBlur()}
            placeholder="Username"
            className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
          />
          {mode === "signup" && usernameTaken && (
            <p className="-mt-1 text-xs text-accent-text">{usernameTaken}</p>
          )}
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
                placeholder="Recovery email"
                className="w-full rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
              />
              <p className="mt-1 text-xs">
                <span className="text-accent-2">Strongly recommended.</span>{" "}
                <span className="text-muted">
                  Without it, your record dies with a lost password — no email, no recovery, ever.
                </span>
              </p>
            </div>
          )}
          {mode === "signup" && (
            <TurnstileWidget
              onToken={setTurnstileToken}
              onError={onTurnstileError}
              resetSignal={turnstileReset}
            />
          )}
          {mode === "signup" && turnstileError && (
            <p className="-mt-1 text-xs text-accent-text">
              Couldn&apos;t load the verification check — disable your ad blocker for this page and
              reload.
            </p>
          )}
          <button
            type="submit"
            disabled={busy || (needsToken && !turnstileToken) || (mode === "signup" && !!usernameTaken)}
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
