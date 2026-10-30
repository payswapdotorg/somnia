# scripts/e2b — T16 live-tier gateway rotation

Zero-downtime rotation of the Somnia self-hosted render tier. The live tier is
an E2B sandbox running `gateway.mjs` (the queue-style render gateway behind
`src/lib/providers/selfhosted.ts`); E2B Hobby caps sessions at 1h, so a cron
job rotates the sandbox roughly every 45 minutes. The gateway endpoint lives
in the `TierGateway` DB singleton row — never in Vercel env — so a rotation is
one atomic upsert and in-flight renders switch on their next poll.

## Files

| file | role |
| --- | --- |
| `gateway.mjs` | the render gateway itself (runs INSIDE the sandbox; ffmpeg Ken Burns compositing, prism stills, a0.dev imagery for prompt-only jobs) |
| `rotate.mjs` | boot fresh sandbox → push gateway + supervisor → full-contract self-test → atomic row upsert → kill old sandbox |
| `up.mjs` | `--kill`: pause the tier (kill sandbox + clear row; renders then fail and refund honestly) |
| `check-row.mjs` | one-off diagnostic: print the current TierGateway row |
| `dump-gateway.mjs` | recovery: pull gateway.mjs/env/supervisor out of a still-running sandbox |
| `build-rotate-env.py` | rebuild `rotate.env` from the Vercel + Neon control APIs (credentials passed as env vars, never stored here) |

## rotate.env (chmod 600, gitignored — NEVER commit)

| key | source |
| --- | --- |
| `E2B_API_KEY` | E2B dashboard |
| `NEON_DATABASE_URL` | Neon project `somnia` (holy-snow-57882641) — the row is the source of truth |
| `TEMPLATE_ID` | E2B template of the gateway sandbox (`rki5dems9wqfm4r03t7g`) |
| `APP_ORIGIN` | the deployed app (`https://somnia-bay.vercel.app`) |
| `GATEWAY_MODEL` | display model id (`e2b-kenburns-cpu`) |
| `TIER_OPS_KEY` | OPTIONAL — Vercel env `TIER_OPS_KEY`; when absent/unreachable, rotate.mjs upserts the row directly against Neon, which has identical semantics (the ops route only guards the same write) |

A durable copy of these values lives in the private `payswapdotorg/reelforge-secrets`
repo (`somnia-rotate.env`).

## Self-test contract (every rotation)

1. prompt-only video: POST /v1/video/jobs → poll → video_url ≥ 1 KiB
2. pinned-timeline video: keyframes downloaded verbatim, composited, frames returned
3. prism still: POST /v1/image/jobs → poll → image_url ≥ 1 KiB

Only after all three pass does the row flip; the old sandbox is then killed.

## Known environment drift (handled automatically)

- **template without ffmpeg**: current builds of the template ship no ffmpeg —
  rotate.mjs detects this and `apt-get install`s it (~30s) before booting the gateway.
- **/data provisioning**: the gateway mkdirs `/data` at boot; the sandbox user
  cannot write `/`, so rotate.mjs provisions it as root first.
- **Vercel env decryption denied**: undecrypted envelopes yield junk —
  `build-rotate-env.py` detects them and leaves `TIER_OPS_KEY` unset (direct-Neon path).

## Recovery after a workspace recycle

    git clone https://<PAT>@github.com/payswapdotorg/somnia            # this tooling
    git clone https://<PAT>@github.com/payswapdotorg/reelforge-secrets # credentials
    mkdir -p /home/z/my-project/scripts/e2b
    cp somnia/scripts/e2b/* /home/z/my-project/scripts/e2b/
    cp reelforge-secrets/somnia-rotate.env /home/z/my-project/scripts/e2b/rotate.env
    chmod 600 /home/z/my-project/scripts/e2b/rotate.env
    cd /home/z/my-project/scripts/e2b && npm install
    node rotate.mjs

If the gateway source itself diverged from this tree and a sandbox is still
alive, `dump-gateway.mjs <sandboxId>` extracts the running code first.

## Cost / pause

~$0.166/h while a sandbox is up. To pause the tier: delete the rotation cron
job, then `node up.mjs --kill` in this directory.
