"use client";

import Image from "next/image";
import type { FormCard } from "@/lib/types";

export function VersusCard({
  card,
  side,
  imageUrl,
  onPick,
  disabled,
  result,
}: {
  card: FormCard;
  side: "a" | "b";
  imageUrl: string | null;
  onPick: () => void;
  disabled: boolean;
  result: "winner" | "loser" | null; // the impact frame: winner flashes + stamps, loser drops out
}) {
  const sideColor = side === "a" ? "var(--accent)" : "var(--accent-2)";
  const isWinner = result === "winner";
  const isLoser = result === "loser";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-label={`${card.form_name} wins`}
      className={`group relative flex w-full flex-col overflow-hidden rounded-lg border bg-surface text-left transition duration-300
        ${isWinner ? "sv-punch" : ""}
        ${isLoser ? "scale-[0.97] opacity-60 brightness-75 grayscale" : ""}
        ${!result && !disabled ? "hover:scale-[1.01]" : ""}
        ${!result && disabled ? "opacity-60" : ""}`}
      style={{
        borderColor: isWinner ? sideColor : "rgba(255,255,255,0.08)",
        boxShadow: isWinner ? `0 0 32px -8px ${sideColor}` : undefined,
      }}
    >
      <div className="relative aspect-[3/4] w-full bg-black/40">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={card.form_name}
            fill
            sizes="(max-width: 640px) 45vw, 320px"
            className="object-cover object-top transition group-hover:scale-[1.03]"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">?</div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: "linear-gradient(to top, rgba(10,10,18,0.95), transparent)" }}
        />
        {isWinner && (
          <>
            <span aria-hidden className="sv-impact-flash pointer-events-none absolute inset-0 z-10" />
            <span
              aria-hidden
              className="sv-stamp font-display pointer-events-none absolute inset-x-0 top-[40%] z-20 text-center text-3xl uppercase tracking-wide text-white sm:text-4xl"
              style={{ textShadow: `0 0 18px ${sideColor}, 0 2px 0 rgba(0,0,0,0.6)` }}
            >
              Winner
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        {card.epithet && (
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            {card.epithet}
          </p>
        )}
        <p className="font-display -skew-x-6 truncate text-lg uppercase leading-tight">
          {card.form_name}
        </p>
        {card.display_rating != null && (
          <p className="font-mono text-xs" style={{ color: sideColor }}>
            {card.display_rating}
          </p>
        )}
      </div>
    </button>
  );
}
