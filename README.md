# Reelforge

**Reelforge** is an original, clean-room AI video generation studio (Phase 3).
Describe a shot, pick a tier, and the studio forges a real playable MP4 clip:
a credit ledger, a job lifecycle (`queued → dispatched → generating frames →
rendering video → completed`), storyboard keyframes composited into video with
Ken Burns motion and crossfades, optional pinned start/end frames, extend,
boards — and a Phase 3 edit layer: instruction-based **edit threads** with
tracked lineage, **reframe** (re-crop to a new aspect), **camera moves**
(virtual camera presets), and **remix** (one-click recipe handoff into the
Studio).

> **Working name.** "Reelforge" is a renameable placeholder chosen to be free of
> any third-party branding. To rename the product, search-and-replace
> `Reelforge` / `reelforge` across `src/`, `prisma/schema.prisma`, and this file;
> update the `LogoMark` SVG in `src/components/reelforge/bits.tsx` and the
> metadata in `src/app/layout.tsx`. No external assets or trademarks are
> referenced anywhere.

## Clean-room provenance

Every line of code in this app was written from a written spec for this project.
No code, assets, styling, copy, or branding from Luma AI, Dream Machine, Runway,
or any other commercial video product was copied or referenced. Pricing and
feature ideas were derived from public documentation research only.

## What's inside

- **Single-page app at `/`** with four in-page tabs:
  - **Studio** — prompt composer, Draft/Quality tier cards, duration selector,
    aspect ratio picker with mini previews, optional start- AND end-frame
    uploads (keyframe pinning: the clip runs start → storyboard → end),
    optional board name (type-to-create with suggestions), live cost preview,
    and a live job card (5-stage stepper, animated progress, video player +
    stills appearing as they land; polls `/api/jobs/[id]` every ~1.5s).
  - **History** — newest-first list (50 max) with play-badge thumbnails, prompt
    excerpts (edit children show their instruction as the cue + an `edit vN`
    version badge), tier/status/board chips, credits + provider cost,
    timestamps, re-run, **Edit clip**, **Remix**, **Extend +5s**, board filter,
    and a detail dialog with the video player, MP4 download, frame downloads,
    the full **edit-thread chain** (ancestors → self → descendants, click any
    row to jump), **clip variants** (re-crop / camera players with downloads),
    and Reframe / Camera-move launchers.
  - **Gallery** — responsive grid (1/2/3 columns) with board filter chips;
    finished clips play inline on hover (muted, looped) and open in a dialog
    player; older frame-only jobs keep the classic image grid with hover zoom
    and downloads; every card carries a **Remix** button that loads the job's
    recipe into the Studio. The video dialog also hosts the **share panel**
    (Phase 5): create an unlisted public link, copy/open it, or stop sharing.
  - **Insights (Phase 4)** — the Ops & Insights dashboard: cost-per-generation
    KPIs (totals, acceptance rate, granted vs spent, balance, provider cost,
    gross-margin proxy, avg cost per completed job), charts (jobs/day over 14
    days, credits by ledger kind, tier economics, top boards), a pipeline
    status funnel, the provider health card (now incl. the self-hosted GPU
    tier wiring) and the latest 15 ledger rows.
    Read-only telemetry fetched on tab activation + manual refresh (no
    background polling).
- **Public share pages (Phase 5)** — every finished clip can get an unlisted
  `/share/<token>` link: a zero-JS, server-rendered public page (video
  player, prompt, meta chips, keyframes, variant clips) with OpenGraph /
  Twitter-player metadata. Token minting and revocation are idempotent API
  calls; revoked links die instantly.
- **Real MP4 output** — the demo engine composites the ordered stills
  (optional start frame + 3 keyframes + optional end frame) into an H.264 /
  yuv420p / faststart clip at 30fps: per-segment Ken Burns zoom (alternating
  in/out) via `zoompan`, 0.5s crossfades via `xfade`, CRF 26 (draft) / 23
  (quality). Resolution follows tier + aspect: 16:9 → 1344x768 / 854x480,
  9:16 → 768x1344 / 480x854, 1:1 → 960x960 / 480x480. Total duration equals
  the requested seconds; no audio track. Files land in `public/generated/`.
