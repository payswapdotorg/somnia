# Somnia

**Somnia** is an original, clean-room AI video studio: describe a dream and it
renders a real, playable MP4 — with a 16-keyframe timeline, prism image mode,
boards, a public ideas feed, unlisted share links, per-user credits with an
honest ledger, developer API keys and agent runs.

> **Brand.** "Somnia" is the working identity (`src/lib/brand.ts` funnels every
> user-facing string and token through one module). Rename by editing that one
> file plus the metadata in `src/app/layout.tsx`.

## Clean-room provenance

Every line of code in this app was written from a written spec for this
project. No code, assets, styling, copy, or branding from Luma AI, Dream
Machine, Runway, or any other commercial video product was copied or
referenced. Feature and pricing shapes were derived from public documentation
research only, under original names (Pulse / Prism models, credit pools).

## What's inside

- **Multi-user accounts** — scrypt password hashing, hashed opaque session
  cookies (`HttpOnly`, 30 days), per-user data isolation on every query, and an
  env-gated Google OAuth scaffold.
- **The composer (`/`)** — video (Pulse 3 / Pulse Flash × 540p/720p/1080p ×
  7 aspect ratios × 5s/10s, HDR 2x, free loops, up to 16 pinned keyframes) and
  prism image mode; brainstorm variants; board filing; a live cost preview
  computed with the same `src/lib/plans.ts` math the server charges by; job
  polling through the render pipeline to the finished clip.
- **Render pipeline** — queued jobs are driven to real ffmpeg MP4s: pinned
  keyframe timelines or generated storyboard beats, Ken Burns compositing at
  540p/720p/1080p across all seven aspect ratios, prism poster stills for
  image jobs, refund-on-failure, idempotent re-processing.
- **History (`/history`)** — every dream with its recipe: extend (+5s),
  modify (instruction jobs with lineage), reframe (aspect variants),
  upscale (4K), unlisted share links, and one-click remix prefill back into
  the composer.
- **Explore (`/explore`)** — the public ideas feed of shared, completed
  dreams: hover-to-play cards, likes (session-aware), page-based pagination.
- **Boards (`/boards`)** — file dreams into boards, share a whole board via
  one unlisted `/boards/<token>` link; deleting a board never deletes dreams.
- **API keys (`/keys`)** — mint `sk_somnia_…` keys (hashed at rest, plaintext
  shown exactly once, revocable); every `/api` route accepts session cookie or
  `Authorization: Bearer`.
- **Plans (`/plans`)** — the public credit ladder: Trial (1,000 one-time),
  Spark $30/10k, Studio $90/40k, Infinite $300/150k monthly credits with
  agent multipliers and queue priority.
- **Agent runs (`/agents`)** — describe a goal, review the plan-gated
  variation set (trial 2 · spark 2 · studio 4 · infinite 6 shots), dispatch
  it, and watch every linked job poll to settlement with its rendered clip —
  all behind the same credit ledger.
- **Share pages** — `/share/<token>` (job) and `/boards/<token>` (board):
  zero-JS, server-rendered, unlisted by design (noindex + robots.txt).
- **Marketing landing** — signed-out visitors to `/` get an original hero,
  the six product pillars and the public plan catalogue instead of the
  composer (no session probing — one public `/api/plans` fetch).
- **Hosted provider tiers** — `SELFHOSTED_URL` (queue-style GPU gateway)
  and `FAL_KEY` (fal.ai-shaped queue) take over the VIDEO render path
  end-to-end: submit, poll with mirrored progress, ingest the finished MP4;
  the demo pipeline stays the always-available fallback.

## Credit economics (from `src/lib/plans.ts`)

Per-clip cost = 5s base by model × resolution, ×3 for 10s, ×2 for HDR, loops
free. Modify is 5x base; extend is the plain 5s base; reframe 10, upscale 200,
image 20 — all flat. Failed generations refund in full. Every job stores
`creditsCharged` and `providerCostUsd`.

