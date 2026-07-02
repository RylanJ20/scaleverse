"use client";

import Image from "next/image";
import type { FormCard } from "@/lib/types";

export function VersusCard({
  card,
  side,
  imageUrl,
  onPick,
  disabled,
  picked,
}: {
  card: FormCard;
  side: "a" | "b";
  imageUrl: string | null;
  onPick: () => void;
  disabled: boolean;
  picked: boolean;
}) {
  const sideColor = side === "a" ? "var(--accent)" : "var(--accent-2)";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-label={`${card.form_name} wins`}
      className={`group relative flex w-full flex-col overflow-hidden rounded-lg border bg-surface text-left transition
        ${picked ? "scale-[1.02]" : "hover:scale-[1.01]"}
        ${disabled && !picked ? "opacity-60" : ""}`}
      style={{
        borderColor: picked ? sideColor : "rgba(255,255,255,0.08)",
        boxShadow: picked ? `0 0 32px -8px ${sideColor}` : undefined,
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
