"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { castVote, fetchBatch, recordDemoVote, saveProgress, skipDeal } from "@/app/actions/arena";
import type { ArcOption, MatchupItem } from "@/lib/types";
import { ArcPicker } from "./arc-picker";
import { VersusCard } from "./versus-card";

const DEMO_GATE_AT = 5;
const REVEAL_MS = 1600;

type Phase = "onboarding" | "pick" | "waiting" | "reveal" | "gate" | "empty";

type Reveal = {
  pick: "a" | "b";
  aPct: number | null; // null = too few votes to show a %
  voteCount: number;
  delta: number | null;
};

export function ArenaClient({
  seriesSlug,
  mode,
  initialItems,
  arcs,
  needsOnboarding,
  imageBase,
}: {
  seriesSlug: string;
  mode: "deal" | "demo";
  initialItems: MatchupItem[];
  arcs: ArcOption[];
  needsOnboarding: boolean;
  imageBase: string;
}) {
  const [queue, setQueue] = useState<MatchupItem[]>(initialItems);
  const [phase, setPhase] = useState<Phase>(needsOnboarding ? "onboarding" : initialItems.length ? "pick" : "empty");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [setCount, setSetCount] = useState(0);
  const [demoVotes, setDemoVotes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fetching = useRef(false);
  const sessionId = useRef<string | null>(null);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (mode !== "demo") return;
    const KEY = "sv-demo-session";
    let sid = localStorage.getItem(KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem(KEY, sid);
    }
    sessionId.current = sid;
    setDemoVotes(Number(localStorage.getItem("sv-demo-votes") ?? 0));
  }, [mode]);

  const topUp = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const batch = await fetchBatch(seriesSlug);
      setQueue((q) => {
        const seen = new Set(q.map((i) => i.matchup_id));
        return [...q, ...batch.items.filter((i) => !seen.has(i.matchup_id))];
      });
    } catch {
      // transient; next advance retries
    } finally {
      fetching.current = false;
    }
  }, [seriesSlug]);

  useEffect(() => {
    if (phase !== "onboarding" && queue.length < 4) void topUp();
  }, [queue.length, phase, topUp]);

  const advance = useCallback(() => {
    setReveal(null);
    setError(null);
    setQueue((q) => q.slice(1));
    if (mode === "demo" && demoVotes >= DEMO_GATE_AT && demoVotes % DEMO_GATE_AT === 0) {
      setPhase("gate");
    } else {
      setPhase("pick");
    }
  }, [mode, demoVotes]);

  useEffect(() => {
    if (phase !== "reveal") return;
    const t = setTimeout(advance, REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase, advance]);

  const pick = useCallback(
    async (side: "a" | "b") => {
      if (!current || phase !== "pick") return;
      const winner = side === "a" ? current.a : current.b;
      setPhase("waiting");
      setError(null);
      try {
        if (mode === "deal" && current.deal_id) {
          const res = await castVote(current.deal_id, winner.form_id);
          const aPct = res.vote_count > 0 ? res.a_wins / res.vote_count : null;
          setReveal({
            pick: side,
            aPct: res.vote_count >= 5 ? aPct : null,
            voteCount: res.vote_count,
            delta: res.cosmetic_delta,
          });
        } else {
          const res = await recordDemoVote(current.matchup_id, winner.form_id, sessionId.current ?? "anon");
          const next = demoVotes + 1;
          setDemoVotes(next);
          localStorage.setItem("sv-demo-votes", String(next));
          setReveal({
            pick: side,
            aPct: res.vote_count >= 5 ? res.a_wins / res.vote_count : null,
            voteCount: res.vote_count,
            delta: null,
          });
        }
        setSetCount((n) => n + 1);
        setPhase("reveal");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "something went wrong";
        setError(
          msg.includes("too fast")
            ? "Easy — one fight at a time."
            : msg.includes("rate limit")
              ? "You've hit the hourly vote limit. Take a break, captain."
              : "That vote didn't land. Try again.",
        );
        setPhase("pick");
      }
    },
    [current, phase, mode, demoVotes],
  );

  const skip = useCallback(async () => {
    if (!current || phase !== "pick") return;
    if (mode === "deal" && current.deal_id) void skipDeal(current.deal_id);
    advance();
  }, [current, phase, mode, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === "reveal") {
        advance();
        return;
      }
      if (e.key === "ArrowLeft") void pick("a");
      if (e.key === "ArrowRight") void pick("b");
      if (e.key === "ArrowDown") void skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, skip, advance, phase]);

  if (phase === "onboarding") {
    return (
      <ArcPicker
        arcs={arcs}
        onChoose={async (choice) => {
          await saveProgress(seriesSlug, choice);
          window.location.reload();
        }}
      />
    );
  }

  if (phase === "gate") {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-2">
          {demoVotes} votes cast
        </p>
        <h2 className="font-display -skew-x-6 text-3xl uppercase">
          Make your votes <span className="text-accent">count</span>
        </h2>
        <p className="text-sm text-muted">
          You&apos;re playing as a guest — these votes don&apos;t move the rankings. Sign in and
          get on the record.
        </p>
        <Link
          href="/login"
          className="rounded-md bg-accent px-6 py-3 font-bold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Sign in
        </Link>
        <button type="button" onClick={advance} className="text-sm text-muted underline-offset-4 hover:underline">
          Keep playing as guest
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display -skew-x-6 text-2xl uppercase">No fights available</h2>
        <p className="text-sm text-muted">
          You may have voted everything your spoiler setting allows. Advance your arc progress, or
          come back after the next roster wave.
        </p>
      </div>
    );
  }

  const aPctDisplay = reveal?.aPct != null ? Math.round(reveal.aPct * 100) : null;
  const myPct =
    reveal && aPctDisplay != null ? (reveal.pick === "a" ? aPctDisplay : 100 - aPctDisplay) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
      <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
        <span>
          Set {Math.floor(setCount / 10) + 1} · fight {(setCount % 10) + 1}/10
        </span>
        <span className="hidden sm:block">← left wins · right wins → · ↓ can&apos;t call it</span>
      </div>

      <h1 className="font-display -skew-x-6 mb-5 text-center text-3xl uppercase sm:text-4xl">
        Who <span className="text-accent">wins</span>?
      </h1>

      <div className="relative grid grid-cols-2 gap-3 sm:gap-6">
        <VersusCard
          card={current.a}
          side="a"
          imageUrl={current.a.image_path ? `${imageBase}/${current.a.image_path}` : null}
          onPick={() => void pick("a")}
          disabled={phase !== "pick"}
          picked={reveal?.pick === "a"}
        />
        <VersusCard
          card={current.b}
          side="b"
          imageUrl={current.b.image_path ? `${imageBase}/${current.b.image_path}` : null}
          onPick={() => void pick("b")}
          disabled={phase !== "pick"}
          picked={reveal?.pick === "b"}
        />
        <div
          aria-hidden
          className="font-display pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 -skew-x-12 rounded bg-background px-3 py-1.5 text-2xl uppercase"
          style={{ textShadow: "0 0 24px rgba(225,29,72,0.7)" }}
        >
          vs
        </div>
      </div>

      <div className="mt-5 min-h-24" aria-live="polite">
        {phase === "reveal" && reveal && (
          <button type="button" onClick={advance} className="block w-full text-left">
            {aPctDisplay != null ? (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full bg-accent transition-all duration-500"
                    style={{ width: `${aPctDisplay}%` }}
                  />
                  <div
                    className="h-full bg-accent-2 transition-all duration-500"
                    style={{ width: `${100 - aPctDisplay}%` }}
                  />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="font-mono text-sm text-accent">{aPctDisplay}%</span>
                  <p className="text-center text-sm">
                    {myPct != null && myPct >= 50 ? (
                      <span className="text-muted">With the crowd</span>
                    ) : (
                      <span className="font-bold text-accent-2">
                        Hot take — only {myPct}% agree
                      </span>
                    )}
                    {reveal.delta != null && (
                      <span className="ml-2 font-mono text-xs text-muted">+{reveal.delta}</span>
                    )}
                  </p>
                  <span className="font-mono text-sm text-accent-2">{100 - (aPctDisplay ?? 0)}%</span>
                </div>
              </>
            ) : (
              <p className="text-center text-sm text-muted">
                Early votes — results still forming ({reveal.voteCount} vote
                {reveal.voteCount === 1 ? "" : "s"})
              </p>
            )}
          </button>
        )}
        {phase === "pick" && (
          <div className="flex flex-col items-center gap-2">
            {error && <p className="text-sm text-accent">{error}</p>}
            <button
              type="button"
              onClick={() => void skip()}
              className="text-sm text-muted underline-offset-4 transition hover:text-foreground hover:underline"
            >
              Can&apos;t call it — skip
            </button>
          </div>
        )}
        {phase === "waiting" && <p className="text-center font-mono text-xs text-muted">…</p>}
      </div>
    </div>
  );
}
