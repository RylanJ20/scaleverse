# PRODUCT_PLAN.md — Community Power-Scaling Arena (Launch Verse: One Piece)

## 0. Ratified Decisions (signed off by founder, 2026-07-02)

> This decision log is authoritative. Where the body of this document (written before sign-off) conflicts with a decision below, **the decision below wins**. Sections still to be reconciled are marked ⚠️.

| # | Decision | Founder's call | Notes |
|---|---|---|---|
| 1 | Brand scope | **Series-agnostic** — One Piece is the launch verse, not the brand | As planned |
| 2 | Name | **Scaleverse** | Validate domain/trademark before launch |
| 3 | Ranking engine | **Batch Bradley-Terry (10-min cron) + instant cosmetic feedback** | As planned |
| 4 | Character versions | ⚠️ **Votable forms from day one** — Base Luffy and Gear 5 Luffy are separate entries | Supersedes §4's "one entity per character" |
| 5 | Form granularity | **Major power tiers only** — split only where the fandom debates them as different fighters (~2-3 entries for top characters) | Not every transformation |
| 6 | Same-character matchups | **Never** — Base Luffy vs Gear 5 Luffy is not a servable matchup | Matchmaking excludes same-character pairs |
| 7 | Roster size | ⚠️ **150+ comprehensive** (before form-splitting) | Supersedes §8's 64-character roster |
| 8 | Spoiler handling | ⚠️ **Per-user arc-progress gating at MVP** — arc-picker onboarding ("where are you in your One Piece journey?"), matchups curated to user's progress | Supersedes §8's "curation-only at MVP"; the v1 gating system moves into MVP |
| 9 | Tier list for non-caught-up users | **Hide unknown characters** with a "N hidden by your spoiler settings" note | No ??? placeholders |
| 10 | Anonymous voting | **Play free, only signed-in votes count**; soft prompt after ~5 demo votes | As planned |
| 11 | Character visuals | ⚠️ **Founder-supplied images** — *corrected 2026-07-02:* these are official anime screenshots (Toei/Shueisha copyright), not original art; see #29 | Supersedes typographic-card strategy |
| 12 | Form images | **Every votable form requires its own image** — no fallbacks | Art supply gates roster entries |
| 13 | Art vs launch | **Launch with what's ready** (~60-80 entities with art), grow toward full roster as art lands | Roster additions become content events |
| 14 | Progression (XP/bounty/streaks) | ⚠️ **None until v1** — launch is purely vote → reveal → tier list | Supersedes MVP "minimal profile" stats framing; profile stays but no gamification |
| 15 | Social at MVP | **Matchup of the Day + 140-char takes** (single moderated surface) | As planned |
| 16 | Auth providers | ⚠️ **Username/password + Google + Discord** (no email sign-in) — *revised 2026-07-02* | See #35 |
| 35 | Auth model | **Username is the login handle & public identity**; Supabase email-auth used underneath (real email if provided, synthetic if not). Recovery email is **optional** at signup. OAuth users pick a username via `/choose-username`. | Supabase has no native username auth |
| 17 | Tech stack | **Next.js App Router on Vercel + Supabase (auth + Postgres)** | As planned |
| 18 | Launch mode | ⚠️ **Public from day one** — no closed beta | Supersedes §10's closed-beta playbook |
| 19 | Early-ranking presentation | ⚠️ **Show everything raw** — full tier list and percentages from vote #1, no placement masking | Supersedes confidence-gating/Placement-section UX (the ranking math is unchanged) |
| 20 | Monetization | ⚠️ **Passion project — no monetization at all**, don't design for it | Supersedes §11 |
| 21 | Look & feel | **Dark arcade** — fighting-game character-select energy; `frontend-design` + `ui-ux-pro-max` skills installed for the build | |
| 22 | Matchup pages (SEO) | **Character-level pages, forms inside** — one canonical `/vs/luffy-vs-kaido` page per character pair; form matchups are sections within it | Votes still happen at form level underneath |
| 23 | Demo votes | **Separate `demo_votes` table**, fully isolated from real votes | Funnel analytics without ranking contamination |
| 24 | Arc timeline | **Single unified timeline per series** — each arc stores chapter + episode ranges; arc picker works for both manga and anime users | No separate anime/manga tracks |
| 25 | Roster seed data | **YAML-per-character in git + idempotent seed script** — roster changes are reviewable diffs | Public audit trail |
| 26 | Account deletion | **Votes die with the account** (full cascade); rankings adjust at the next batch refit | GDPR-clean; signed off 2026-07-02 |
| 27 | Spoiler enforcement depth | **App-layer gating** — DB content is world-readable; every UI query filters by arc progress; deliberate raw-API access is self-spoiling | DB-enforced gating rejected as over-engineering |
| 28 | Roster import | **All 344 OPdle characters imported**; `is_active` controls what's votable | OPdle project is the data source |
| 29 | Image rights | **Use the anime screenshots everywhere** (cards, share/OG images) — founder informed they are Toei/Shueisha copyrighted material and accepted the takedown risk | Plan §11's zero-copyrighted-imagery posture is superseded |
| 30 | Initial ratings | **Seed Bradley-Terry priors from OPdle's hand-tuned power_level** (mapped to θ ∈ [-2.5, 2.5], high SE); votes take over from there | Raw display from vote #1 still applies |
| 31 | Image hosting | **Copied into the scaleverse project's public `character-images` bucket** as ≤1024px webp | Projects decoupled; 18MB total |
| 32 | Matchup page empty state | **Raw community % from vote 1** (no seeded-rating prediction fallback) | Strictly honors #19 |
| 33 | Character-page spoilers | **Show all current-canon stats, gated by a one-tap page-level spoiler interstitial** if the character is beyond the viewer's arc | Not per-stat gating |
| 34 | Share/OG images | **Dynamic OG images now** via `next/og` + on-the-fly webp→PNG (Satori can't decode webp) | Matchup VS card + character card |

**Process note:** every decision from here on requires founder sign-off before implementation — no unilateral calls.

## 1. Vision & Positioning

**Working name: Scaleverse** (series-agnostic, ownable, expansion-ready). Alternates: **WhoWins.gg**, **PowerCourt**. The name must not contain "One Piece" — One Piece is the launch *verse*, not the brand.

Scaleverse is the place where anime power-scaling debates get settled by the crowd. Users play a rapid-fire voting game — "Who wins: Luffy vs Kaido?" — and every vote feeds a living, statistically rigorous community tier list. The tier list is the shared artifact people screenshot, cite, and argue about on Reddit, Twitter, and Discord; the sub-2-second voting loop is the game that keeps it alive. The positioning is "credible enough to cite, fun enough to grind": a Bradley-Terry-backed ranking with visible methodology, wrapped in a mobile-first arcade loop. One Piece launches first; the entire schema, spoiler system, and theming layer are built so verse #2 (JJK or Dragon Ball) is a content insert, not a rewrite.

## 2. Target Users & Core Insight

- **Power-scalers** (r/OnePiecePowerScaling, scaling Discords, r/whowouldwin): stake identity on being *provably right*. They want receipts — feats, chapter citations, a track record.
- **Casual fans**: want the fun of picking winners and seeing where the crowd lands.
- **Debate spectators/creators**: want a citable artifact ("per Scaleverse, 73% of 14k voters say Kaido").

**Core insight:** power-scalers' fundamental drive is being right in public. Every mechanic serves this: the vote is a wager, the community-% reveal is the payout, the tier list is the scoreboard, and the personal take record is the receipt. A lucky alignment does the heavy lifting: the matchups that are the most *fun* (genuinely debatable, near 50/50) are also the most statistically *informative* — engagement and ranking quality reinforce each other rather than trade off.

## 3. The Core Loop

One screen — **The Arena** (`/one-piece/arena`, also the default landing route):

1. Two typographic character cards (name, epithet, tier badge, signature palette/motif). Mobile: stacked in the thumb zone, tap or swipe. Desktop: side-by-side, ←/→ to vote, ↓ to skip ("can't call it" — recorded as signal).
2. Tap to vote → optimistic fire-and-forget write, hit-flash on the chosen card.
3. **Payoff overlay (~1.2s, tap-through):** animated split bar to community % ("Luffy 71% — Kaido 29%"), plus a verdict line — "With the crowd" or "**Hot take** — only 29% pick Kaido" (contrarianism styled as a reward). Below 25 votes on a matchup: "Early votes — results forming" instead of a misleading %.
4. Auto-advance. Next 3 matchups prefetched; vote-to-next-vote cycle **under 2 seconds**.
5. Votes are chunked into **10-vote Sets** with a progress ring; completing a Set shows a summary card (crowd-alignment score, your hottest take, "your votes helped push Zoro toward S") and a one-tap "Next set →".

**Anonymous visitors play immediately** — full loop, real reveals — but their votes are demo-only and never touch rankings. After 5 votes, a soft interstitial: "Sign in to make your votes count and get on the record" (one-tap Google/Discord OAuth). No merge machinery: "sign in to make it count" is the whole mechanic. This resolves the UX-vs-integrity contradiction cleanly — UX wins on play-first, integrity wins absolutely on counting.

## 4. The Ranking System

**Final calls (resolving lens disagreements):**

- **Algorithm: regularized Bradley-Terry MAP fit, batch-recomputed.** Not streaming Elo (order-dependent, drifts, un-citable), not Glicko-2/TrueSkill/WHR (machinery for changing skill; characters are static). The Tech lens's per-vote incremental Elo inside `cast_vote` is **rejected**: `cast_vote` only inserts the vote and returns fresh matchup percentages plus a *cosmetic* rating delta for the reveal. The batch fit is the sole source of truth.
- **Model:** P(i beats j) = sigmoid(θᵢ − θⱼ); Gaussian prior θ ~ N(seed, 1.0²). Fit via Newton/MM on the aggregated pair-count matrix — <100ms for a 64–150 roster, runs in a serverless function.
- **Display scale:** rating = 1000 + 173.7·θ (400 points = 10:1 odds), sum-to-zero anchored to the **fixed launch cohort** so cited numbers never silently drift as the roster grows. Head-to-head win probabilities surfaced everywhere.
- **Recompute cadence:** Vercel Cron every 10 minutes — read weighted pair counts, fit, atomically write ratings + tiers + one `rating_history` snapshot row per character. Rankings feel alive; correctness never depends on the request path.
- **Vote weighting formula (documented, one place):** `w = is_counted(authed) × reliability[0.1–1.0] × 0.5^(age_days/365)`. Reliability weights ship v1 (1.0 for all at MVP); age decay ships v1 with a 12-month half-life.
- **Matchup selection:** 70% competitive (|gap| < 175 pts — max fun *and* max Fisher information) / 20% uncertainty-coverage (low vote count, new characters) / 10% wildcard (meme fights; keeps the comparison graph connected). Never re-serve a pair to the same user within **30 days**. Marquee matchups are served via the Daily Event, not the mix.
- **Versions/forms policy: one votable entity per character at "current canon strongest."** Luffy = Gear 5 Luffy; dead legends at prime; Kaido/Big Mom at full health. Schema is version-grained from day one (`character_versions`, exactly one `is_default` per character) and forms exist as display metadata with `reveal_arc_id` — but zero non-default votable versions at launch. Whether versions ever become votable is a v2 decision gated on vote density. A public **canon-assumptions page** channels the inevitable disputes.
- **Tiers:** S/A/B/C/D/F percentile bands (5/10/20/30/25/10) over confidence-qualified characters, with hysteresis (change tier only if >15 pts past a boundary or 3 consecutive fits across it). Low-confidence characters sit in a separate "Placement" section, never mis-ranked in tiers. Tier computation isolated behind one function (swappable to gap-based clustering if percentiles feel arbitrary).
- **Confidence:** MVP = 25-vote threshold; v1 = true standard errors from the inverse Hessian, displayed as gamer-native badges: *Placement* (SE > 0.35) → *Settling* → *Established*. Detail pages show explicit ± bands.
- **Crowd-% vs model-rating disagreement** (they will visibly diverge): matchup pages show raw head-to-head % as primary, with model win-probability labeled "expected from ratings," plus a static methodology explainer. Pre-empts "rigged" accusations.

## 5. Feature Set

### MVP (the hard-capped launch set)

| Feature | Description | Why MVP |
|---|---|---|
| OAuth login (Google/Discord) + anon demo mode | Authed-only counted votes; anon plays display-only, soft gate at 5 votes | Conversion + integrity floor |
| Arena loop | Sub-2s vote → reveal → next, Sets of 10, skip button, prefetch | This IS the product |
| Batch BT engine + 10-min cron | Weighted fit, anchored scale, per-fit snapshots | The credibility engine |
| Tier list page | S–F rows, movement carets, Placement section, "Disagree? Vote." deep links | The shared artifact |
| 64-character roster, arc-versioned seed data (YAML in git) | Curated to a conservative arc cutoff (through Wano; no Egghead/Elbaph/Imu) | Convergence math + spoiler safety by curation |
| Typographic SVG character cards | Parametric component: name, epithet, palette, motif — zero copyrighted art | Legal survival + visual identity |
| Share cards (@vercel/og) | Tier-list snapshot + matchup result cards, dated + watermarked | The organic acquisition artifact |
| Minimal Matchup of the Day | One featured pair, 140-char "defend your pick" takes (single moderated surface) | Anti-empty-room concentration |
| Programmatic matchup pages | `/one-piece/vs/[slug]`, canonical slugs, vote-threshold index gating, FAQ JSON-LD | SEO one-way doors, cheap now |
| Integrity floor | Signed deal tokens, server-dealt matchups, UNIQUE(user, matchup), rate limits, append-only log, ip_hash/UA logging, Turnstile on signup | Cannot be retrofitted; log data must exist from day one |
| Legal bundle | ToS, privacy, DMCA agent ($6), 13+ gate, disclaimer, integrity + canon-assumptions + methodology pages | Safe harbor requires it pre-UGC; docs pre-empt legitimacy attacks |
| Minimal profile | Votes cast, streak, agreement-%, top hot take (one SQL view) | Identity seed at near-zero cost |

### V1 (weeks after launch, once there's a crowd)

| Feature | Description | Why V1 |
|---|---|---|
| Full spoiler gating | Per-user arc progress (anime/manga-current presets), existence/attribute/image gating | Complex; MVP roster curation covers launch |
| Bounty progression | `xp_events` ledger, Berry bounty, East Blue → Yonko-level titles, cosmetic-only unlocks | Retains users you now have |
| Daily Main Event + streaks | Streak = ≥1 counted vote per rolling 36h window; freezes; Main Event = bonus XP | Habit layer on a proven loop |
| Per-matchup debate threads | Vote-badged comments, best-case-per-side pinning, reports/shadow-mute, admin UI | Needs crowd + mod capacity |
| Feat database | Chapter-cited feat cards, community submission + admin queue, ~300 seeded | Evidence moat; can't launch empty |
| Reliability weights + brigade detection | Silent [0.1–1.0] weights, velocity anomaly dampening, "contested" badges, forensics dashboard | Built on MVP's logs when attacks become real |
| True SEs + Placement badges | Hessian-based uncertainty replacing vote-count proxy | Upgrade, not blocker |
| Character detail pages | Sparklines, best wins/worst losses, most contested, head-to-head lookup, OG images | The citation surface |
| Roster waves + cold-start machinery | Monthly themed additions, seeded priors, placement boost | Content beats as retention events |
| Leaderboards + Called It | Best Debaters / Contrarian (credibility-gated) / Most Active; weekly snapshot-diff vindication job | Endgame for regulars |
| Notifications + weekly State of the Meta | Replies, pins, Called It; auto-generated movers report + Discord webhook | Retention infrastructure |
| Supporter tier ($3–4/mo) | Cosmetics, share-card skins, analytics; Ranking Integrity Pledge | Monetization after identity exists |

### Later

| Feature | Description | Why Later |
|---|---|---|
| Verse #2 + Crossverse Arena | JJK or Dragon Ball; cross-verse fights quarantined in their own rating pool | Needs a proven first verse (~100k+ votes) |
| Sybil hardening | Fingerprint clustering, trust tiers, audit matchups, optional phone verify | Build when telemetry proves need |
| Follow graph & feeds | Follow users/characters, rivalry stats | Noise without content volume |
| Realtime | Broadcast channels for featured-event threads only | Tier limits; ISR covers liveness |
| Era ladders / condition matchups | "Marineford-era" seasonal ladders, never polluting the main pool | Anti-convergence-boredom content |
| Scale escape hatches | Vote partitioning, materialized tier views, windowed refits | Documented, not built |

## 6. Community & Social Design

- **Identity = the Take Record.** Every vote silently builds a personal tier list; the profile shows agreement-%, hottest takes, and (v1) Called It trophies. The "My Takes vs. The Community" diff card is the highest identity-per-engineering-hour asset in the product.
- **Concentrate, don't fragment.** At launch, all discussion lives in one Matchup-of-the-Day surface (140-char takes). Per-matchup threads arrive v1 with vote-badging ("Team Kaido" stamped from your actual vote) and best-case-per-side pinning so minority voters get a stage instead of a pile-on.
- **One Piece-native flavor as a pluggable theme:** Bounty in Berries, rank titles, "Chronicler" badges for approved feat contributors — all in a config object so verse #2 swaps flavor without code.
- **Vote changes are allowed** (latest opinion counts, history logged, rate-limited to 1 change per matchup per week). Public "changed my vote" flips are great community content and remove the incentive for duplicate accounts.
- **Moderation:** MVP = report button, `profiles.role`, SECURITY DEFINER mod functions run from Supabase Studio, rate limits, banned-terms list, one-page community rules. Recruit first volunteer mods from the v1 Best Debaters board. Username policy: citext-unique + reserved/profanity denylist.

## 7. Vote Integrity

**Architecture keystone (unanimous across lenses — protected):** append-only vote events + rankings as a re-runnable weighted batch job. Every future trust decision — downweight a user, void a brigade window, change the algorithm — is retroactive and reversible. Poisoned votes never bake in.

**Launch defenses:** authed-only counted votes (anon = demo, hard red line — never a tuning knob; Supabase anonymous-auth sessions checked via the `is_anonymous` claim and routed to the demo path); DB-enforced UNIQUE(matchup_id, user_id) with revote-overwrite into an event log; server-dealt matchups with short-lived signed tokens recording a `deals` row (dealt_at, outcome voted/skipped/expired — also the skip-signal home); randomized left/right presentation; **minimum inter-vote spacing (~1.5s) enforced server-side** (not served→voted latency, which prefetching breaks); burst-tolerant rate limits (20/min burst, 500/hr, 1500/day) in the RPC plus Vercel WAF rules; per-IP signup caps + disposable-email denylist; Turnstile on signup only — never inside the loop; ip_hash (salted, 90-day retention), user_agent, and latency logged on every event from day one.

**Deferred (v1/later):** reliability weights (age ramp, calibration-matchup consistency bounded at 0.5× for aged normal accounts, behavioral penalties); velocity-based brigade dampening with public "contested" badges; escalation-only Turnstile on risk signals; forensics dashboard with three kill switches (zero-weight user, void window, recompute); fingerprinting and trust tiers.

**Explicit launch tolerances:** a determined human with five Gmail accounts gets through; VPN IP-cap evasion works; slow low-volume brigades land. All are bounded by rate limits and healed retroactively by weighting + recompute. **Meme-voting policy, decided now:** suppress in the canonical ranking via reliability weights and contested badges; no separate meme board at launch; the policy is stated publicly in the integrity page *before* the first incident.

## 8. One Piece Content Strategy

- **Roster:** exactly **64** hand-curated characters in four debate bands (≈12 god tier, 16 top, 20 mid, 16 fan-favorite/gag — gag capped at ~25%). 2,016 possible pairs; adjacent-rating matchmaking converges each character in ~30–50 votes, so a seeded beta produces a citable ladder in week one. Expand via monthly themed waves toward a ~150 cap.
- **Versions:** one entity per character at current-canon-strongest (see §4). Forms are spoiler-gated display metadata. Canon-assumptions page ships at launch.
- **Spoiler strategy — curation now, architecture later:** the MVP roster and all attribute text simply exclude everything past a conservative cutoff (through Wano: no Imu, no Gorosei-as-fighters, no Egghead/Elbaph content), with one blanket banner ("Contains content through Wano") and a one-tap spoiler-report button. The **schema is arc-indexed from day one** (arcs table with chapter *and* episode ranges; arc-versioned bounty/epithet/haki attribute rows; `reveal_arc_id` on forms and feats), so v1's per-user gating — existence, attributes, images filtered by `max_arc_index`, hidden names never shown even greyed — drops in without migration. Direct-URL/crawler access to matchup pages always renders (behind a dismissible interstitial); arc-gating applies to the Arena and browse surfaces, never to canonical URLs — resolving the spoiler-default vs SEO conflict.
- **Sourcing:** facts from the One Piece Wiki rewritten in original prose with chapter citations (facts aren't copyrightable; verbatim text drags in CC BY-SA — `/credits` page attributes anyway); AniList/Jikan for canonical naming; **zero scraped or commissioned-lookalike art, ever** — the parametric typographic card system is the art spec for the Arena too, not just share cards.
- **Pipeline:** seed data as YAML-per-character in git, loaded by an idempotent script — diffs are the public audit trail. Weekly ~30-minute chapter ritual (official release day only, never leaks): debuts, bounty/epithet changes, feats, arc boundaries. Anime-current pointer maintained manually (a permanent ops commitment under the split-cour schedule). v1 adds community feat submissions with admin approval + Chronicler badges. An admin **re-seed operation** (prior adjustment + public changelog entry) exists for final-saga canon earthquakes.

## 9. Technical Architecture

**Stack:** Next.js App Router on Vercel + Supabase (auth + Postgres). RSC for all pages; Server Actions for all mutations; Route Handlers only for cron/OG/auth/matchup-queue. Transaction-mode pooler (port 6543) everywhere.

**Data model (all series-scoped from day one):**

| Table | Purpose |
|---|---|
| `profiles` | auth.users extension: username (citext unique), role, denormalized vote_count |
| `series`, `arcs` | verse scoping; arcs carry chapter + episode ranges (spoiler index) |
| `characters`, `character_versions` | version-grained; exactly one `is_default` per character at launch |
| `character_attributes` | arc-versioned bounty/epithet/haki rows (attr_type + effective_arc_id) |
| `forms`, `feats` | display metadata + chapter-cited feats, both with reveal/arc gating |
| `matchups` | deduped pairs via UNIQUE(least, greatest), slug, denormalized tallies; created lazily on first deal (only ~300–500 SEO-target pairs pre-seeded) |
| `deals` | served matchups: user, token, dealt_at, outcome (voted/skipped/expired) |
| `vote_events` (append-only) + `votes` (current) | immutable log + latest-per-(user, matchup); fitter reads `votes` |
| `ratings`, `rating_history` | θ, SE, display rating, tier per version; per-fit snapshots |
| `xp_events` (v1) | append-only bounty ledger; bounty = SUM |
| `comments`, `reports`, `notifications` (v1) | social layer |

**Write path:** one SECURITY DEFINER RPC `cast_vote(deal_token, winner_version_id)` — validates the token and spacing, inserts the event, upserts the current vote, bumps matchup tallies, returns percentages + a cosmetic delta. **No rating math in the request path.** RLS denies all direct client writes to hot tables; the unique constraint, not app code, guarantees one vote per user per matchup.

**Rating computation:** Vercel Cron every 10 min runs the weighted BT fit over the pair-count aggregation and writes ratings/tiers/snapshots atomically. A weekly full-replay job re-validates from the event log and is where algorithm changes happen safely.

**Routes:** `/` → featured + movers; `/one-piece/arena` (loop), `/one-piece/tier-list`, `/one-piece/vs/[slug]`, `/one-piece/characters/[slug]`, `/u/[username]`, `/login`, `/auth/callback`, `/api/cron/*`, `/api/og/[slug]`, `/api/next-matchups`. Short paths (`/arena`, `/tiers`) 302 to the default series. Reversed matchup slugs 301 to canonical.

**Caching:** tier list ISR `revalidate = 60`; matchup pages `generateStaticParams` for top pairs + `revalidate = 300` + dynamicParams; character pages 3600 with on-demand tags. **Never revalidate per vote.** No cookies() in cached segments (the App Router footgun — verify static/ISR markers in `next build` before launch). Arena is a client island in a static shell. No Realtime at launch.

**Ops baseline:** Supabase PITR, migrations in repo, preview env, one-page incident runbook. Account deletion = anonymize profile + tombstone user_id (votes retained for replay); ip_hash purged at 90 days; both documented in the privacy policy. Accessibility: WCAG 2.1 AA — aria-live reveal bar, full keyboard play, reduced-motion payoff variant, non-color-only tier encoding. Analytics: Vercel Analytics + first-party events table tracking D1/D7 retention, votes/session, gate conversion, share→visit rate, graph connectivity, per-character vote Gini.

## 10. Growth, SEO & Launch Playbook

1. **Closed beta first (2–4 weeks):** 2–3 power-scaling Discords + r/OnePiecePowerScaling recruited as *founding communities*, voting through a curated top-pair graph. **Launch gate: ~20–25k votes, no top-64 character in Placement.** Percentages masked below 25 votes. Launch week framed as "Season 0 placement" so noise is the game, not a bug.
2. **Artifact-first seeding:** never link-drop r/OnePiece. Post *results* as OC ("After 25,000 votes, here's how the community ranks the Yonko") with the watermarked card, link in comments. Time every push to chapter drops.
3. **Creators as the primary launch channel:** 5–10 mid-size power-scaling YouTubers/TikTokers get early access + branded community leaderboards — the rankings become their video content. This, not SEO, is the launch bet.
4. **SEO as the 6–12 month slow burn:** canonical matchup slugs, vote-threshold index gating (noindex thin pages), unique server-rendered substance per page (verdict sentence, stat table, related links, FAQPage JSON-LD), segmented sitemaps, character hubs (v1) as the internal-link spine.
5. **Share cards are the viral unit:** invest real design effort in making the typographic card genuinely striking — it competes against actual character art. v1: minority-take cards and the weekly State of the Meta report.

## 11. Monetization & Legal

**Monetization:** zero at MVP — nothing slows the loop. V1: Supporter tier ($3–4/mo, Stripe): badge, flair, share-card skins, personal analytics, early verse access, ad-free-forever. Published **Ranking Integrity Pledge**: money never touches vote weight, matchmaking, or rankings. Later: at most one ad unit for logged-out SEO traffic; paid data/API tier for creators.

**Legal:** text-first visual identity, zero copyrighted or lookalike imagery anywhere (enforced on UGC avatars too); series-neutral brand and domain; unofficial-fan-project disclaimer; ToS (content license, anti-bot/anti-scraping — also the enforcement hook against vote rings), privacy policy (GDPR/CCPA basics, minimal collection, no behavioral ad tech), 13+ age gate, DMCA agent registered *before* any UGC exists, `/credits` CC BY-SA attribution.

## 12. Top Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Solo-dev scope collapse** (the composite "MVP" is 6 months) | Hard-capped MVP table above; ~8-week ship deadline; weekly ops checklist written pre-launch and capped at 30 min |
| **Cold-start ghost town** | Seeded closed beta gate (20–25k votes), masked low-vote %, Season 0 framing |
| **Convergence boredom** (settled list = dead loop) | Accept it's event-driven: chapter-drop recompute drama, monthly waves, Daily Event as the social floor; don't fight a content ceiling with streak mechanics |
| **Distribution failure** | One concentrated channel (founding creators/Discords), launch timed to a hype chapter; SEO treated as slow burn; real design budget on the share card |
| **Legitimacy rejection** ("normie rankings" / "rigged") | Canon-assumptions + methodology + integrity pages live at launch; confidence gates; contested badges; append-only log kept sacred |
| **Spoiler incident** (one-strike trust loss) | Conservative roster cutoff at MVP (no architecture to get wrong), spoiler-report button, full gating v1 |
| **IP takedown** | Text-first everything; neutral brand; DMCA agent pre-registered |
| **Hot-row/scale issues** | No rating math in request path; insert-only writes; documented fold-job and partitioning escape hatches |

## 13. Roadmap

**Phase 0 — MVP (≈8 weeks solo):** Weeks 1–2: schema + seed pipeline + 64-char YAML + card component. Weeks 3–4: Arena loop, cast_vote RPC, deals/tokens, auth + anon demo. Weeks 5–6: BT fit cron, tier list, share cards, matchup pages, MOTD-lite. Weeks 7–8: legal bundle, integrity floor, polish, closed beta start. *Forcing function: the loop must be deployed to a URL by week 4.*

**Phase 1 — V1 (≈8–10 weeks post-launch, shipped incrementally):** full spoiler gating → bounty/XP + streaks + Daily Main Event → debate threads + mod UI → feats (seed ~300) → reliability weights + brigade detection + forensics → character pages, leaderboards, Called It, notifications, State of the Meta → Supporter tier.

**Phase 2 — Expansion (month 6+, gated on ~100k+ credible One Piece votes):** verse #2 (JJK or Dragon Ball) as a hype event re-running the seeding playbook; Crossverse Arena as the quarantined marquee launch moment; era ladders and tournaments; sybil hardening as telemetry demands.

## 14. Open Questions for the Founder

1. **Verse #2:** Jujutsu Kaisen (current-gen heat) or Dragon Ball (evergreen canon)? Decide by Phase 1 end so seeding relationships can start early.
2. **Beta partners:** which 2–3 Discords/creators do you already have a path to? The launch plan depends on them existing — this is founder legwork, not code.
3. **Name/domain:** validate Scaleverse (or alternates) for trademark and domain availability before any URL ships — routes are a one-way door.
4. **Ops commitment:** the weekly chapter ritual + anime-pointer maintenance is permanent manual labor. Are you signing up for it indefinitely, or should a trusted-editor role be pulled forward into Phase 1?
5. **Votable versions (Gear 4 vs Gear 5 as separate entities):** deferred to v2, gated on vote density — but if the community demands it loudly, what density threshold flips the switch?
6. **Monetization timing:** ship the Supporter tier at Phase 1 end as planned, or delay until a DAU floor (e.g., 1k) is proven?
