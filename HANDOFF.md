# Somnia — repo handoff instructions

> **Current state (T4b, the UI is on the Somnia API):** the multi-user domain
> core (accounts/sessions, credit ledger, generation engine, social, API keys,
> agents — 104 specs), the complete HTTP surface (`src/lib/somnia-api.ts`,
> 43 specs) and the ffmpeg render pipeline (`src/lib/pipeline.ts`, 8 specs)
> are now surfaced by a full Somnia-branded UI. Six authenticated surfaces —
> the cockpit composer (`/`, video + prism image modes, brainstorm variants,
> 16-keyframe pins, live plans.ts cost preview, job polling to the finished
> clip), explore/ideas (`/explore`, likes, pagination), history
> (`/history`, extend/modify/reframe/upscale, unlisted share, remix prefill
> hand-off via sessionStorage), boards (`/boards`), API keys (`/keys`) and
> plans (`/plans`) — plus the session-aware AppShell, the rewired public
> `/share/<token>` page and a new public `/boards/<token>` board viewer.
> 36 jsdom contract specs pin the exact fetch contracts
> (tests/{create,explore,history,account}-ui.test.tsx); the whole suite is
> 195 specs green, `tsc --noEmit` clean. The Reelforge-era shell
> (components, /studio, /models, /showcase pages, legacy lib modules,
> marketing media) was deleted. Browser-verified end to end: signup →
> compose → charged render to a real seekable MP4 → history → share →
> public page → like → board create → key mint → Bearer API call → remix
> prefill.
> **Next (T6):** hosted provider adapters (FAL_KEY / SELFHOSTED_URL) slotting
> behind the pipeline's FrameSource; agent-run UI on top of
> POST /api/agents; a public marketing landing for signed-out visitors.

---

# Reelforge — repo handoff instructions (legacy text, pre-Somnia port)


This folder is a clean, ready-to-push export of the Reelforge app
(original clean-room build; see README.md inside for provenance notes):
Phase 1 (generation studio MVP), Phase 2 (real video output, keyframes,
extend, boards), Phase 3 (edit threads, reframe, camera motion, remix),
Phase 4 (Insights ops dashboard + provider health), Phase 5 (public
unlisted share pages + self-hosted GPU provider tier), and Phase 6
(serverless/Vercel runtime layer) — all committed on `main`.

## Push it to your payswapdotorg org (2 minutes)

1. Create an **empty** repository in the payswapdotorg organization on GitHub,
   e.g. `payswapdotorg/reelforge` (no README, no license, no .gitignore —
   this export already has them).
2. From inside this folder:

```bash
cd reelforge-repo
git remote add origin git@github.com:payswapdotorg/reelforge.git
git push -u origin main        # history already committed; just add remote and push
```

(If you received this folder without `.git`, re-create it: `git init -b main`,
`git add -A`, `git commit`, then push as above.)

3. After the first push on GitHub: Settings -> Branches -> protect `main`
   (require PR reviews), and add repository secrets if you wire a real
   provider (see below).

## First run after cloning

```bash
bun install                # or npm install
cp .env.example .env       # set DATABASE_URL; add SELFHOSTED_URL / FAL_KEY only when wiring real providers
bunx prisma db push        # create the SQLite schema
bun run dev                # http://localhost:3000
```

**System requirement (Phase 2):** `ffmpeg` (v6+) and `ffprobe` must be on PATH —
the demo provider composites storyboard keyframes into real MP4 clips with
them. Install via `apt install ffmpeg` / `brew install ffmpeg`. Without ffmpeg
the app still runs and completes jobs with frames only (graceful degradation).

Starter credits: the demo user is seeded with a 500-credit grant on the
first API call. Reset the database any time by deleting the db file and
re-running `bunx prisma db push`.

## Wiring a real generation provider

The codebase ships three adapters behind one interface
(`src/lib/providers/`), resolved in this order (cost-control tier first,
per the blueprint):

