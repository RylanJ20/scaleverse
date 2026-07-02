"use client";

import { useState } from "react";

export function SpoilerGate({
  characterName,
  children,
}: {
  characterName: string;
  children: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) return <>{children}</>;

  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none blur-xl">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/70 p-6 text-center backdrop-blur-sm">
        <p className="font-display -skew-x-6 text-xl uppercase">Spoiler warning</p>
        <p className="max-w-xs text-sm text-muted">
          {characterName} appears after the point you told us you&apos;ve reached in One Piece.
          This page may contain spoilers.
        </p>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-md bg-accent px-5 py-2 font-bold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Show anyway
        </button>
      </div>
    </div>
  );
}
