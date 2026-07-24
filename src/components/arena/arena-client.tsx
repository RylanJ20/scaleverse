"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { castVote, fetchBatch, recordDemoVote, saveProgress, skipDeal } from "@/app/actions/arena";
import type { ArcOption, FormCard, MatchupItem } from "@/lib/types";
import { ArcPicker } from "./arc-picker";
import { VersusCard } from "./versus-card";

const DEMO_GATE_AT = 5;
const REVEAL_MS = 1600;
// Dispatch pacing: floor between sends (above the ratified 1.5s server guard)
// plus a rolling client budget that stays under the ratified 20/min ceiling —
// the queue absorbs bursts (reveal-skipping) and drains within the rules.
const SEND_SPACING_MS = 1600;
const BUDGET_WINDOW_MS = 61_000;
const BUDGET_MAX_SENDS = 19; // one under the server's 20/min, leaving retry headroom
const RATE_LIMIT_PAUSE_MS = 65_000;
const MAX_QUEUED_VOTES = 8; // picking pauses (not fails) beyond this backlog

type Phase = "onboarding" | "pick" | "reveal" | "gate" | "summary" | "empty" | "errored";

// One vote's contribution to the set summary (deal mode only — demo votes have
// no deltas and guests keep the sign-in gate as their beat).
type SetEntry = {
  matchupId: string;
  pickIsA: boolean;
  pickFormId: string; // ratings are per-FORM (invariant #3) — momentum keys on this
  pickLabel: string;
  otherLabel: string;
  pickImagePath: string | null;
  myPct: number | null; // share agreeing with my pick; null under the 5-vote gate
  delta: number | null; // reconciled cosmetic delta
};

function entryPct(pickIsA: boolean, voteCount: number, aWins: number): number | null {
  if (voteCount < 5) return null;
  return (pickIsA ? aWins : voteCount - aWins) / voteCount;
}

// Forms are the votable/ranked entities (Base Luffy ≠ Gear 5 Luffy) — qualify
// the character name whenever the pick is a non-base form.
function formLabel(card: FormCard): string {
  return card.form_name && card.form_name.toLowerCase() !== "base"
    ? `${card.character_name} (${card.form_name})`
    : card.character_name;
}

type Reveal = {
  matchupId: string;
  pick: "a" | "b";
  aPct: number | null; // null = too few votes to show a %
  voteCount: number;
  delta: number | null;
};

// A vote in the background send queue (optimistic loop: the reveal renders
// instantly from dealt tallies; the RPC happens here and reconciles after).
type VoteJob = {
  matchupId: string;
  dealId: string | null; // null = demo vote
  sessionId: string | null; // demo session (demo jobs only)
  winnerFormId: string;
  label: string; // "Luffy vs Kaido" for the failure banner
  attempts: number;
  tooFastRetries: number; // separate budget: P0005 is always wait-and-resend
};

type VoteFailure = {
  id: number;
  job: VoteJob;
  retryable: boolean;
  message: string;
};

