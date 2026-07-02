"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { setUsername } from "@/app/actions/auth";

function ChooseUsernameForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/one-piece/arena";
  const [username, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await setUsername(username);
    if (res.ok) window.location.assign(next);
    else {
      setMessage(res.error);
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display -skew-x-6 text-3xl uppercase">
        Pick your <span className="text-accent">handle</span>
      </h1>
      <p className="mt-2 text-sm text-muted">
        This is how you&apos;ll show up on the leaderboards and your take record. Choose carefully —
        it&apos;s your name in every debate.
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
        <input
          type="text"
          required
          autoFocus
          value={username}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Username"
          className="rounded-md border border-white/15 bg-surface px-3 py-2.5 outline-none transition focus:border-accent-2"
        />
        <p className="text-xs text-muted">3–24 letters, numbers, or underscores.</p>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2.5 font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50"
        >
          Claim it
        </button>
      </form>
      {message && <p className="mt-3 text-sm text-accent-2">{message}</p>}
    </div>
  );
}

export default function ChooseUsernamePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense>
        <ChooseUsernameForm />
      </Suspense>
    </main>
  );
}