| Model       | 540p | 720p | 1080p |
|------------|------|------|-------|
| Pulse 3    | 60   | 100  | 400   |
| Pulse Flash | 25  | 40   | 160   |

(5s base credits; 10s = 3x.)

## The API surface (one serverless function)

Every endpoint ships behind the single catch-all `src/app/api/[[...path]]/route.ts`
→ `src/lib/somnia-api.ts` (route table in that file's header comment):
`auth/*`, `plans`, `credits`, `brainstorm`, `generate`, `image`, `jobs/:id`
(+ `extend|modify|reframe|upscale|remix|share|like`), `jobs/shared/:token`,
`boards` (+ `:id`, `:id/share`, `shared/:token`), `keys`, `agents`,
`ideas`, `media/*` (Range-aware streaming), `providers/health`.

## Running locally

```bash
bun install                 # or npm install
cp .env.example .env        # set DATABASE_URL; add provider keys only when wiring real GPUs
bunx prisma db push         # create the SQLite schema
bun run dev                 # http://localhost:3000
```

System requirement: `ffmpeg` (v6+) on PATH — the pipeline composites real MP4s
with it (bundled `ffmpeg-static` is the fallback). Sign up in the browser: the
trial grant is 1,000 credits, no card required.

## Tests

```bash
bun run test                # 217 specs: domain core, HTTP surface, render pipeline, UI contracts
```

Domain (ledger, brainstorm, inputs, plans), engine, social, apikeys, agents,
auth, the full HTTP dispatcher (43 specs), the ffmpeg pipeline (real MP4s),
the hosted provider adapters (14 specs against a scripted local HTTP
gateway), and jsdom contract tests for every UI surface (auth, composer,
explore, history, boards/keys/plans, agents, landing).

## Wiring real generation providers

Two hosted tiers slot behind the render pipeline (`src/lib/providers/`),
resolved cost-control-first:

1. **Self-hosted GPU gateway** — set `SELFHOSTED_URL` (any queue-style
   wrapper around Wan 2.2 / LTX-2.5 / HunyuanVideo; optional
   `SELFHOSTED_MODEL`, `SELFHOSTED_API_KEY`). Contract:
   `POST {url}/v1/video/jobs` `{model, prompt, resolution, duration_sec,
   aspect_ratio, hdr, loop, start_frame?, end_frame?}` → `{id}`, then
   `GET {url}/v1/video/jobs/{id}` → `{status, progress?, error?,
   video_url?, frames?}`. Remote progress is mirrored into the job row; the
   finished MP4 is downloaded into `public/generated/<jobId>-provider.mp4`
   (remote-URL fallback if the download fails).
2. **fal.ai-style queue** — set `FAL_KEY` (optional `FAL_MODEL`, and
   `FAL_QUEUE_BASE` to retarget the queue origin). Submit → status poll →
   result fetch, `Authorization: Key <FAL_KEY>`.

Hosted tiers render VIDEO jobs only (prism stills always stay local); a
pinned timeline sends its first/last frames as `start_frame`/`end_frame`
(that is what i2v/t2v models accept). Failures flow through the same engine
refund path as local renders — a failed hosted job never costs credits.
Without keys the demo pipeline renders branded storyboard beats; the health
endpoint (`/api/providers/health`) always names the active tier.

Adapters are pure HTTP + download — the pipeline owns every database write,
so hosted and local renders share identical ledger, refund and asset
semantics (pinned by `tests/providers.test.ts`, 14 specs against a scripted
local gateway).

## Serverless notes (Vercel)

`DATABASE_URL=file:/tmp/somnia.db` on Vercel; `src/lib/db.ts` copies the
committed schema-only seed (`prisma/seed.db`, regenerated via
`bun run scripts/make-seed-db.ts` after schema changes) on cold start.
Demo storage is ephemeral per-instance by design — point `DATABASE_URL` at
Turso/Neon/Postgres for durable data. Mutating routes export
`maxDuration = 60`; generation runs through `afterResponse`/`waitUntil`.
Set `NEXT_PUBLIC_SITE_URL` for absolute OpenGraph URLs on share pages.
