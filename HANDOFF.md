# Somnia — repo handoff instructions

> **Current state (T16, the durable live tier):** the live tier no longer
> lapses. T15's rotation re-wrote the Vercel env and redeployed every hour
> (~2min downtime); T16 moved the gateway endpoint into the DATABASE and
> prism stills onto the gateway. What landed:
>
> 1. **The stable-URL relay (repo, TDD)** — a new `TierGateway` singleton
>    row holds the live gateway `url`/`apiKey`/`model`/`sandboxId`;
>    `SELFHOSTED_URL` now points FOREVER at the app's own
>    `/api/tier/relay/*` route (`src/lib/tier-gateway.ts`), which forwards
>    GET/POST to the row URL with the row's key (constant-time bearer on the
>    way in = the stable `SELFHOSTED_API_KEY`; `/v1/*` + `/healthz`
>    allowlist; honest 503 no-row / 502 unreachable). The relay re-reads the
>    row per request, so an atomic upsert switches in-flight render polls to
>    a fresh sandbox mid-render. Adapters stay pure HTTP — they never touch
>    the DB (the app layer owns that), byte-for-byte unchanged.
> 2. **The ops surface (repo, TDD)** — `GET/POST/DELETE /api/ops/gateway`
>    (bearer `TIER_OPS_KEY`, 503 when unconfigured, constant-time compare)
>    reads the masked state (the apiKey VALUE is never returned), upserts
>    the row (the rotation step), and clears it (tier down → renders fail
>    and refund honestly).
> 3. **Health truth (repo, TDD)** — `tierGatewayConfigured` /
>    `tierGatewayAlive` (a 2.5s probe — a row can outlive its dead sandbox,
>    and health says which) / `tierGatewayRotatedAt` + `imageModelRoutes`
>    (`{"prism":"selfhosted"}`). URL and key never leave the server.
> 4. **Prism stills through the gateway (repo, TDD)** — the last placeholder
>    surface is gone: the self-hosted adapter gained `renderStill`
>    (`POST/GET /v1/image/jobs`, same submit-retry + poll-tolerance
>    semantics), image routing (`failoverImageOrder` — fal is not
>    image-capable and never joins the chain), and the pipeline's image
>    branch renders through hosted tiers with the VIDEO contract: a routed
>    still that fails on every tier fails and refunds — NEVER silent local
>    placeholder art; hosted stills are never placeholder-flagged. The
>    gateway (ops) composites stills: pinned frame verbatim or generated
>    a0.dev imagery, scaled/cropped to the canvas, PNG.
> 5. **Zero-downtime rotation (ops, `scripts/e2b/` on the dev box)** —
>    `rotate.mjs` rewritten: fresh sandbox (old one still serving) → full
>    contract self-test (prompt-only video, pinned timeline, generated
>    still, pinned still, auth) → ONE upsert to `/api/ops/gateway` (the
>    atomic switch) → verify through the app's OWN relay + health → kill the
>    old sandbox. ~50s end to end, ZERO downtime, zero Vercel env changes,
>    zero redeploys. Stable secrets live in `rotate.env` (chmod 600,
>    outside the repo): `RELAY_KEY` (= Vercel `SELFHOSTED_API_KEY`),
>    `OPS_KEY` (= Vercel `TIER_OPS_KEY`) — they NEVER rotate.
>    `wire-t16.mjs` was the one-time env flip (relay URL + stable keys) +
>    one deploy; rotations never touch Vercel again.
> 6. **The rotation cron** — a scheduler fires `rotate.mjs` every ~45min
>    (at :00 and :45, Africa/Accra) so the tier is durable under the E2B
>    1h session cap. Honest costs: the sandbox bills ~$0.166/h while up
>    (~$4/day at 24/7); pause any time (delete the cron job +
>    `node up.mjs --kill` — renders then fail-and-refund honestly until the
>    next rotation).
> 7. **Production wiring (T10/T13/T14 pattern)** — the `TierGateway` table
>    was pushed to production Neon BEFORE the code push (additive); env
>    flipped once (wire-t16) + one deploy; then the first rotation landed
>    the row. **Smoke-verified on production (48/48, `scripts/t16-smoke.mjs`
>    outside the repo)**: health reports `tierGatewayConfigured/Alive: true`
>    with `imageModelRoutes {"prism":"selfhosted"}`; the relay answers
>    `/healthz` with the relay key (401 without); a prompt-only dream
>    renders a REAL hosted MP4 in ~34s THROUGH THE RELAY ($0.002 cost stamp,
>    blob URL, 3 gateway keyframes); a prism IMAGE job renders a REAL hosted
>    still in ~16s ($0.0005, PNG blob poster, `placeholderRender: false`);
>    the pinned-timeline path composites the user's 3 keyframes; extend
>    settles; BOTH share pages carry no simulated-render badge; insights
>    reports the selfhosted tier; Range 206 off the CDN.
>
> The suite is **384 specs green** (29 new: 21 in `tests/tier-gateway.test.ts`
> — row state/upsert validation, relay forwarding + auth + 405/404/503/502 +
> dispatch integration, ops surface + masking, health truth incl. the
> dead-sandbox case; 4 image-rendering specs in `tests/providers.test.ts` —
> hosted still + cost stamp + poster pixels, pinned source frame, fail+refund
> with no local fallback, local path when unconfigured; 4 image-routing
> specs in `tests/routing.test.ts`; the T6a "image jobs never route hosted"
> spec updated to the T16 contract). `tsc --noEmit` clean, `eslint .` zero
> errors (same 11 pre-existing warnings). The suite is network-bound against
> the Neon test DB — chunk the run (~5 files per invocation).
> **Known constraints, honestly:** E2B still caps sessions at 1h — the tier
> is durable only while the ~45min rotation cron runs (a rotation gap shows
> up as `tierGatewayAlive: false` and fail+refund renders); the sandbox
> bills ~$0.166/h while up; keyless imagery latency varies 3-90s per render
> (stills ~15s); a rotation that lands mid-render switches that render's
> polls to the new sandbox, where the job id is unknown → such renders fail
> and refund (rare: ~50s rotations vs ~45min cadence).
> **Next (T17):** the tier is feature-complete for the current keys —
> candidates: a real GPU/fal key swaps the imagery source in `gateway.mjs`
> (the contract, routing and failover already speak it); Insights could
> surface `tierGatewayRotatedAt`/uptime for the operator; the cron could
> quiet-hours the sandbox to cut idle spend; or move on to product surface
> (boards/agent UX polish).

