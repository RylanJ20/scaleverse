import Link from "next/link";
import { getCachedSeriesList } from "@/lib/cached";

// The front door is the verse select screen: pick a verse, land on its hub
// (/[series]). Cards come from the series table, so new verses appear here as
// content inserts; the single locked slot is cosmetic roadmap signal.
export default async function Home() {
  const verses = await getCachedSeriesList();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <section className="flex w-full max-w-3xl flex-col items-center gap-5 text-center">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent-2">Season 0</p>
        <h1 className="font-display -skew-x-6 text-5xl uppercase tracking-tight sm:text-7xl">
          Scale<span className="text-accent">verse</span>
        </h1>
        <p className="max-w-md text-balance text-muted">
          Who wins? Vote on head-to-head anime matchups and shape the community&apos;s definitive
          power rankings.
        </p>

        <h2 className="mt-8 font-mono text-xs uppercase tracking-[0.3em] text-accent-text" id="verse-select">
          Choose your verse
        </h2>
        {/* role="list": preflight's list-style-none makes Safari drop list
            semantics, which would void the aria-labelledby */}
        <ul role="list" aria-labelledby="verse-select" className="grid w-full gap-3 sm:grid-cols-2">
          {verses.map((verse, i) => (
            <li key={verse.slug}>
              <Link
                href={`/${verse.slug}`}
                className="group flex min-h-52 flex-col justify-between rounded-lg border border-white/10 bg-surface p-5 text-left transition hover:scale-[1.01] hover:border-white/25 hover:shadow-[0_0_40px_-10px_color-mix(in_srgb,var(--color-accent)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-2"
              >
                <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-accent-2">
                  Verse {String(i + 1).padStart(2, "0")}
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-2" />
                    Live
                  </span>
                </span>
                <span className="flex flex-col gap-3">
                  <span className="font-display -skew-x-6 text-4xl uppercase leading-none sm:text-5xl">
                    {verse.name}
                  </span>
                  <span className="font-mono text-xs uppercase tracking-[0.2em]">
                    Enter{" "}
                    <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">
                      ▶
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
          <li>
            <div className="relative flex min-h-52 flex-col justify-between overflow-hidden rounded-lg border border-white/5 bg-surface/50 p-5 text-left">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 12px)",
                }}
              />
              <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
                Verse {String(verses.length + 1).padStart(2, "0")}
                <span className="flex items-center gap-1.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                    aria-hidden
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Locked
                </span>
              </span>
              <span className="flex flex-col gap-3">
                <span className="font-display -skew-x-6 text-4xl uppercase leading-none text-muted sm:text-5xl">
                  New verse
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Coming soon</span>
              </span>
            </div>
          </li>
        </ul>
      </section>
    </main>
  );
}