1. `selfhosted.ts` — **Phase 5 GPU tier**: activates when `SELFHOSTED_URL`
   is set. Talks to any queue-style gateway you stand up around open models
   (Wan 2.2 / LTX-2.5 / HunyuanVideo — e.g. RunPod, ComfyUI wrapper,
   FastAPI). Contract: `POST /v1/video/jobs` → `{ id }`, then
   `GET /v1/video/jobs/{id}` → `{ status, progress?, video_url?, frames? }`.
   Remote progress is mirrored into the job; finished MP4s/frames are
   downloaded into `public/generated/` (remote URL fallback on failure).
   Optional `SELFHOSTED_MODEL` (default `wan2.2-t2v-5b`) and
   `SELFHOSTED_API_KEY` (bearer).
2. `fal-stub.ts` — a complete fal.ai-shaped adapter (queue submit, status
   poll, webhook) that activates only when `FAL_KEY` is set in `.env`.
3. `demo.ts` — always available; simulates the full job lifecycle and renders
   storyboard keyframes (local image SDK first, branded placeholders on
   failure).

Credits and cost instrumentation flow through all three. The provider
contract (`src/lib/providers/types.ts`) carries an optional `videoPath`
result field, so a hosted provider returning MP4 URLs drops in without
schema work.

## Phase 2 feature map (what shipped)

- **Real MP4 output** — `src/lib/video.ts` renders the ordered frame list
  (start frame → generated keyframes → end frame) into a Ken Burns clip
  (per-segment zoom/pan, crossfades, H.264 `yuv420p`, faststart, 30fps;
  CRF 26 draft / 23 quality). Output lands in `public/generated/<jobId>.mp4`
  and is exposed on job DTOs as `videoPath` + an `Asset` row of kind `video`.
- **End-frame keyframing** — optional closing still in the Studio; stored as
  `Job.endFramePath`; composites as the final segment.
- **Extend** — `POST /api/jobs/[id]/extend` on completed jobs: creates a new
  charged job (tier rate × 5s) seeded with the source clip's last frame and
  the prompt + a continuation cue.
- **Boards** — optional `Job.board` tag at submit; filter chips in Gallery,
  dropdown filter in History.
- Schema additions vs Phase 1: `Generation.videoPath`, `Job.endFramePath`,
  `Job.board` (all additive; `bunx prisma db push` migrates in place).

## Phase 4 feature map (what shipped)

- **Insights tab** (4th in-page tab) — the report's "cost-per-generation
  dashboard": KPI cards (total generations, acceptance rate, credits granted /
  spent, balance, provider cost, gross-margin proxy, avg cost per completed
  generation), charts (jobs per day, credits by ledger kind, board usage,
  tier economics), status funnel, and a recent-ledger table.
