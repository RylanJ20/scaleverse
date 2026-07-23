@AGENTS.md

# CLAUDE.md — Scaleverse

Community power-scaling voting game for anime, launching with One Piece. Users vote on head-to-head character matchups ("Who wins: Luffy vs Kaido?"); votes feed a batch Bradley-Terry model that produces a living community tier list. Series-agnostic platform — One Piece is the launch *verse*, not the brand.

## Process rule (non-negotiable)

The founder signs off on **every** product/design/technical decision before implementation — present options via AskUserQuestion and wait. No unilateral calls. Batch related questions (max 4), small rounds.

## Authoritative docs

- `PRODUCT_PLAN.md` — the product plan. **§0 "Ratified Decisions" is authoritative** and supersedes the document body wherever they conflict (the body predates founder sign-off; conflicting sections are marked ⚠️).
- `node_modules/next/dist/docs/` — bundled docs for the installed Next.js version (see AGENTS.md warning above; trust these over training data).

## Stack

Next.js App Router (TypeScript, Tailwind) deployed on Vercel · Supabase (auth + Postgres, RLS) · ratings computed by a Vercel Cron job, never in the request path.

## Commands

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build
- `npm run lint` — ESLint

## Structure

- `src/app/[series]/arena` — the voting loop (core product surface)
- `src/app/[series]/tier-list` — the community tier list
- `src/app/[series]/vs/[slug]` — programmatic matchup pages (SEO)
- `src/app/[series]/characters/[slug]` — character detail pages
- `src/app/u/[username]` — public profiles
- `src/lib/supabase/` — browser/server Supabase clients
- `.agents/skills/` — `frontend-design` + `ui-ux-pro-max` (use for all UI work)

## Core invariants (from ratified decisions — do not violate)

1. **Only signed-in votes count.** Anonymous visitors can play the full loop, but their votes are demo-only and never touch rankings.
2. **Votes are append-only; no rating math in the request path.** The batch Bradley-Terry cron fit is the sole source of truth; the vote write is a dumb insert returning matchup percentages + a cosmetic delta.
3. **Votable entities are character forms** split at major power tiers (Base Luffy ≠ Gear 5 Luffy). Never serve a same-character matchup (two forms of one character).
4. **Spoiler gating is first-class.** Users set arc progress at onboarding; matchups and tier-list views must never expose characters/forms/attributes beyond a user's selected arc. Hidden characters are simply absent (no "???" placeholders).
5. **Every votable form requires its own image** before it enters the roster. Character images are anime screenshots (copyrighted; founder accepted the risk — decision #29), stored in the project's own `character-images` bucket as webp. Non-default forms (Gear 5 etc.) launch only when their image exists.
6. **No monetization code, ever** (passion project). No progression/XP/bounty/streaks until v1.
7. **Rankings display raw from vote #1** — no placement masking or confidence gating in the UI.
8. **Dark arcade** visual identity — fighting-game character-select energy.

## Conventions

- Server Components for pages, Server Actions for mutations; Route Handlers only for cron/OG/auth callbacks.
- All schema/data is series-scoped from day one (verse #2 must be a content insert, not a rewrite).
- Auth: username/password + Discord OAuth via Supabase (Google intentionally dropped, 2026-07-10).
