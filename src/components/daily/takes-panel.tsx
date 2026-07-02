"use client";

import { useState } from "react";
import Link from "next/link";
import { postTake, type Take } from "@/app/actions/social";

export function TakesPanel({
  matchupId,
  takes,
  myTake,
  isAuthed,
}: {
  matchupId: string;
  takes: Take[];
  myTake: string | null;
  isAuthed: boolean;
}) {
  const [body, setBody] = useState(myTake ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await postTake(matchupId, body);
    if (res.ok) {
      setPosted(true);
      setMessage("Take posted.");
    } else {
      setMessage(res.error);
    }
    setBusy(false);
  };

  const remaining = 140 - body.length;

  return (
    <div>
      <h3 className="font-display -skew-x-6 mb-3 text-lg uppercase">
        Defend your <span className="text-accent-2">pick</span>
      </h3>

      {isAuthed ? (
        <form onSubmit={submit} className="mb-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 140))}
            rows={2}
            placeholder="Why does your fighter win? (140 characters)"
            className="w-full resize-none rounded-md border border-white/15 bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent-2"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className={`font-mono text-xs ${remaining < 0 ? "text-accent" : "text-muted"}`}>
              {remaining}
            </span>
            <button
              type="submit"
              disabled={busy || body.trim().length === 0}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {myTake && !posted ? "Update take" : "Post take"}
            </button>
          </div>
          {message && <p className="mt-1 text-xs text-accent-2">{message}</p>}
        </form>
      ) : (
        <p className="mb-4 text-sm text-muted">
          <Link href="/login" className="text-accent-2 underline-offset-4 hover:underline">
            Sign in
          </Link>{" "}
          to add your take.
        </p>
      )}

      {takes.length === 0 ? (
        <p className="text-sm text-muted">No takes yet. Be the first to make the case.</p>
      ) : (
        <ul className="space-y-2">
          {takes.map((t) => (
            <li key={t.id} className="rounded-lg border border-white/5 bg-surface p-3">
              <p className="text-sm">{t.body}</p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {t.username ? (
                  <Link href={`/u/${t.username}`} className="hover:text-accent-2">
                    @{t.username}
                  </Link>
                ) : (
                  "someone"
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