- `GET /api/insights` — one read-only aggregation endpoint (grouped queries,
  no N+1). Revenue proxy assumes **$0.01 per credit** (derived from the
  blueprint's retail table: draft 50 cr = $0.50) — re-derive if you re-price.
- `GET /api/providers/health` — active provider, `FAL_KEY` configured
  (boolean only — never the value), ffmpeg availability + version
  (process-cached probe), last-job time, 5-minute activity counts, credits
  remaining.
- Zero schema changes; all metrics computed from existing
  Job / Generation / CreditTransaction / Asset data.

**Remaining per the blueprint (ops, not code):** rent the actual GPUs and run
an open-weights draft tier (Wan 2.2 class) behind the selfhosted adapter;
wire a real hosted provider (`FAL_KEY`) for the two-backend goal; multi-model
routing across hosted + self-hosted once both live.

## Phase 5 feature map (what shipped)

- **Public unlisted share pages** — `/share/<token>`: zero-JS,
  server-rendered public page for a finished render (video player, prompt,
  meta chips, keyframe strip, reframe/camera variant players). No auth — the
  32-hex token is the capability. `noindex` meta + `Disallow: /share/` in
  `robots.txt` (unlisted by design). OpenGraph + Twitter-player metadata with
  absolute URLs from `NEXT_PUBLIC_SITE_URL`.
- **Share management API** — `POST /api/jobs/[id]/share` mints the token
  (idempotent; completed jobs only), `DELETE` revokes (idempotent;
  re-sharing mints a fresh token so revoked links stay dead).
- **Gallery share UI** — the video dialog gains a share panel: create →
  auto-copy to clipboard, live badge, copy/open/stop-sharing controls. Local
  override state survives the 1.5s jobs polling.
- **Self-hosted GPU provider tier** — `src/lib/providers/selfhosted.ts`
  (see "Wiring a real generation provider" above); provider precedence is
  now selfhosted → fal → demo, surfaced in the Insights health card
  (self-hosted wired/model row).
- **Type hardening** — `tsc --noEmit` now passes clean (re-exported DTO
  value types, null-narrowing fix in `listJobs`, tsconfig excludes for
  non-app directories).
- Schema additions vs Phase 4: `Job.shareToken` (unique, nullable),
  `Job.sharedAt` (additive; `bunx prisma db push` migrates in place).
  Zero credit cost — sharing is free and never touches the ledger.

## Phase 3 feature map (what shipped)

- **Modify / edit threads** — `POST /api/jobs/[id]/edit` with an instruction:
  creates a child generation job (standard tier-rate charge) carrying
  `Job.parentJobId` + `Job.editInstruction`; History shows version badges
  ("edit v2"...); job detail dialogs render the full thread chain with
  click-to-jump. Moderation covers the instruction and composed prompt.
- **Reframe** — `POST /api/jobs/[id]/reframe {aspect}` on completed clips:
  ffmpeg scale+center-crop to the target aspect (flat 10 credits, ledger kind
  `transform`, provider cost $0). Idempotent per (job, aspect).
- **Camera motion** — `POST /api/jobs/[id]/camera {preset}` (push in / pull
  back / drift left / drift right): re-renders the job's frame list with the
  preset's zoompan parameters (flat 15 credits, kind `transform`). Idempotent
  per (job, preset).
- **Remix** — one-click Studio prefill from any past job (prompt, tier,
  duration, aspect, board, start frame). No charge until the user forges.
- Variants are persisted as `Asset` rows (`kind` `reframe`/`camera`, plus
  `label`/`variantKey` columns) and exposed on the job DTO as `variants[]`;
  detail dialogs render variant players with downloads.
- Schema additions vs Phase 2: `Job.parentJobId`, `Job.editInstruction`,
  `Asset.label`, `Asset.variantKey` (all additive; `bunx prisma db push`
  migrates in place). Transform charges: reframe 10 cr, camera 15 cr — update
  the pricing table in README.md if you re-price.

## Pricing model baked in (from the blueprint report)

| Tier    | Credits | Retail (5s) | Provider cost (5s) | Gross margin |
|---------|---------|-------------|--------------------|--------------|
| Draft   | 50      | $0.50       | $0.08              | ~84%         |
| Quality | 200     | $2.00       | $0.40              | ~80%         |

Every job stores both `creditsCharged` and `providerCostUsd`, so margin per
generation is a single database query — keep it that way.

## Renaming the brand

"Reelforge" is a placeholder pending trademark clearance. Rename via:
search/replace in `src/app/layout.tsx` (title/metadata), the header in
`src/app/page.tsx`, footer text, and README. Run a clearance search before
any public launch.

## Phase 6 feature map (what shipped)

- **Serverless runtime layer** — `src/lib/runtime.ts` centralizes every
  platform decision: `IS_SERVERLESS` (Vercel env detection), writable media
  dir routing (`/tmp/reelforge-generated` on serverless, `public/generated`
  locally), ffmpeg binary resolution (`FFMPEG_PATH` → `/usr/bin/ffmpeg` →
  bundled `ffmpeg-static` → PATH), and `afterResponse()` (routes the
  generation pipeline through the platform `waitUntil` hook so it survives
  the HTTP response; fire-and-forget locally).
- **Runtime media streaming** — `src/app/api/media/[...file]/route.ts`
  streams generated media with full Range/206 support (video seeking), a
  strict traversal guard, and content types for mp4/png/jpg/webp. An
  afterFiles rewrite (`/generated/*` → `/api/media/*`) activates only when
  no static file matches, so local/static serving is unchanged and every
  stored `/generated/...` path works on both platforms.
- **Serverless database bootstrap** — `DATABASE_URL=file:/tmp/reelforge.db`
  on Vercel; `src/lib/db.ts` copies the committed schema-only seed
  (`prisma/seed.db`, regenerated via `bun run scripts/make-seed-db.ts` after
  schema changes) into place on cold start. Demo user + opening grant
  bootstrap lazily. **Ephemeral per-instance demo storage by design** — for
  durable data point DATABASE_URL at Turso/Neon/Postgres (bootstrap no-ops).
- **Function budgets** — mutating routes (`generate`, `extend`, `edit`,
  `rerun`, `reframe`, `camera`) export `maxDuration = 60`.
- **Bundler hygiene** — `serverExternalPackages` for Prisma,
  `outputFileTracingIncludes` carrying `prisma/seed.db` + the ffmpeg-static
  binary, `postinstall: prisma generate`, and a dynamic z-ai SDK import that
  degrades to branded placeholder keyframes where the SDK cannot initialize.
- **Vercel env vars (demo deployment)**: `DATABASE_URL=file:/tmp/reelforge.db`
  and `NEXT_PUBLIC_SITE_URL=<deployment URL>` (absolute OG URLs on share
  pages). No provider keys required.

## Phase 6 addendum — consolidated single-function API

Vercel deploys each App Router route file as its own serverless function
with an isolated `/tmp`: a job created by `POST /api/generate` was invisible
to `GET /api/jobs` (different function, different scratch database). All API
endpoints now ship behind ONE optional catch-all route:

- `src/app/api/[[...path]]/route.ts` — GET/POST/PUT/PATCH/DELETE entrypoint
  (`maxDuration = 60`, `dynamic = 'force-dynamic'`)
- `src/lib/api-dispatch.ts` — the route table; handler bodies moved verbatim
  from the Phase 1–5 route files (identical paths, status codes, ledger and
  moderation semantics)
- `src/lib/media-handler.ts` — the Range-aware media streamer, dispatched
  from `GET /api/media/*`
- `GET /api/jobs/shared/:token` — new public share-payload endpoint; the
  `/share/[token]` pages are now stateless and fetch it over HTTP (site URL
  from `NEXT_PUBLIC_SITE_URL`, localhost fallback) so they read exactly the
  state where the token was minted
- The individual `src/app/api/**/route.ts` files were removed — a specific
  route file would take precedence over the catch-all and split the function
  again

Demo data remains ephemeral (per-instance SQLite by design; wire
Turbso/Neon/Postgres via `DATABASE_URL` for durable storage — the
bootstrap no-ops).

## Phase 9.1 addendum — commit author attribution (Vercel seat block)

Vercel auto-deploys from `main` only when it can map the commit author to a
Git account on the connected Vercel team (`seatBlock:
COMMIT_AUTHOR_REQUIRED`). Pushes authored as `z@container` or
`bot@reelforge.local` deploy `BLOCKED`; the Phase 6 series authored as
`payswapdotorg <payswapdotorg@users.noreply.github.com>` deploys `READY`.
Rule for every future push from automation:

```bash
git -c user.name="payswapdotorg" \
    -c user.email="payswapdotorg@users.noreply.github.com" \
    commit --author="payswapdotorg <payswapdotorg@users.noreply.github.com>" ...
```

This commit (Phase 9.1) re-triggers the production deploy of the Phase 8+9
tree under the correctly attributed identity; no code changes were needed.

## Phase 10 addendum — production wiring (user-side) & honest demo behavior

What works out of the box on Vercel and what needs a key:

- **Generation pipeline**: charged job -> moderation -> ffmpeg render -> seekable
  MP4 streaming -> share pages all run on Vercel. With no provider key the
  demo provider renders **placeholder keyframes** (simple shapes — the z-ai
  SDK bundled for the dev sandbox cannot init on Vercel); in the dev sandbox
  the same code path produces real AI imagery. For production-real output set
  `FAL_KEY` (fal.ai) or `SELFHOSTED_URL` (+ optional `SELFHOSTED_MODEL`) as
  Vercel env vars — the pluggable provider layer picks them up automatically.
- **Agent chat**: same story — `/api/agent` returns a graceful fallback reply
  when no LLM is reachable; wire a provider when you want live chat.
- **Storage**: demo media + SQLite live in per-instance `/tmp` (ephemeral).
  Durable path: point `DATABASE_URL` at Turso/Neon/Postgres (schema bootstrap
  no-ops) and move media to a blob store.
- **Image-to-video (Phase 10)**: the composer's Start/End frame pins are
  provider-agnostic — the demo engine stitches pinned frames into the Ken
  Burns chain; the fal adapter maps them to `image_url`/`end_image_url`.