---

> **Prior state (T15, the live video tier):** production renders REAL
> hosted video today. The T14 runbook needed an operator key that did not
> exist (`FAL_KEY` / a GPU gateway); T15 stood the tier up with what the
> operator DOES have — an E2B sandbox. What landed:
>
> 1. **The E2B render gateway (ops, outside the repo)** — a zero-dependency
>    Node service in an E2B sandbox implements the selfhosted queue contract
>    byte-for-byte (`scripts/e2b/` on the dev box: `gateway.mjs` + `up.mjs`
>    + `vercel-wire.mjs` + `verify-gateway.mjs`). Imagery: the user's pinned
>    keyframes verbatim, or REAL AI keyframes from the keyless
>    `api.a0.dev` image endpoint (Replicate-backed cache; Pollinations is
>    IP-rate-limited on E2B and unusable) with the exact storyboard beats the
>    local pipeline uses. Composite: ffmpeg Ken Burns mirroring
>    `src/lib/video.ts` semantics 1:1 (alternating zoom, 2× working buffer,
>    crossfade chain, H.264 yuv420p faststart 30fps, resolution CRF).
>    Honest model id: `e2b-kenburns-cpu` — a CPU compositor of real AI
>    imagery, not a GPU diffusion box, and health says exactly that. A
>    supervisor loop (a STATIC script that re-sources `gateway.env` on every
>    restart — key rotation rewrites the env file, never the running script)
>    restarts the gateway if it dies. **The E2B Hobby plan caps sessions at
>    ONE HOUR** — a 24h `setTimeout` is accepted by the API but silently
>    clamped (verified live: boot 16:57, gone by ~17:57; the paused snapshot
>    is not resumable — SDK 2.62.0 has pause but no resume). `rotate.mjs` is
>    the one-command recovery: fresh sandbox + full contract self-test +
>    Vercel env re-wire + production redeploy + health verify, ~110s end to
>    end (`up.mjs` alone reuses a live gateway or recreates it; `--kill`
>    stops the ~$0.166/h uptime meter; `--redeploy` hot-swaps gateway code;
>    `--selftest` re-proves the contract).
> 2. **Pinned-timeline fidelity (repo, TDD)** — `HostedRenderInput.keyframes`
>    now carries the job's FULL ordered pinned timeline to hosted tiers (the
>    adapter sends `keyframes` alongside `start_frame`/`end_frame`; the
>    pipeline passes the Keyframe rows in order). Before T15 a pinned job
>    rendered hosted silently REGENERATED its middle beats from the prompt —
>    the user's imagery was thrown away. The gateway composites the pinned
>    frames verbatim; a prompt-only job sends `[]`.
> 3. **Transient-hiccup resilience (repo, TDD)** — the self-hosted adapter
>    retries the submission ONCE and tolerates two consecutive failed status
>    polls before failing: a gateway restart blip (E2B edge answers
>    401/502/503 for a moment — observed live during development) never
>    fails a charged render. Persistent outages still fail fast and refund;
>    the T12 failover test now pins the two-attempt-then-failover contract.
> 4. **`maxDuration = 300`** (was 60) — a hosted render must settle inside
>    its invocation (success, or failure + refund), and keyless image
>    generation varies 3-90s wall. The gateway enforces its own 240s hard
>    deadline underneath; the Fluid Compute 300s ceiling was accepted by the
>    platform and the deploy is live with it.
> 5. **Production wiring (before the code push, T10/T13 pattern)** —
>    Vercel env (encrypted, production/preview/development):
>    `SELFHOSTED_URL` (the sandbox's public `3000-<id>.e2b.app` URL),
>    `SELFHOSTED_API_KEY` (gateway bearer), `SELFHOSTED_MODEL=
>    e2b-kenburns-cpu`, and `SOMNIA_PROVIDER_COSTS` with the honest E2B
>    marginal costs (`pulse-3`/`pulse-flash`: $0.002 540p/720p, $0.003
>    1080p; prism $0.0005) — Insights margins now report real spend instead
>    of the owned-GPU planning estimates.
> 6. **Smoke-verified on production** (37/37, `scripts/t15-smoke.mjs`
>    outside the repo, re-run clean after the rotation): health flips
>    `activeProvider: selfhosted` with every
>    video model routed to the live tier; a prompt-only dream renders a REAL
>    hosted MP4 in ~18s (`placeholderRender: false`, blob URL, $0.002 cost
>    stamp, 3 gateway keyframes ingested as frame assets); a pinned-timeline
>    dream composites the user's own 3 keyframes through the gateway;
>    extend/reframe/upscale work on the real dream; the public share page
>    carries NO simulated-render badge; insights reports the selfhosted tier
>    (costUsd $0.006 for the three smoke renders); Range 206 off the CDN.
>
> The suite is **355 specs green** (5 new in `tests/providers.test.ts`: the
> pinned-timeline passthrough, prompt-only `keyframes: []`, submit-retry,
> poll tolerance, persistent-poll failure + refund; the T12 failover spec
> updated to the two-attempt contract). `tsc --noEmit` clean, `eslint .` zero
> errors (same 11 pre-existing warnings). NOTE: the suite is network-bound
> against the Neon test DB — chunk the run (~5 files per invocation).
> **Known constraints, honestly:** **the sandbox lapses after ONE HOUR**
> (E2B Hobby session cap) — while it is down renders fail and refund
> honestly, and `node scripts/e2b/rotate.mjs` brings the tier back in ~2
> minutes (each rotation changes the gateway URL, so the env re-wire +
> redeploy ride along); the sandbox bills ~$0.166/h while up (`up.mjs --kill`
> stops the meter); prism stills still render locally (placeholder
> art + honest flag on serverless — image jobs never route hosted);
> keyless imagery latency varies 3-90s per render.
> **Next (T16):** make the tier durable — a stable-URL relay (a tiny app
> route that forwards to the gateway URL held in a DB row, so rotation =
> UPDATE one row, zero redeploys) plus a ~50-minute rotation cron; route
> prism image jobs through the gateway too (kills the last placeholder
> surface); or leave plan-limits behind entirely the moment a real GPU or
> fal key appears — swap the imagery source in `gateway.mjs`, the contract,
> routing and failover already speak it.

---

> **Prior state (T14, render truth + dispatch repair):** the
> honest-placeholder surface the T13 note pointed at (wiring
> `FAL_KEY`/`SELFHOSTED_URL`) needs an operator-side key that does not exist
> yet — so T14 shipped the OTHER half of that honesty: the app now TELLS THE
> TRUTH about every simulated render, wiring a real tier became a documented
> 5-minute env job, and the production E2E that verified it all surfaced (and
> fixed) a REAL pre-existing bug: extend/modify jobs were charged but never
> dispatched. What landed:
>
> 1. **`Job.placeholderRender`** (schema, additive Boolean) — the render
>    pipeline already knew when a frame degraded to the branded placeholder
>    (image SDK unreachable, e.g. serverless); that fact was being thrown
>    away and jobs posed as fully real renders. Now the flag persists with
>    the job: video beats AND prism stills set it when ANY frame falls back
>    (mixed degradation flags too); pinned timelines (the user's own
>    imagery) and hosted-tier renders (a remote MP4 is real by definition)
>    never set it. Column pushed to production Neon BEFORE the code push —
>    additive, zero disruption to the running deployment.
> 2. **The flag flows everywhere a render is shown** — owner job detail
>    (getJob DTO), the public share payload (`getSharedJob`), the ideas
>    feed (`listIdeas` items). Every surface renders a "simulated render"
>    chip: the composer's active-job card, history list cards + detail
>    panel, explore cards, and the PUBLIC share pages (honesty extends to
>    anonymous viewers).
> 3. **`imageSdkAvailable` in health** — a process-cached probe
>    (`imageSdkProbe` in pipeline.ts) answers whether the local image SDK
>    can initialize in this deployment: `demo` + `true` = composites of
>    real generated keyframes (the dev sandbox); `demo` + `false` =
>    placeholder art (serverless). Hermetic under SOMNIA_TEST; boolean only,
>    same rule as every provider knob; test seam via `__resetImageSdkProbe`.
> 4. **The composer notice** — signed-in users on a `demo` deployment see
>    an amber note above the forge button spelling out what a "dream"
>    actually is there (placeholder art vs locally generated keyframes,
>    keyed off the probe; charges/refunds still apply). It disappears the
>    moment a hosted tier is wired.
> 5. **Operator runbook** — README "Wiring the video tier in 5 minutes":
>    set `FAL_KEY` and/or `SELFHOSTED_URL` on the Vercel project (before
>    the next deploy), optionally `SOMNIA_MODEL_ROUTES`, redeploy, verify
>    via `/api/providers/health`. The T12 routing/failover layer is built
>    and waiting; going live is env work, not code.
> 6. **T14b — dispatch repair (a REAL bug the production smoke caught):**
>    `POST /api/jobs/:id/extend` and `/modify` created charged, queued jobs
>    but never called `kickPipeline` — on production those dreams sat
>    `queued` FOREVER with credits spent (no render, no refund). The hermetic
>    suite missed it because tests drive `processJob` directly. Fixed twice
>    over: both handlers now kick like generate/image, AND a self-healing
>    sweep (`sweepStaleQueuedJobs` in pipeline.ts — queued jobs older than
>    60s re-driven through the pipeline) fires after every job read route,
>    so ANY future dispatch gap heals itself instead of rotting. The four
>    stuck production jobs from before the fix healed via the sweep on the
>    next authenticated job read.
>
> The suite is **352 specs green** (23 new: 15 in `tests/render-truth.test.ts`
> — flag semantics incl. mixed degradation + pinned/hosted exclusions, DTO
> passthrough x3, hermetic probe + injected initializer + health DTO, and the
> stale-queue sweep contract; 8 UI specs across create/history/covers — the
> notice both variants, silence on a hosted tier, the chip on
> cards/detail/share pages, no chip on real renders). `tsc --noEmit` clean,
> `eslint .` zero errors (same 11 pre-existing warnings). Production DB
> column pushed pre-deploy; production smoke re-run clean after the dispatch
> repair (extend/modify settle, every simulated surface flagged).
> **Next (T15):** the moment an operator provides `FAL_KEY` or a GPU
> gateway URL, wire it per the runbook, set `SOMNIA_MODEL_ROUTES`, and
> smoke-verify a real hosted render end to end (health flip + hosted MP4
> ingested to blob). Until then every surface honestly says "demo".

---

> **Prior state (T13, hosted LLM tier for agent planning):** on top of the
> T12 routing tree, agent planning is now served by a REAL hosted LLM. What
> landed:
>
> 1. **`src/lib/llm.ts`** — an OpenAI-compatible chat client behind the same
>    env-gated, lazily-re-read contract as every other provider knob:
>    `OPENROUTER_API_KEY` activates it, `LLM_BASE_URL` (default
>    `https://openrouter.ai/api/v1`), `LLM_MODEL` (default
>    `meta-llama/llama-3.3-70b-instruct`, verified answering strict JSON) and
>    `LLM_TIMEOUT_MS` (default 20s) override. The client NEVER throws —
>    unconfigured, network error, timeout, non-2xx, malformed body and
>    missing content all decline to null, so an LLM outage can never block
>    planning. Every failure logs a reason (status/error only — never the
>    key) for the Vercel function logs.
> 2. **Budget-aware 402 retry** — OpenRouter's credit pre-flight reserves
>    `max_tokens` worth of credit, so a low-balance key 402s an 800-token
>    planning request even though the actual generation costs ~$0.00005. On a
>    402 whose remedy hint names an affordable budget ("…can only afford
>    300") the request retries ONCE at that budget; below a 120-token floor
>    (a usable shot cannot fit) or without the hint it declines. Verified
>    against real OpenRouter: 800 → 402 afford 289 → 200 with a complete
>    two-shot plan (`finish_reason: stop`).
> 3. **`planner.ts` chain** — hosted LLM first, the sandbox z-ai SDK as the
>    dev-sandbox second chance, the deterministic angle builder as the
>    always-available floor; `llmPlanner` stays hermetic under SOMNIA_TEST.
>    `plannerViaHosted` is exported so the suite drives it against a local
>    gateway and injects it into `planAgentRun` as a production-shaped
>    planner. **health** reports `llmConfigured` (boolean only) +
>    `llmModel` display string.
> 4. **Production wiring** — `OPENROUTER_API_KEY` set on the Vercel project
>    (encrypted, production/preview/development) BEFORE the code push.
>    Smoke-verified on somnia-bay.vercel.app (6/6,
>    `scripts/t13-smoke.mjs` outside the repo): health reports
>    `llmConfigured=true llmModel=meta-llama/llama-3.3-70b-instruct`, and an
>    agent run is planned by the REAL LLM — `planner: "llm"` with
>    LLM-authored prompts ("The lighthouse keeper stands at the top of the
>    tower, gazing out at the stormy sea…"), not the heuristic template.
>
> The suite is **329 specs green** (22 in `tests/llm.test.ts`: config
> detection + lazy re-read, request shape, every decline path, the 402
> retry/floor/no-hint matrix, hermeticity under SOMNIA_TEST, health DTO,
> and the agent-run integration through a local gateway).
> `tsc --noEmit` clean, `eslint .` zero errors (same 11 pre-existing
> warnings).
> **OPERATOR NOTE:** the wired OpenRouter key rides nearly-exhausted free
> credits — the 402 retry keeps planning alive at reduced budgets for a
> handful more runs (~$0.00005 per plan), then it declines honestly to the
> heuristic. Top up credits at openrouter.ai/settings/credits for headroom.
> **Next (T14):** the video tier is the remaining honest-placeholder surface
> (`activeProvider: demo` in health): wire `FAL_KEY` (fal.ai) or
> `SELFHOSTED_URL` (GPU gateway) on Vercel and set `SOMNIA_MODEL_ROUTES` to
> split models across tiers — the routing/failover layer (T12) is already
> built and waiting.

---

> **Prior state (T12, multi-model routing):** on top of the T11 durable
> media tree, the provider layer grew per-model routing + failover. What
> landed:
>
> 1. **`src/lib/routing.ts`** — the route table is env-overridable
>    (`SOMNIA_MODEL_ROUTES` JSON, `{"pulse-3":"selfhosted","pulse-flash":
>    "fal"}`) and re-read lazily per call. A pinned-but-unconfigured tier
>    falls back to the cost-control chain (selfhosted → fal), which itself
>    is exactly the pre-T12 behavior when no routes are set.
> 2. **Pipeline failover** — `processJob` renders video jobs down
>    `failoverOrder(job.model)`: the routed tier first, then the remaining
>    configured REAL tier. When every configured tier fails the job fails
>    and refunds — it NEVER silently degrades a paid render to the local
>    placeholder pipeline. The operator cost stamp (and
>    `Generation.provider`) is corrected to the tier that actually
>    rendered, so Insights margins stay honest after a failover.
> 3. **Health surface** — `GET /api/providers/health` reports `modelRoutes`
>    (effective per-model tier, computed from env + configuration).
>
> The suite is **307 specs green** (12 new in `tests/routing.test.ts`: table
> parsing/fallback, failover order, effective routes + health DTO, and the
> headline pipeline specs — two models routed to two different backends in
> one process; failover completing via the second tier with the cost
> re-stamped $0.09→$0.12; exhausted failover refunding; explicit provider
> injection still pinning exactly one tier). `tsc --noEmit` clean, `eslint .`
> zero errors (same 11 pre-existing warnings).
> **Next (T13):** wire a real hosted provider key on Vercel (FAL_KEY or a
> self-hosted GPU gateway) and set SOMNIA_MODEL_ROUTES to split the models
> across tiers; the demo placeholder path stays the honest no-key default.

---

> **Prior state (T11, durable media storage — Vercel Blob):** on top of the
> T10 Neon tree, generated media is now durable too. What landed:
>
> 1. **The blob layer** — `src/lib/blob.ts` is the media twin of the Neon
>    migration. Writes stay local-first (ffmpeg reads and writes real
>    files) but also upload to the `somnia-media` Vercel Blob store, and
>    the DATABASE remembers the absolute CDN URL instead of the ephemeral
>    `/generated/...` scratch path. Without `BLOB_READ_WRITE_TOKEN` every
>    function is an identity no-op — local dev and the hermetic suite keep
>    byte-for-byte the pre-blob behavior (the env is read lazily at call
>    time, same rule as `resolveVideoProvider`).
> 2. **Write path wired** — `writeBuffer`/`writeBase64Png` (frames.ts)
>    return the durable URL; `storeFrameDataUrl` (storage.ts) became async
>    and dual-writes, so pinned timelines and start/end frames are durable
>    at job-creation time; `renderVideo`/`extractStyledFrames`/
>    `reframeVideo` (video.ts) mirror their MP4/PNG outputs into the store;
>    `ingestAsset` returns durable URLs for hosted-tier clips.
> 3. **Read path wired** — `resolveMediaInput` maps any stored reference to
>    a local file for ffmpeg: the local fast path when the file is on disk
>    (the same invocation wrote it), a one-shot download when only the blob
>    copy exists (cross-instance: extend/edit seeds, reframes), a scratch
>    download for legacy remote fallback URLs. Share/board OG tags
>    absolutize via `absoluteMediaUrl` (blob URLs pass through untouched);
>    players, posters and thumbnails read the CDN URLs directly — native
>    Range support, zero function invocations per media view.
> 4. **Store + env** — provisioned via the Vercel REST API
>    (`scripts/provision-blob.mjs`, outside the repo): store `somnia-media`
>    (region iad1, **public** access — that is what makes direct CDN URLs
>    with Range work), connected to the `somnia` project, which
>    auto-attached `BLOB_READ_WRITE_TOKEN` (encrypted,
>    production/preview/development) BEFORE the code push, so the deploy
>    never booted without it. The token value is never needed locally by
>    design. `GET /api/providers/health` now reports
>    `blobStorageConfigured` (boolean only).
>
> The whole suite is **295 specs green** (17 new in `tests/blob.test.ts`:
> config detection, key derivation, mirror/resolve fast+slow paths, OG URL
> passthrough, and pipeline durability — image/video jobs landing blob URLs
> in Asset/Generation rows with local copies intact). `tsc --noEmit` clean,
> `eslint .` zero errors (same 11 pre-existing warnings). The suite is
> network-bound against the Neon test DB — chunk the run (fast units ~3min,
> engine/pipeline ~5.5min, providers ~4min, api ~5min, UI ~2min).
> **Smoke-verified on production** (9/9 checks, `scripts/t11-smoke.mjs`
> outside the repo): health reports `blobStorageConfigured`, image + video
> jobs land every keyframe and the MP4 as
> `https://tkfmlqb986fn49zp.public.blob.vercel-storage.com/<key>` rows,
> the store serves them publicly, a Range request answers **206
> `bytes 0-1023/48280`** (native video seeking off the CDN — zero function
> invocations per media view), and the share page pins the blob URL in
> og:image verbatim. The clip rendered by one function instance was fetched
> back from outside Vercel entirely — the cross-instance durability T11
> exists to deliver.
> **Next (T12):** multi-model routing across hosted + self-hosted tiers
> (both adapters exist behind one interface; routing/health/failover policy
> is the remaining work), plus wiring a real hosted provider key on Vercel.

---

> **Prior state (T10, durable storage — Neon Postgres):** on top of the T9
> covers/OG tree, the database was migrated to durable PostgreSQL on Neon.
> What landed:
>
> 1. **Provider migration** — `prisma/schema.prisma` switched
>    `sqlite` → `postgresql` (+ `binaryTargets` native +
>    `linux-musl-openssl-3.0.x` for the Vercel runtime). Zero model changes
>    needed; the whole 275-spec suite passed unmodified against Postgres,
>    which was the point of keeping Prisma between the app and the storage.
> 2. **Neon wiring** — two projects provisioned via the console API:
>    `somnia` (production, pooled runtime URL in `.env` / Vercel env) and
>    `somnia-test` (the throwaway the Vitest suite truncates per file).
>    `.env` carries `DATABASE_URL` (pooled, `pgbouncer=true&connection_limit=1`
>    — serverless-safe), `DATABASE_URL_DIRECT` (one-off `prisma db push`) and
>    `DATABASE_URL_TEST`. `.env.example` documents all three.
> 3. **The SQLite era removed** — `src/lib/db.ts` lost the Phase 6
>    seed-copy bootstrap (a missing `DATABASE_URL` now fails loudly);
>    `prisma/seed.db` + `scripts/make-seed-db.ts` deleted;
>    `next.config.ts` tracing drops the seed include; `tests/setup.ts`
>    becomes: load `.env` → point at `DATABASE_URL_TEST` → `prisma db push`
>    → `TRUNCATE ... CASCADE` every table between files (the Postgres
>    equivalent of deleting the throwaway sqlite file). New
>    `tests/db.test.ts` guards (3 specs): postgres URL pinned, the wire
>    answers, a full Prisma roundtrip works.
> 4. **Vercel** — the `somnia` project was created via the API and linked to
>    this repo (production branch `main`, auto-deploy). Its env carries the
>    pooled Neon `DATABASE_URL` (encrypted) plus
>    `NEXT_PUBLIC_SITE_URL=https://somnia-bay.vercel.app` (absolute OG URLs) —
>    both set BEFORE the provider-switch push, so no deploy ever booted
>    against a missing database. Smoke-verified end-to-end: a signup on the
>    live deployment wrote a user row readable through a direct Neon
>    connection from a different machine — the cross-instance durability
>    T10 exists to deliver.
>
> The whole suite is **278 specs green** (3 new) — note it now runs against
> a real remote database, so it is network-bound (chunk the run if your CI
> times out: the heavyweight is `api.test.ts` at ~5 min).
> `tsc --noEmit` clean, `eslint .` zero errors (same 11 pre-existing
> unused-disable warnings).
> **Next (T11):** blob media storage (media is still per-instance scratch
> on serverless — S3/R2 or similar); multi-model routing across hosted +
> self-hosted tiers.

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

## T17 addendum — Dream-Machine app parity (the product layout)

The product now clones the app.lumalabs.ai layout; before T17 the app was a
top-bar admin frame. Shipped in `b7a1daf` (3 files, contract byte-compatible):

- **`app-shell.tsx`** — slim left icon rail (logo → Create/Explore/History/
  Boards/Agents → API keys/Plans/Insights → avatar = sign out with credits
  tooltip); fluid full-bleed `<main>` each page owns; compact icon top bar
  below `md`.
- **`create-app.tsx`** — the home is now a full-bleed masonry feed of your
  generations (`GET /api/jobs`, 2.5 s live polling while anything is in
  flight, just-submitted job featured with `rendered-video`) under the
  signature floating bottom prompt dock: pill input ("What will you dream
  today?", Enter submits / Shift+Enter newlines), recipe tray (mode, model,
  resolution, duration, aspect chips, HDR/Loop, 16-keyframe pins, board),
  Enhance, circular Dream-it submit. Variants, errors and the demo-tier
  notice stack above the dock.
- **`screens.tsx`** — create goes full-bleed; every other page owns its
  gutters via `PageWrap` (max-w-6xl).

Verified on production: 384/384 specs green, `tsc` clean, `next build`
clean; signed up a fresh account on somnia-bay.vercel.app, dreamed 5 clips
from the dock (all completed through the live E2B tier into Vercel Blob),
VLM parity review of the rendered home scored 9/10 vs the Dream-Machine
language (rail + masonry + dock + dark/orange accents all confirmed).

## T18 addendum — Enhance variant contract + honest board counts

Shipped in `f578d65` (4 files). Two production-true bugs found by the
fullscreen audit:

- **Enhance crashed the app**: `/api/brainstorm` returns `BrainstormVariant`
  objects (`{style,label,text,blurb}`), but the composer rendered the objects
  themselves as React children. `create-app.tsx` now types the state as
  `BrainstormVariant[]`, renders `label` + `text` with `blurb` as the chip
  title, and defensively filters any drift (`(body?.variants ?? []).filter(v
  => v && typeof v.text === 'string' && v.text.trim().length > 0)`) — a
  contract change degrades to "no variants", never a crash.
- **Board dream counts were dishonest**: `listBoards` counted every job
  including failed/refunded ones; the groupBy now filters `status:
  'completed'`, matching the cover logic and the public board view.

## T19 addendum — multi-model routing made real (model identity end-to-end)

Until T19 the model choice was pure pricing: `pulse-3` (60/100/400cr) and
`pulse-flash` (25/40/160cr) both collapsed to the static `SELFHOSTED_MODEL`
name at the adapter boundary and rendered byte-identically. The routing
layer (`routing.ts`, T12) picked a TIER per model but never conveyed the
MODEL. T19 closes that gap:

- **`src/lib/models.ts` (new)** — per-model render profiles, the single
  source of truth: pulse-3 gets a deeper Ken Burns travel (1.18 vs 1.1) and
  a denser storyboard (5s → 4 beats, 10s → 5); pulse-flash gets a tight
  travel (1.06), a lean storyboard (5s → 2, 10s → 3) and a coarser encode
  (+2 CRF — quicker, smaller). Unknown/missing model ids keep the original
  T14 constants, so the rotation self-test and older rotators stay
  byte-compatible.
- **`providers/selfhosted.ts`** — the submit body now carries
  `selfHostedModelFor(input.model)`: the `SELFHOSTED_MODELS` JSON map
  (`{"pulse-3":"wan2.2-t2v-5b",...}`) when set, else the Somnia model id
  itself (the E2B tier is model-aware), else the static `SELFHOSTED_MODEL`
  fallback. **External gateways that only know their own model names should
  set `SELFHOSTED_MODELS`** — this is the one wire-format change: unmapped
  Somnia jobs now send `pulse-3`/`pulse-flash`/`prism` raw instead of the
  static name.
- **`providers/fal.ts`** — symmetric `FAL_MODELS` map; an unmapped model
  falls back to the static `FAL_MODEL` (a raw Somnia id in the queue URL
  path would 404).
- **`pipeline.ts` + `video.ts`** — the local demo path mirrors the profiles
  (model-aware storyboard density, per-profile zoom ceiling + CRF delta);
  restyle/camera/drift variants keep the default profile.
- **`health.ts`** — new `selfHostedModels` field: the gateway model name
  each Somnia model resolves to right now (display strings only).
- **`scripts/e2b/gateway.mjs`** — mirrors the profile table; the accept log
  names the profile, and completed jobs carry the profile label.
- **`scripts/e2b/rotate.mjs`** — the rotation self-test grew from 3 to 5:
  pulse-3 must return a 4-beat storyboard and pulse-flash a 2-beat
  storyboard at 3s, so every ~45min rotation continuously proves
  model-keyed rendering on the live tier.

Verified: 397/397 specs green (13 new: model propagation, per-model
storyboard density, health surface, malformed-map safety), `tsc` clean,
`eslint` clean, `next build` clean. Live E2E after deploy: one pulse-3 and
one pulse-flash job on production — different keyframe counts, honest
per-model charges (100cr vs 40cr at 720p/5s), both MP4s seekable.
