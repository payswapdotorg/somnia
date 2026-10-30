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
  all behind the same credit ledger. Planning is LLM-first (`src/lib/planner.ts`:
  chat-completion shot decomposition, strictly sanitized JSON) with the
  deterministic angle builder as an always-available fallback — the run row
  records which planner produced the plan.
- **Share pages** — `/share/<token>` (job) and `/boards/<token>` (board):
  zero-JS, server-rendered, unlisted by design (noindex + robots.txt).
- **Marketing landing** — signed-out visitors to `/` get an original hero,
  the six product pillars and the public plan catalogue instead of the
  composer (no session probing — one public `/api/plans` fetch).
- **Hosted provider tiers** — `SELFHOSTED_URL` (queue-style GPU gateway)
  and `FAL_KEY` (fal.ai-shaped queue) take over the VIDEO render path
  end-to-end: submit, poll with mirrored progress, ingest the finished MP4;
  the demo pipeline stays the always-available fallback.
- **Margin lens (`GET /api/insights`)** — the caller-scoped economics
  snapshot: job totals, ledger flow, revenue proxy (consumed credits priced
  at the plan rate), provider cost, gross margin, and a per-(provider x
  model x resolution) tier table.

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

## Provider economics (from `src/lib/economics.ts`)

Provider cost is what a render costs the OPERATOR, stamped on the job at
dispatch time. Retail and cost use different duration ladders on purpose:
retail prices 10s at 3x (value ladder) while provider spend scales ~linearly
with render time (10s = 2x); HDR adds 1.5x compute; loops are free. Demo/local
composites cost $0. Numbers are clean-room planning estimates — pin actual
pricing via `SOMNIA_PROVIDER_COSTS` (JSON in the same shape as
`DEFAULT_PROVIDER_COSTS`, merged per provider/model/resolution) without a
code change.

| Provider USD / 5s | pulse-3 540p | 720p | 1080p | flash 540p | 720p | 1080p | prism still |
|--------------------|------|------|-------|------|------|-------|-------|
| selfhosted         | 0.04 | 0.09 | 0.22  | 0.02 | 0.05 | 0.13  | 0.004 |
| fal                | 0.06 | 0.12 | 0.30  | 0.03 | 0.06 | 0.15  | 0.01  |

The margin lens prices consumed credits (spend − refunds) at the caller's
plan rate (`usdPerCredit`: price / monthly credits; trial credits are free)
and reports gross margin = (revenue − provider cost) / revenue. Failed hosted
renders keep their cost stamp (real GPU/API money) while the customer is
refunded — the lens stays honest about failure economics.

## The API surface (one serverless function)

Every endpoint ships behind the single catch-all `src/app/api/[[...path]]/route.ts`
→ `src/lib/somnia-api.ts` (route table in that file's header comment):
`auth/*`, `plans`, `credits`, `insights`, `brainstorm`, `generate`, `image`,
`jobs/:id` (+ `extend|modify|reframe|upscale|remix|share|like`),
`jobs/shared/:token`, `boards` (+ `:id`, `:id/share`, `shared/:token`), `keys`,
`agents`, `ideas`, `media/*` (Range-aware streaming), `providers/health`.

## Running locally

```bash
bun install                 # or npm install
cp .env.example .env        # set DATABASE_URL (Postgres — e.g. a free Neon project)
bunx prisma db push         # create the schema on your Postgres database
bun run dev                 # http://localhost:3000
```

Storage is durable PostgreSQL (Neon since T10): `DATABASE_URL` must be a
`postgresql://…` connection string — the pooled Neon endpoint with
`pgbouncer=true&connection_limit=1` is the serverless-safe form. The
demo-ephemeral SQLite mode is gone; schema changes go through
`bunx prisma db push` like any Prisma app.

System requirement: `ffmpeg` (v6+) on PATH — the pipeline composites real MP4s
with it (bundled `ffmpeg-static` is the fallback). Sign up in the browser: the
trial grant is 1,000 credits, no card required.

## Tests

```bash
bun run test                # 352 specs: domain core, HTTP surface, render pipeline, UI contracts
```

The suite runs against a **dedicated throwaway Neon project** — set
`DATABASE_URL_TEST` in `.env` (never point it at the production database;
`tests/setup.ts` truncates every table between files). Domain (ledger,
brainstorm, inputs, plans, economics), engine, social,
apikeys, agents (+ LLM planner sanitizer), insights (the margin lens), auth,
the full HTTP dispatcher, the ffmpeg pipeline (real MP4s), the hosted
provider adapters (against a scripted local HTTP gateway), render truth
(placeholder flagging + the SDK availability probe), and jsdom
contract tests for every UI surface (auth, composer, explore, history,
boards/keys/plans, agents, landing).

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

### Demo-tier honesty (render truth, T14)

Without a hosted provider key the app never pretends otherwise — it says
what a "dream" actually is on that deployment:

- **`Job.placeholderRender`** — the render pipeline knows when a frame
  degraded to the branded placeholder (image SDK unreachable, e.g. on
  Vercel) and flags the job. The clip is still a real seekable MP4, but every
  surface says "simulated render": the composer's active-job card, history
cards + detail, explore cards, and the public share pages. Pinned timelines
  (the user's own imagery) and hosted-tier renders are never flagged.
- **`imageSdkAvailable`** in `/api/providers/health` — can the local image
  SDK initialize in this deployment? `demo` + `true` means composites of
  real generated keyframes (the dev sandbox); `demo` + `false` means
  placeholder art. Boolean only, like every other provider knob.
- **The composer notice** — signed-in users on a `demo` deployment see an
  amber note above the forge button spelling out what renders actually are
  there (and that charges/refunds still apply).

### Wiring the video tier in 5 minutes (operator runbook)

The routing/failover layer (T12) is built and waiting — going live is env
work on the Vercel project, not code:

1. Pick a tier (or both): set `FAL_KEY` (fal.ai) and/or `SELFHOSTED_URL`
   (+ optional `SELFHOSTED_MODEL`, `SELFHOSTED_API_KEY`) as Vercel env vars
   for production/preview/development — encrypted, set BEFORE the next
   deploy so no instance boots half-wired.
2. Optionally pin models to tiers: `SOMNIA_MODEL_ROUTES='
   {"pulse-3":"selfhosted","pulse-flash":"fal"}'` (unknown ids and
   malformed JSON are ignored; a pinned-but-unconfigured tier falls back to
   the cost-control chain).
3. Redeploy and verify: `GET /api/providers/health` → `activeProvider`
   flips off `demo`, `modelRoutes` shows the split, and the composer notice
   disappears. A real generation then lands a hosted MP4 ingested into the
   blob store (cross-instance durable, Range-seekable off the CDN).

That's the whole surface: `activeProvider: demo` in health is the only
remaining honest-placeholder line, and the UI around it tells the truth.

Adapters are pure HTTP + download — the pipeline owns every database write,
so hosted and local renders share identical ledger, refund and asset
semantics (pinned by `tests/providers.test.ts`, 14 specs against a scripted
local gateway).

## Serverless notes (Vercel)

`DATABASE_URL` is the pooled Neon connection string (serverless-safe:
`-pooler` host + `pgbouncer=true&connection_limit=1`) — storage is durable
Postgres, shared by every function instance, so a job created by
`POST /api/generate` is immediately visible to `GET /api/jobs`. Mutating
routes export `maxDuration = 60`; generation runs through
`afterResponse`/`waitUntil`. Set `NEXT_PUBLIC_SITE_URL` for absolute
OpenGraph URLs on share pages. (The pre-T10 per-instance SQLite seed
bootstrap is gone with the Postgres migration.)
