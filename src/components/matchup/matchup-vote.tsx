"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { voteOnMatchup } from "@/app/actions/arena";
import type { FormCard } from "@/lib/types";

type Props = {
  a: FormCard;
  b: FormCard;
  imageBase: string;
  initialVoteCount: number;
  initialAWins: number;
  matchupId: string | null;
};

export function MatchupVote({ a, b, imageBase, initialVoteCount, initialAWins, matchupId }: Props) {
  const [voteCount, setVoteCount] = useState(initialVoteCount);
  const [aWins, setAWins] = useState(initialAWins);
  const [pick, setPick] = useState<string | null>(null);
  // null = still resolving auth; keeps the page cacheable (auth is client-only)
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setAuthed(!!user);
      if (!user) return;
      // The server tally can be minutes stale (cached page). If it predates the
      // matchup row, resolve the live row by pair so a just-cast vote — and its
      // pick highlight — never "vanishes" on reload. Signed-in viewers only, so
      // anonymous traffic stays read-free.
      let id = matchupId;
      if (!id) {
        const [lo, hi] = [a.form_id, b.form_id].sort();
        const { data: m } = await supabase
          .from("matchups")
          .select("id, vote_count, a_wins")
          .eq("form_a_id", lo)
          .eq("form_b_id", hi)
          .maybeSingle();
        if (cancelled) return;
        if (m) {
          id = m.id;
          setVoteCount(m.vote_count);
          setAWins(a.form_id === lo ? m.a_wins : m.vote_count - m.a_wins);
        }
      }
      if (id) {
        const { data } = await supabase
          .from("votes")
          .select("winner_form_id")
          .eq("matchup_id", id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setPick(data?.winner_form_id ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchupId, a.form_id, b.form_id]);

  const aPct = voteCount > 0 ? Math.round((aWins / voteCount) * 100) : null;

  const vote = async (winner: FormCard) => {
    if (busy || authed !== true || pick === winner.form_id) return;
    setBusy(true);
    setError(null);
    try {
      // typed outcome codes — production redacts thrown server-action messages,
      // so error classification must never rely on message strings
      const out = await voteOnMatchup(a.form_id, b.form_id, winner.form_id);
      if (out.ok) {
        setVoteCount(out.result.vote_count);
        const aIsLow = a.form_id < b.form_id;
        setAWins(aIsLow ? out.result.a_wins : out.result.vote_count - out.result.a_wins);
        setPick(winner.form_id);
      } else {
        setError(
          out.code === "too_fast"
            ? "Slow down a moment."
            : out.code === "revote_limit"
              ? "You can only change this pick once a week."
              : out.code === "rate_limit"
                ? "You've hit the vote limit for now."
                : "That vote didn't land. Try again.",
        );
      }
    } catch {
      setError("That vote didn't land. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const Card = ({ card, side }: { card: FormCard; side: "a" | "b" }) => {
    const color = side === "a" ? "var(--accent)" : "var(--accent-2)";
    const picked = pick === card.form_id;
    const url = card.image_path ? `${imageBase}/${card.image_path}` : null;
    return (
      <button
        type="button"
        onClick={() => void vote(card)}
        disabled={busy || authed !== true}
        aria-label={`${card.character_name} wins`}
        className={`group relative flex flex-col self-start overflow-hidden rounded-lg border bg-surface text-left transition ${
          picked ? "scale-[1.02]" : authed === true ? "hover:scale-[1.01]" : ""
        } ${authed !== true ? "cursor-default" : ""}`}
        style={{
          borderColor: picked ? color : "rgba(255,255,255,0.08)",
          boxShadow: picked ? `0 0 32px -8px ${color}` : undefined,
        }}
      >
        <div className="relative aspect-[3/4] w-full bg-black/40">
          {url && (
            <Image
              src={url}
              alt={card.character_name}
              fill
              sizes="(max-width: 640px) 40vw, 300px"
              className="object-cover object-top"
            />
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{ background: "linear-gradient(to top, rgba(10,10,18,0.95), transparent)" }}
          />
        </div>
        <div className="p-3">
          {card.epithet && (
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              {card.epithet}
            </p>
          )}
          <p className="font-display -skew-x-6 truncate text-lg uppercase leading-tight">
            {card.character_name}
          </p>
        </div>
      </button>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <Card card={a} side="a" />
        <div aria-hidden className="font-display -skew-x-12 text-xl uppercase text-muted sm:text-2xl">
          vs
        </div>
        <Card card={b} side="b" />
      </div>

      <div className="mt-4">
        {aPct != null ? (
          <>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${aPct}%` }} />
              <div className="h-full bg-accent-2 transition-all duration-500" style={{ width: `${100 - aPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-xs">
              <span className="text-accent-text">{aPct}%</span>
              <span className="text-muted">
                {voteCount.toLocaleString()} vote{voteCount === 1 ? "" : "s"}
              </span>
              <span className="text-accent-2">{100 - aPct}%</span>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-muted">No votes yet — settle it.</p>
        )}
      </div>

      <div className="mt-4 text-center">
        {authed === false ? (
          <Link
            href="/login"
            className="inline-block rounded-md bg-accent px-6 py-2.5 font-bold uppercase tracking-wide text-white transition hover:brightness-110"
          >
            Sign in to vote
          </Link>
        ) : authed === true && pick ? (
          <p className="text-sm text-muted">
            You picked{" "}
            <span className="font-bold text-foreground">
              {pick === a.form_id ? a.character_name : b.character_name}
            </span>
            . Tap the other card to change (once a week).
          </p>
        ) : authed === true ? (
          <p className="text-sm text-muted">Tap a fighter to cast your vote.</p>
        ) : null}
        {error && <p className="mt-2 text-sm text-accent-text">{error}</p>}
      </div>
    </div>
  );
}
