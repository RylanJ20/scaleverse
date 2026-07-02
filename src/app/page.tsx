import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent-2">
        Season 0
      </p>
      <h1 className="text-5xl font-black uppercase italic tracking-tight sm:text-7xl">
        Scale<span className="text-accent">verse</span>
      </h1>
      <p className="max-w-md text-balance text-muted">
        Who wins? Vote on head-to-head anime matchups and shape the
        community&apos;s definitive power rankings.
      </p>
      <Link
        href="/one-piece/arena"
        className="rounded-md bg-accent px-8 py-3 text-lg font-bold uppercase tracking-wider text-white transition hover:brightness-110"
      >
        Enter the Arena
      </Link>
    </main>
  );
}