- **Phase 3 edit layer** — all local ffmpeg, no provider call:
  - **Edit threads** — `POST /api/jobs/[id]/edit { instruction }` cuts a CHILD
    generation job through the standard charge path (tier rate × duration):
    `parentJobId` + `editInstruction` are persisted, the child prompt is
    parent prompt + `", " + instruction` (gracefully truncated to the 800-char
    limit), same tier/aspect/duration/board, fresh keyframes. Moderation runs
    on the instruction AND the composed prompt, fail-closed, before any
    charge. History rows show an `edit vN` badge (chain depth + 1) and the
    instruction as the excerpt; detail dialogs render the full thread chain.
  - **Reframe** — `POST /api/jobs/[id]/reframe { aspect }` re-crops the
    existing MP4 onto the target aspect's tier-aware canvas
    (`scale=…:force_original_aspect_ratio=increase,crop=…`), H.264 yuv420p
    faststart 30fps CRF per tier, duration preserved exactly. Flat **10
    credits**, ledger kind `transform`. Output
    `/generated/<jobId>-reframe-<aspect>.mp4` (aspect without the colon, e.g.
    `-9x16`), recorded as an Asset of kind `reframe` with a human label
    ("9:16 crop") and `variantKey` for idempotency — replaying the same aspect
    returns the existing variant without a second charge.
  - **Camera moves** — `POST /api/jobs/[id]/camera { preset }` re-renders the
    job's ordered stills (start → keyframes → end) with a virtual camera
    preset: `push-in` / `pull-back` (zoom 1.0 ↔ 1.14) or `drift-left` /
    `drift-right` (constant 1.08 zoom with a horizontal pan across the padded
    canvas), crossfades as in Phase 2. Flat **15 credits**, kind `transform`, output
    `/generated/<jobId>-camera-<preset>.mp4`, Asset kind `camera` with label;
    idempotent per (job, preset).
  - **Remix** — client-side recipe handoff (no charge, no job): Remix on any
    History row / detail dialog / Gallery card prefills the Studio with the
    job's prompt, tier, duration, aspect and board, and fetches its first
    keyframe into the start-frame slot as a data URL. The user is charged only
    when they hit "Forge video" (own idempotency key).
  - Transform charges use the same atomic `$transaction` pattern as
    generation (locked user read → balance check → debit + append-only ledger
    row + Asset row); rendering happens BEFORE the charge, so a failed ffmpeg
    run never costs credits.
- **API routes** (Next.js App Router handlers under `src/app/api/`):
  - `POST /api/generate` — moderation gate (fail-closed, 400, no debit) →
    validation → credit check (402 if insufficient) → atomic debit +
    append-only ledger entry + Job + Generation → async provider dispatch.
    Accepts optional `startFrame` / `endFrame` (base64 image data URLs), an
    optional `board` label, and an `idempotencyKey` (replays return the
    original job).
  - `GET /api/jobs` — newest first, limit 50 (includes `videoPath`, `board`,
    `endFramePath` when present).
  - `GET /api/jobs/[id]` — job detail incl. frames landed so far + video.
  - `POST /api/jobs/[id]/rerun` — new job, charged again at full price.
  - `POST /api/jobs/[id]/extend` — Phase 2 extend: new 5s job charged at tier
    rate × 5, start frame = the source job's last visual (end frame or final
    keyframe), prompt prefilled with an original continuation cue, same
    tier/aspect/board.
  - `POST /api/jobs/[id]/edit` — Phase 3 edit thread (see above).
  - `POST /api/jobs/[id]/reframe` — Phase 3 re-crop (flat 10 credits).
  - `POST /api/jobs/[id]/camera` — Phase 3 camera move (flat 15 credits).
  - `GET /api/credits` — balance + last 10 ledger transactions (kinds include
    `transform` since Phase 3).
  - `POST /api/providers/fal/webhook` — signed webhook endpoint for the fal
    adapter (inactive unless configured).
- **Provider adapters** (`src/lib/providers/`):
  - `DemoProvider` (active by default) — simulates the full lifecycle
    (dispatched ~1.2s, progress persisted to DB, moderation, video composite)
    and renders 3 storyboard keyframes. It first tries the server-side
    `z-ai-web-dev-sdk` image generation API; on any failure or timeout it falls
    back to original SVG placeholder art (branded gradient + prompt text,
    rasterized to PNG) at the exact same paths. After the storyboard lands it
    composites the real MP4 (see above); if ffmpeg fails or times out the job
    still completes with frames only — video is always best-effort.
  - `FalStubProvider` — a complete fal.ai-style queue adapter (submit →
    `request_id`, status polling `IN_QUEUE|IN_PROGRESS|COMPLETED`, result
    fetch, webhook shape). Gated behind env vars and **never active without
    configuration**.
- **Prisma + SQLite** models: `User` (singleton demo user, 500 starting
  credits), `Job` (incl. `endFramePath`, `board`, Phase 3 `parentJobId` +
  `editInstruction`), `Generation` (incl. `videoPath`), `CreditTransaction`
  (**append-only ledger**, kinds `grant | generation | refund | transform`),
  `Asset` (`frame | startFrame | endFrame | video | reframe | camera`, Phase 3
  `label` + `variantKey` on variants). All Phase 3 columns are additive and
  nullable — pre-Phase-3 rows render unchanged.
