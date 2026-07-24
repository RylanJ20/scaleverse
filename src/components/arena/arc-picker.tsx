"use client";

import { useState, useTransition } from "react";
import type { ArcOption } from "@/lib/types";

export function ArcPicker({
  arcs,
  onChoose,
  onClose,
}: {
  arcs: ArcOption[];
  onChoose: (choice: { caughtUp: true } | { arcSlug: string }) => Promise<void>;
  // present when opened as a change (not forced onboarding)
  onClose?: () => void;
}) {
  const [showArcs, setShowArcs] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const choose = (choice: { caughtUp: true } | { arcSlug: string }) =>
    startTransition(async () => {
      setFailed(false);
      try {
        await onChoose(choice);
      } catch {
        setFailed(true);
      }
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-surface p-6">
        <h2 className="font-display -skew-x-6 text-2xl uppercase">
          Where are you in <span className="text-accent">One Piece</span>?
        </h2>
        <p className="mt-2 text-sm text-muted">
          We only show characters you&apos;ve already met — no spoilers. You can change this
          anytime.
        </p>

        {!showArcs ? (
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => choose({ caughtUp: true })}
              className="rounded-md bg-accent px-4 py-3 text-lg font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50"
            >
              I&apos;m caught up — show everything
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowArcs(true)}
              className="rounded-md border border-white/15 px-4 py-3 text-sm text-foreground transition hover:border-white/30 disabled:opacity-50"
            >
              Pick the last arc I finished
            </button>
          </div>
        ) : (
          <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto pr-1">
            {arcs.map((arc) => (
              <li key={arc.slug}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose({ arcSlug: arc.slug })}
                  className="flex w-full items-baseline justify-between rounded px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-50"
                >
                  <span>{arc.name}</span>
                  <span className="font-mono text-xs text-muted">#{arc.position}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {failed && (
          <p className="mt-3 text-sm text-accent-text">Couldn&apos;t save that. Try again.</p>
        )}

        {onClose && (
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="mt-4 text-sm text-muted underline-offset-4 hover:underline disabled:opacity-50"
          >
            Keep my current setting
          </button>
        )}
      </div>
    </div>
  );
}