// ---------------------------------------------------------------------------
// Module-scoped vote pipeline. Shared across remounts on purpose: SPA
// navigation must never double-send, reset pacing, or strand queued votes in a
// dead closure. Components subscribe for re-renders; the pipeline owns state.
// ---------------------------------------------------------------------------
const voteQueue: VoteJob[] = [];
const failureLog: VoteFailure[] = [];
// matchups voted/skipped this tab — deal_matchups re-serves still-pending
// deals, so top-ups must not re-show a fight whose vote is merely in flight
const handledMatchups = new Set<string>();
const sentAtLog: number[] = [];
let lastSentAt = 0;
let pausedUntil = 0; // rate-limit backoff (auto-resumes)
let rateLimitStreak = 0; // consecutive P0006s → escalate the pause (hr/day ceilings)
let draining = false;
let failureSeq = 0;
// The mounted instance's reconcile — module-held so a drain loop or resume
// timer that outlives its original mount still reconciles the CURRENT reveal.
let activeReconcile: (matchupId: string, voteCount: number, aWins: number, delta: number | null) => void = () => {};
// Same pattern for terminal vote failures: the set score must drop picks that
// never landed.
let activeVoteFailed: (matchupId: string) => void = () => {};
const pipelineListeners = new Set<() => void>();
function notifyPipeline() {
  pipelineListeners.forEach((l) => l());
}
function pipelinePaused() {
  return Date.now() < pausedUntil;
}
async function waitForVoteQueue(maxMs: number) {
  const deadline = Date.now() + maxMs;
  while (voteQueue.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function ArenaClient({
  seriesSlug,
  mode,
  initialItems,
  arcs,
  needsOnboarding,
  initialError,
  gateArc,
  imageBase,
}: {
  seriesSlug: string;
  mode: "deal" | "demo";
  initialItems: MatchupItem[];
  arcs: ArcOption[];
  needsOnboarding: boolean;
  initialError?: boolean;
  gateArc: ArcOption | null; // null = caught up, no gate
  imageBase: string;
}) {
  // initialItems can include re-served deals whose votes are still in this
  // tab's pipeline (SPA nav remount) — filter them exactly like topUp does
  const [queue, setQueue] = useState<MatchupItem[]>(() =>
    initialItems.filter((i) => !handledMatchups.has(i.matchup_id)),
  );
  const [phase, setPhase] = useState<Phase>(() => {
    const visible = initialItems.filter((i) => !handledMatchups.has(i.matchup_id));
    return needsOnboarding ? "onboarding" : initialError ? "errored" : visible.length ? "pick" : "empty";
  });
  const [showPicker, setShowPicker] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [setCount, setSetCount] = useState(0);
  const [setEntries, setSetEntries] = useState<SetEntry[]>([]);
  const [lastSummaryAt, setLastSummaryAt] = useState(0);
  const [lastGateAt, setLastGateAt] = useState(0);
  const [demoVotes, setDemoVotes] = useState(0);
  const summaryShownAt = useRef(0);
  const nextSetRef = useRef<HTMLButtonElement>(null);
  // re-render trigger for module pipeline changes (queue depth, failures, pause)
  const [, setPipelineVersion] = useState(0);
  const fetching = useRef(false);
  const sessionId = useRef<string | null>(null);

  const current = queue[0] ?? null;

  useEffect(() => {
    const bump = () => setPipelineVersion((v) => v + 1);
    pipelineListeners.add(bump);
    return () => {
      pipelineListeners.delete(bump);
    };
  }, []);

  // Reconcile a server tally into the reveal (only if that matchup is still on
  // screen — once the user advanced, the optimistic numbers just stand) and
  // into the running set summary.
  const reconcile = useCallback((matchupId: string, voteCount: number, aWins: number, delta: number | null) => {
    setReveal((r) =>
      r && r.matchupId === matchupId
        ? {
            ...r,
            voteCount,
            aPct: voteCount >= 5 ? aWins / voteCount : null,
            delta,
          }
        : r,
    );
    setSetEntries((es) =>
      es.map((e) =>
        e.matchupId === matchupId
          ? { ...e, myPct: entryPct(e.pickIsA, voteCount, aWins), delta }
          : e,
      ),
    );
  }, []);

  useEffect(() => {
    // point the module pipeline at THIS mount's reveal + set accumulator
    activeReconcile = reconcile;
    activeVoteFailed = (matchupId: string) =>
      setSetEntries((es) => es.filter((e) => e.matchupId !== matchupId));
  }, [reconcile]);

  // Drain the module queue sequentially. Pacing: SEND_SPACING_MS floor plus a
  // rolling ≤19-sends/61s budget, so neither the ratified 1.5s guard nor the
  // 20/min ceiling fires in normal play. Failures are classified by TYPED
  // OUTCOME CODES (production redacts thrown server-action messages — string
  // matching never works deployed).
  const drainQueue = useCallback(async () => {
    if (draining) return;
    draining = true;
    try {
      while (voteQueue.length > 0) {
        if (pipelinePaused()) break; // resume timer re-enters drain
        // rolling 20/min client budget
        const cutoff = Date.now() - BUDGET_WINDOW_MS;
        while (sentAtLog.length && sentAtLog[0] < cutoff) sentAtLog.shift();
        const budgetWait = sentAtLog.length >= BUDGET_MAX_SENDS ? sentAtLog[0] + BUDGET_WINDOW_MS - Date.now() : 0;
        const spacingWait = lastSentAt + SEND_SPACING_MS - Date.now();
        const wait = Math.max(budgetWait, spacingWait);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        const job = voteQueue[0];
        lastSentAt = Date.now();
        sentAtLog.push(lastSentAt);

        const fail = (retryable: boolean, message: string) => {
          voteQueue.shift();
          // release the fight: its deal is still pending server-side, so the
          // re-serve can legitimately show it again (retry re-claims it)
          handledMatchups.delete(job.matchupId);
          // a pick that never landed must not count in the set score
          activeVoteFailed(job.matchupId);
          failureLog.push({ id: ++failureSeq, job, retryable, message });
        };

        if (job.dealId) {
          const out = await castVote(job.dealId, job.winnerFormId).catch(
            () => ({ ok: false, code: "unknown" }) as const,
          );
          if (out.ok) {
            rateLimitStreak = 0;
            activeReconcile(job.matchupId, out.result.vote_count, out.result.a_wins, out.result.cosmetic_delta);
            voteQueue.shift();
          } else if (out.code === "resolved") {
            // the deal is VOTED (e.g. our response got lost) — success
            rateLimitStreak = 0;
            voteQueue.shift();
          } else if (out.code === "too_fast" && job.tooFastRetries < 4) {
            job.tooFastRetries += 1; // guard skew / second tab — wait, resend
            lastSentAt = Date.now() + 400 * job.tooFastRetries;
          } else if (out.code === "rate_limit") {
            // Ceiling hit: pause and auto-resume. A repeat means an hour/day
            // ceiling (the client budget already respects 20/min) — back off
            // long instead of probing every minute.
            rateLimitStreak += 1;
            const pause = rateLimitStreak >= 2 ? 10 * 60_000 : RATE_LIMIT_PAUSE_MS;
            pausedUntil = Date.now() + pause;
            setTimeout(() => {
              pausedUntil = 0;
              notifyPipeline();
              void drainQueue();
            }, pause);
            break;
          } else if (out.code === "expired") {
            fail(false, `Your vote on ${job.label} didn't land — that fight expired.`);
          } else if (out.code === "skipped") {
            fail(false, `Your vote on ${job.label} didn't land — it was skipped in another tab.`);
          } else if (out.code === "not_found") {
            fail(false, `Your vote on ${job.label} didn't land — that fight is no longer on your card.`);
          } else if (out.code === "revote_limit") {
            fail(false, `Your pick on ${job.label} didn't change — one change per fight per week.`);
          } else if (job.attempts < 1) {
            job.attempts += 1; // one automatic retry for transient failures
          } else {
            fail(true, `Your vote on ${job.label} didn't land.`);
          }
        } else {
          const res = await recordDemoVote(job.matchupId, job.winnerFormId, job.sessionId ?? "anon").catch(
            () => ({ ok: false, tally: null }),
          );
          if (res.ok) {
            if (res.tally) activeReconcile(job.matchupId, res.tally.vote_count, res.tally.a_wins, null);
            voteQueue.shift();
          } else if (job.attempts < 1) {
            job.attempts += 1;
          } else {
            fail(true, `Your vote on ${job.label} didn't land.`);
          }
        }
        notifyPipeline();
      }
    } finally {
      draining = false;
      notifyPipeline();
    }
  }, []);

  const enqueueVote = useCallback(
    (job: VoteJob) => {
      voteQueue.push(job);
      notifyPipeline();
      void drainQueue();
    },
    [drainQueue],
  );

  const retryFailure = useCallback(
    (id: number) => {
      const idx = failureLog.findIndex((f) => f.id === id);
      if (idx === -1) return;
      const [entry] = failureLog.splice(idx, 1);
      handledMatchups.add(entry.job.matchupId); // re-claim the fight while retrying
      enqueueVote({ ...entry.job, attempts: 0, tooFastRetries: 0 });
    },
    [enqueueVote],
  );

  const dismissFailure = useCallback((id: number) => {
    const idx = failureLog.findIndex((f) => f.id === id);
    if (idx !== -1) failureLog.splice(idx, 1);
    notifyPipeline();
  }, []);

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
        // exclude fights already on the card AND fights voted/skipped this tab
        // whose deals are still server-pending (their votes are in flight — the
        // re-serve migration would hand them straight back otherwise)
        const seen = new Set(q.map((i) => i.matchup_id));
        return [...q, ...batch.items.filter((i) => !seen.has(i.matchup_id) && !handledMatchups.has(i.matchup_id))];
      });
      // a top-up can refill an "empty" arena (e.g. after an arc change)
      if (batch.items.length) setPhase((p) => (p === "empty" ? "pick" : p));
    } catch {
      // transient; next advance retries
    } finally {
      fetching.current = false;
    }
  }, [seriesSlug]);

  useEffect(() => {
    if (phase !== "onboarding" && phase !== "errored" && queue.length < 4) void topUp();
  }, [queue.length, phase, topUp]);

  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const batch = await fetchBatch(seriesSlug);
      setQueue(batch.items);
      setPhase(batch.items.length ? "pick" : "empty");
    } catch {
      // stay on the errored screen
    } finally {
      setRetrying(false);
    }
  }, [seriesSlug]);

  const changeArc = useCallback(
    async (choice: { caughtUp: true } | { arcSlug: string }) => {
      await saveProgress(seriesSlug, choice);
      // let in-flight votes land before the reload wipes the pipeline (kick the
      // drain in case it's idle; rate-limit-paused votes are re-served instead)
      void drainQueue();
      await waitForVoteQueue(10_000);
      window.location.reload();
    },
    [seriesSlug, drainQueue],
  );

  const advance = useCallback(() => {
    setReveal(null);
    setQueue((q) => q.slice(1));
    if (mode === "deal" && setCount > 0 && setCount % 10 === 0 && setCount !== lastSummaryAt) {
      // set boundary: the round-results beat (signed-in only — demo votes have
      // no rating deltas and guests keep the sign-in gate as their beat)
      setLastSummaryAt(setCount);
      summaryShownAt.current = Date.now();
      setPhase("summary");
    } else if (
      mode === "demo" &&
      demoVotes >= DEMO_GATE_AT &&
      demoVotes % DEMO_GATE_AT === 0 &&
      demoVotes !== lastGateAt
    ) {
      // once per boundary — "Keep playing" must never re-enter the gate
      setLastGateAt(demoVotes);
      setPhase("gate");
    } else {
      setPhase("pick");
    }
  }, [mode, demoVotes, setCount, lastSummaryAt, lastGateAt]);

  const nextSet = useCallback(() => {
    setSetEntries([]);
    setPhase("pick");
  }, []);

  // dedicated gate continue: advance() already consumed the fight that led
  // here — continuing must not slice another one off the queue
  const continueAsGuest = useCallback(() => {
    setPhase("pick");
  }, []);

  useEffect(() => {
    if (phase !== "reveal") return;
    const t = setTimeout(advance, REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase, advance]);

  // announce + keyboard-anchor the payoff beat (a live region mounting with
  // its content isn't announced; focusing the primary CTA is)
  useEffect(() => {
    if (phase === "summary") nextSetRef.current?.focus();
  }, [phase]);

  // Optimistic: the reveal renders instantly from the tallies dealt with the
  // card; the vote itself dispatches from the background queue and reconciles
  // the numbers when the RPC returns. Only signed-in (deal) votes count toward
  // rankings — demo tallies are shown as-is, never +1'd (demo votes are
  // isolated by design and don't move the community numbers).
  const pick = useCallback(
    (side: "a" | "b") => {
      if (!current || phase !== "pick") return;
      // pause (don't fail) new picks while rate-limited or badly backlogged
      if (pipelinePaused() || voteQueue.length >= MAX_QUEUED_VOTES) return;
      const winner = side === "a" ? current.a : current.b;

      const isDeal = mode === "deal" && !!current.deal_id;
      const voteCount = current.vote_count + (isDeal ? 1 : 0);
      const aWins = current.a_wins + (isDeal && side === "a" ? 1 : 0);
      setReveal({
        matchupId: current.matchup_id,
        pick: side,
        aPct: voteCount >= 5 ? aWins / voteCount : null,
        voteCount,
        delta: null,
      });
      if (!isDeal) {
        const next = demoVotes + 1;
        setDemoVotes(next);
        localStorage.setItem("sv-demo-votes", String(next));
      }
      setSetCount((n) => n + 1);
      setPhase("reveal");
      // only deal-mode fights go in the re-serve guard set: demo pairs are
      // legitimately re-dealable by the server (no deals exist for them), and
      // hiding them forever would starve small gated rosters
      if (isDeal) {
        handledMatchups.add(current.matchup_id);
        const other = side === "a" ? current.b : current.a;
        setSetEntries((es) => [
          // a failed-then-revoted fight must not appear twice in the score
          ...es.filter((e) => e.matchupId !== current.matchup_id),
          {
            matchupId: current.matchup_id,
            pickIsA: side === "a",
            pickFormId: winner.form_id,
            pickLabel: formLabel(winner),
            otherLabel: formLabel(other),
            pickImagePath: winner.image_path,
            myPct: entryPct(side === "a", voteCount, aWins),
            delta: null,
          },
        ]);
      }

      enqueueVote({
        matchupId: current.matchup_id,
        dealId: isDeal ? current.deal_id! : null,
        sessionId: isDeal ? null : sessionId.current,
        winnerFormId: winner.form_id,
        label: `${formLabel(current.a)} vs ${formLabel(current.b)}`,
        attempts: 0,
        tooFastRetries: 0,
      });
    },
    [current, phase, mode, demoVotes, enqueueVote],
  );

  const skip = useCallback(async () => {
    if (!current || phase !== "pick") return;
    if (mode === "deal" && current.deal_id) {
      const id = current.matchup_id;
      handledMatchups.add(id);
      // if the skip never lands the deal stays pending — release the fight so
      // a later re-serve can show it again instead of hiding it forever
      skipDeal(current.deal_id).catch(() => handledMatchups.delete(id));
    }
    advance();
  }, [current, phase, mode, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showPicker || e.repeat) return; // key-repeat must not auto-vote
      if (phase === "reveal") {
        advance();
        return;
      }
      if (phase === "summary") {
        // never hijack focus navigation or focused controls; only Enter/Space
        // continue (arrows are the mashed voting keys — a 500ms arming delay
        // keeps spam from blowing through the payoff beat)
        if (e.target instanceof HTMLElement && e.target.closest("a,button")) return;
        if ((e.key === "Enter" || e.key === " ") && Date.now() - summaryShownAt.current > 500) {
          nextSet();
        }
        return;
      }
      if (e.key === "ArrowLeft") void pick("a");
      if (e.key === "ArrowRight") void pick("b");
      if (e.key === "ArrowDown") void skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, skip, advance, nextSet, phase, showPicker]);

  if (phase === "onboarding") {
    return <ArcPicker arcs={arcs} onChoose={changeArc} />;
  }

  const changePicker = showPicker ? (
    <ArcPicker arcs={arcs} onChoose={changeArc} onClose={() => setShowPicker(false)} />
  ) : null;

  // Pipeline status — rendered on every screen the user can be on when a
  // background vote resolves (pick/reveal, gate, empty), never only on "pick".
  const visibleFailures = failureLog.slice(-3);
  const backlogged = voteQueue.length >= MAX_QUEUED_VOTES;
  const pipelineBanners =
    pipelinePaused() || backlogged || visibleFailures.length > 0 ? (
      <div className="flex flex-col items-center gap-1.5" aria-live="polite">
        {pipelinePaused() && (
          <p className="text-sm text-accent-text">
            Vote limit hit — your queued votes will retry automatically.
          </p>
        )}
        {backlogged && !pipelinePaused() && (
          <p className="font-mono text-xs text-muted">Catching up on your votes…</p>
        )}
        {visibleFailures.map((f) => (
          <p key={f.id} className="text-sm text-accent-text">
            {f.message}{" "}
            {f.retryable && (
              <button
                type="button"
                onClick={() => retryFailure(f.id)}
                className="underline underline-offset-4 transition hover:text-foreground"
              >
                Retry
              </button>
            )}{" "}
            <button
              type="button"
              onClick={() => dismissFailure(f.id)}
              className="text-muted underline underline-offset-4 transition hover:text-foreground"
            >
              Dismiss
            </button>
          </p>
        ))}
      </div>
    ) : null;

  if (phase === "errored") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display -skew-x-6 text-2xl uppercase">
          The arena didn&apos;t <span className="text-accent">load</span>
        </h2>
        <p className="text-sm text-muted">Couldn&apos;t deal your matchups. Try again in a moment.</p>
        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry()}
          className="rounded-md bg-accent px-6 py-3 font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {retrying ? "Trying…" : "Try again"}
        </button>
      </div>
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
        <button type="button" onClick={continueAsGuest} className="text-sm text-muted underline-offset-4 hover:underline">
          Keep playing as guest
        </button>
        {pipelineBanners}
      </div>
    );
  }

  if (phase === "summary") {
    const scored = setEntries.filter((e) => e.myPct != null);
    const withCrowd = scored.filter((e) => e.myPct! >= 0.5).length;
    const hottest =
      scored.filter((e) => e.myPct! < 0.5).sort((x, y) => x.myPct! - y.myPct!)[0] ?? null;
    // ratings are per-form (invariant #3): momentum keys on the picked form
    const momentumTotals = new Map<string, { label: string; total: number }>();
    for (const e of setEntries) {
      if (e.delta != null && e.delta > 0) {
        const cur = momentumTotals.get(e.pickFormId) ?? { label: e.pickLabel, total: 0 };
        cur.total += e.delta;
        momentumTotals.set(e.pickFormId, cur);
      }
    }
    const momentum =
      [...momentumTotals.values()].sort((x, y) => y.total - x.total)[0] ?? null;

    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent-2">
          Set {Math.floor(setCount / 10)} complete
        </h2>

        <div>
          <p className="font-display -skew-x-6 text-6xl uppercase leading-none">
            {scored.length > 0 ? `${withCrowd}/${scored.length}` : setEntries.length}
          </p>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-muted">
            {scored.length > 0 ? "with the crowd" : "fights called"}
          </p>
        </div>

        {hottest ? (
          <div className="w-full rounded-lg border border-white/10 bg-surface p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-text">
              Hottest take
            </p>
            <div className="mt-3 flex items-center justify-center gap-3">
              {hottest.pickImagePath && (
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-black/40">
                  <Image
                    src={`${imageBase}/${hottest.pickImagePath}`}
                    alt={hottest.pickLabel}
                    fill
                    sizes="44px"
                    className="object-cover object-top"
                  />
                </div>
              )}
              <p className="text-left text-sm">
                <span className="font-bold">{hottest.pickLabel}</span> over {hottest.otherLabel}
                <br />
                <span className="font-mono text-xs text-accent-2">
                  only {Math.floor(hottest.myPct! * 100)}% agree
                </span>
              </p>
            </div>
          </div>
        ) : scored.length > 0 ? (
          <p className="text-sm text-muted">No hot takes this set — you rode with the crowd.</p>
        ) : (
          <p className="text-sm text-muted">
            Early fights — the crowd hasn&apos;t formed on these yet. Your votes shape it.
          </p>
        )}

        {/* reserved height: late reconciles must not shift the CTA */}
        <div className="min-h-6">
          {momentum && (
            <p className="text-sm">
              <span className="font-mono text-accent-2">+{momentum.total}</span>{" "}
              <span className="text-muted">· you pushed</span>{" "}
              <span className="font-bold">{momentum.label}</span> <span aria-hidden>↑</span>
            </p>
          )}
        </div>

        <button
          ref={nextSetRef}
          type="button"
          onClick={nextSet}
          className="rounded-md bg-accent px-8 py-3 text-lg font-bold uppercase tracking-wider text-white transition hover:brightness-110"
        >
          Next set
        </button>
        <Link
          href={`/${seriesSlug}/tier-list`}
          className="text-sm text-accent-2 underline-offset-4 hover:underline"
        >
          See the tier list you&apos;re shaping
        </Link>
        {pipelineBanners}
        {changePicker}
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
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="rounded-md border border-white/15 px-4 py-3 text-sm text-foreground transition hover:border-white/30"
        >
          Change my arc
        </button>
        {pipelineBanners}
        {changePicker}
      </div>
    );
  }

  const aPctDisplay = reveal?.aPct != null ? Math.round(reveal.aPct * 100) : null;
  // classify from the RAW fraction (same threshold the set summary uses) so the
  // two beats can never disagree about the same fight at the 50% boundary
  const rawMyPct =
    reveal?.aPct != null ? (reveal.pick === "a" ? reveal.aPct : 1 - reveal.aPct) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
      <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
        <span>
          Set {Math.floor(setCount / 10) + 1} · fight {(setCount % 10) + 1}/10
        </span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="uppercase underline decoration-dotted underline-offset-4 transition hover:text-foreground"
          >
            Spoilers: {gateArc ? `through ${gateArc.name}` : "caught up"}
          </button>
          <span className="hidden sm:block">← left wins · right wins → · ↓ can&apos;t call it</span>
        </div>
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
          disabled={phase !== "pick" || pipelinePaused() || backlogged}
          picked={reveal?.pick === "a"}
        />
        <VersusCard
          card={current.b}
          side="b"
          imageUrl={current.b.image_path ? `${imageBase}/${current.b.image_path}` : null}
          onPick={() => void pick("b")}
          disabled={phase !== "pick" || pipelinePaused() || backlogged}
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
                  <span className="font-mono text-sm text-accent-text">{aPctDisplay}%</span>
                  <p className="text-center text-sm">
                    {rawMyPct != null && rawMyPct >= 0.5 ? (
                      <span className="text-muted">With the crowd</span>
                    ) : (
                      <span className="font-bold text-accent-2">
                        Hot take — only {rawMyPct != null ? Math.floor(rawMyPct * 100) : 0}% agree
                      </span>
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
            {reveal.delta != null && reveal.delta > 0 && (
              <p className="mt-1.5 text-center font-mono text-xs text-accent-2">
                +{reveal.delta} · you pushed{" "}
                {reveal.pick === "a" ? current.a.character_name : current.b.character_name}{" "}
                <span aria-hidden>↑</span>
              </p>
            )}
          </button>
        )}
        {phase === "pick" && (
          <div className="flex flex-col items-center gap-2">
            {pipelineBanners}
            <button
              type="button"
              onClick={() => void skip()}
              className="text-sm text-muted underline-offset-4 transition hover:text-foreground hover:underline"
            >
              Can&apos;t call it — skip
            </button>
          </div>
        )}
        {phase === "reveal" && pipelineBanners}
      </div>

      {changePicker}
    </div>
  );
}