- **Theming**: dark zinc studio with an orange-500/amber accent, `next-themes`
  light/dark switch with dark as default, sticky safe-area-aware footer,
  mobile-first with 44px touch targets, keyboard-accessible tabs and controls.

## Credits & pricing mapping

| Tier | Credit rate | Example (5s) | Provider reference cost |
| --- | --- | --- | --- |
| Draft | 10 credits/sec | 50 credits | $0.08 per 5s (pro-rated) |
| Quality | 40 credits/sec | 200 credits | $0.40 per 5s (pro-rated) |
| Reframe (re-crop) | flat | 10 credits | $0 (local ffmpeg) |
| Camera move | flat | 15 credits | $0 (local ffmpeg) |

New users start with **500 play-money credits**. Charges are debited atomically
with the job record and logged to the append-only `CreditTransaction` ledger
(negative `amount` = charge; the initial grant is `+500`). `providerCostUsd`
records the reference cost of the simulated provider call for cost
transparency. Edit threads charge the normal generation rate (tier × duration);
reframe/camera transforms charge flat amounts under the `transform` ledger
kind with `providerCostUsd = 0`.

## Provider wiring (env vars)

Create/edit `.env` next to `package.json`:

```bash
DATABASE_URL=file:/home/z/my-project/db/custom.db

# Optional tier 1 — self-hosted open models (Wan 2.2 class) behind any
# queue-style gateway. Takes precedence over FAL when set.
SELFHOSTED_URL=https://gpu.example.com
SELFHOSTED_MODEL=wan2.2-t2v-5b
SELFHOSTED_API_KEY=bearer-token        # optional

# Optional tier 2 — fal.ai-style hosted queue adapter.
FAL_KEY=your-key
FAL_MODEL=reelforge/storyboard-v1   # model id to submit to
FAL_WEBHOOK_SECRET=shared-secret    # checked on /api/providers/fal/webhook

# Public origin for absolute OpenGraph URLs on share pages.
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Precedence in `resolveProvider()` (`src/lib/providers/index.ts`):
**selfhosted → fal → demo**. Without `SELFHOSTED_URL` and `FAL_KEY`, the
`DemoProvider` runs and no external provider is contacted. The self-hosted
adapter (`src/lib/providers/selfhosted.ts`) submits to a two-endpoint queue
API (`POST /v1/video/jobs`, `GET /v1/video/jobs/{id}`), mirrors remote
progress into the job, and ingests the finished MP4/frames into
`public/generated/` (falling back to remote URLs if downloads fail) — the
report's cost-control tier with no per-second vendor billing.

## Ops & Insights (Phase 4)

Two read-only GET endpoints power the fourth tab:

- **`GET /api/insights`** — one aggregated snapshot (`src/lib/insights.ts`):
  totals (jobs, completed/failed, acceptance rate = completed-with-video /
  total, credits granted/spent, provider cost sum), per-tier stats (draft vs
  quality: jobs, credits, provider cost, avg cost per job), jobs per day over
  the last 14 UTC days (zero-filled), ledger totals by kind, top boards,
  the latest 15 ledger rows and a status breakdown. All computed with grouped
  Prisma queries — no N+1.
- **`GET /api/providers/health`** — provider/system status (`src/lib/health.ts`):
  active provider (`demo`, `fal` or `selfhosted`), whether `FAL_KEY` /
  `SELFHOSTED_URL` are configured (plus the self-hosted model id as a display
  string), ffmpeg availability + version (probed once per process with a 5s
  timeout and cached), last job time, trailing 5-minute job activity and the
  demo balance (drain guard). **Booleans and safe display strings only** — env
  values and secrets are never included in responses.

**Revenue-proxy assumption**: the Insights tab reports a play-money revenue
proxy of **$0.01 per credit spent** (report draft retail table: 50 credits =
$0.50). Gross margin = (revenue proxy − provider cost) / revenue proxy; both
are shown with a UI footnote. Credits are play money — no real billing exists
in this build.

Charts use the shadcn chart wrapper (`src/components/ui/chart.tsx`) with the
theme's zinc/orange/amber chart tokens, translucent series fills and dashed
gridlines; empty datasets render friendly placeholders instead of empty
recharts arrays.

## Share pages (Phase 5)

Every finished clip can get an **unlisted public share link** from the Gallery
dialog (`Create share link`):

- `POST /api/jobs/:id/share` mints a 32-hex capability token stored on the Job
  row (`shareToken` / `sharedAt` columns); `DELETE` revokes it. Both are
  idempotent, and only completed jobs can be shared. Revoking and re-sharing
  mints a fresh token, so old links stay dead.
- `/share/<token>` is a **zero-JS server-rendered page** (no auth — the token
  is the capability): branded dark layout with the video player, prompt, meta
  chips, keyframe strip, reframe/camera variant players, and OpenGraph +
  Twitter-player metadata (`NEXT_PUBLIC_SITE_URL` sets the absolute origin).
- Unlisted by design: `noindex, nofollow` meta plus a `Disallow: /share/`
  rule in `public/robots.txt`.

## Development notes

- Next.js 16 App Router + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma.
- `bun run db:push` applies the schema; `bun run db:generate` regenerates the client.
- `bun run lint` should stay at zero errors.
- Generated keyframes and MP4 clips are written to `public/generated/` at runtime.
- After changing `prisma/schema.prisma`, regenerate the committed serverless
  seed with `bun run scripts/make-seed-db.ts` (schema-only SQLite file used
  by cold starts on Vercel).

## Serverless deployment — Phase 6 runtime layer

The app deploys to Vercel-style serverless platforms as-is. All platform
logic lives in `src/lib/runtime.ts`:

- **ffmpeg** resolves in priority order: `FFMPEG_PATH` env override →
  `/usr/bin/ffmpeg` (sandbox parity) → bundled `ffmpeg-static` binary → PATH.
  Locally nothing changes; serverless gets the bundled 7.x static build
  (libx264 included).
- **Media storage**: locally generated files land in `public/generated/` and
  are served as static assets exactly as before. On serverless they land in
  the writable `/tmp/reelforge-generated` scratch dir, and an afterFiles
  rewrite (`/generated/*` → `/api/media/*`) streams them through a
  Range-aware route handler — every stored `/generated/...` path, player,
  download link and OG tag keeps working on both platforms.
- **Database**: `DATABASE_URL=file:/tmp/reelforge.db` on serverless; the
  committed `prisma/seed.db` (schema only) is copied into place on cold
  start, and the demo user + opening grant bootstrap lazily on the first API
  hit. **Demo-mode storage is per-instance and ephemeral** — data resets on
  cold starts and is not shared across concurrent instances. For a durable
  deployment, point `DATABASE_URL` at Turso/Neon/Postgres instead; the
  bootstrap simply no-ops.
- **Background jobs**: the generation pipeline runs after the HTTP response
  via the platform `waitUntil` hook (`afterResponse` in runtime.ts), so jobs
  progress while the client polls. The consolidated API route exports
  `maxDuration = 60` to hold the function open long enough for the demo
  lifecycle (~15–35s).
- **Single-function API**: every /api/* endpoint is served by ONE optional
  catch-all route (`/api/[[...path]]` → `src/lib/api-dispatch.ts`) because
  Vercel gives each App Router route file its own serverless function — and
  its own isolated /tmp. Consolidating keeps the demo database, rendered
  media, and share tokens coherent across requests. The share pages are
  stateless: they fetch `GET /api/jobs/shared/:token` from the consolidated
  function instead of reading the database directly.
- **Keyframe SDK**: the z-ai image SDK import is dynamic; environments where
  it cannot initialize fall through to the branded placeholder frames.

Vercel env vars for the demo deployment:

```
DATABASE_URL=file:/tmp/reelforge.db
NEXT_PUBLIC_SITE_URL=<your deployment URL>   # absolute OG URLs on share pages
```

No provider keys are required — the demo provider renders real MP4s from
placeholder/storyboard frames with the bundled ffmpeg.

## System requirements

- **ffmpeg** — video compositing shells out to the resolved ffmpeg binary
  (`FFMPEG_PATH`, `/usr/bin/ffmpeg`, the bundled `ffmpeg-static`, or PATH —
  see the Phase 6 section; any modern build with `libx264` works). If ffmpeg is
  missing, fails, or exceeds its ~110s budget, video rendering is skipped
  gracefully and jobs still complete with frames — the app never hard-fails
  because of video rendering. The same applies to the Phase 3 transforms: a
  failed re-crop or camera render returns a clean `render_failed` error and
  never charges credits.

## Out of scope (Phase 3)

- **Public share pages** (real external URLs for clips) are deliberately NOT
  part of Phase 3 — the sandbox only exposes the `/` route. A future phase can
  add a share route + OG cards on top of the existing Asset table.
- Do NOT add page routes beyond `/`; all functionality lives in the single-page
  app and its API handlers.
