import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/arena";
import { SeriesNav } from "@/components/nav/series-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const anton = Anton({
  weight: "400",
  variable: "--font-anton",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Scaleverse",
    template: "%s · Scaleverse",
  },
  description:
    "The anime community's power-scaling arena. Vote on head-to-head matchups and shape the definitive community tier list.",
};

// The only per-request work in the layout: who is signed in. Streams into the
// static header shell so the rest of every page can prerender (PPR).
async function HeaderAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded bg-accent px-3 py-1.5 font-bold text-white transition hover:brightness-110"
      >
        Sign in
      </Link>
    );
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  const username = profile?.username ?? null;
  return (
    <>
      {username && (
        <Link href={`/u/${username}`} className="text-foreground transition hover:text-accent-2">
          @{username}
        </Link>
      )}
      <form action={signOut}>
        <button className="transition hover:text-foreground" type="submit">
          Sign out
        </button>
      </form>
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3 sm:px-6">
          <Link href="/" className="font-display -skew-x-6 text-xl uppercase tracking-wide">
            Scale<span className="text-accent">verse</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted">
            {/* pathname is runtime data on fallback-shell routes — needs a boundary */}
            <Suspense fallback={null}>
              <SeriesNav />
            </Suspense>
            <Suspense fallback={<span className="inline-block h-8 w-16" aria-hidden />}>
              <HeaderAuth />
            </Suspense>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
