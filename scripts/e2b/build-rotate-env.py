#!/usr/bin/env python3
"""Rebuild scripts/e2b/rotate.env from the Vercel + Neon control APIs.

NO credentials live in this file — pass them via environment/args:

    VERCEL_TOKEN, VERCEL_PROJECT_ID   project env (TIER_OPS_KEY, SELFHOSTED_*)
    E2B_API_KEY                       the sandbox key (passthrough)
    NEON_DATABASE_URL                 full connection string (preferred), or
    NEON_API_KEY + NEON_PROJECT_ID    to derive host/user/db and reveal the password

Notes:
  - Vercel env decryption may be denied (`decrypted: false`); junk envelopes
    ('v2') are detected and skipped — TIER_OPS_KEY stays unset and rotate.mjs
    falls back to a direct Neon upsert (identical semantics, see README.md).
  - The file is written chmod 600 and MUST never be committed.
"""
import base64
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

OUT_DEFAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rotate.env")

def api(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def unwrap(vercel_value):
    """v10 env values are base64 JSON envelopes; return plaintext or None on junk."""
    if not isinstance(vercel_value, str) or not vercel_value:
        return None
    try:
        decoded = json.loads(base64.b64decode(vercel_value))
        if isinstance(decoded, dict) and "v" in decoded:
            inner = decoded["v"]
            # undecrypted envelopes carry a version marker instead of a value
            return inner if isinstance(inner, str) and len(inner) > 4 else None
    except Exception:
        pass
    return vercel_value if len(vercel_value) > 4 else None

def vercel_envs(token, project):
    try:
        data = api(f"https://api.vercel.com/v10/projects/{project}/env?decrypt=true", token)
    except Exception as e:
        print(f"vercel env fetch failed: {e}", file=sys.stderr)
        return {}
    out = {}
    for e in data.get("envs", []):
        val = unwrap(e.get("value"))
        if val:
            out[e["key"]] = val
    return out

def neon_uri(key, project):
    if key and project:
        try:
            branches = api(f"https://console.neon.tech/api/v2/projects/{project}/branches", key)
            primary = next(b for b in branches.get("branches", []) if b.get("primary"))
            bid = primary["id"]
            roles = api(f"https://console.neon.tech/api/v2/projects/{project}/branches/{bid}/roles", key)
            role = next(r["name"] for r in roles.get("roles", []) if r.get("name", "").endswith("_owner"))
            dbs = api(f"https://console.neon.tech/api/v2/projects/{project}/branches/{bid}/databases", key)
            db = next(d["name"] for d in dbs.get("databases", []))
            pw = api(
                f"https://console.neon.tech/api/v2/projects/{project}/branches/{bid}/roles/{role}/reveal_password",
                key,
            )["password"]
            eps = api(f"https://console.neon.tech/api/v2/projects/{project}/endpoints", key)
            host = next(e["host"] for e in eps.get("endpoints", []) if e.get("branch_id") == bid)
            return f"postgresql://{role}:{pw}@{host}/{db}?sslmode=require"
        except Exception as e:
            print(f"neon uri derive failed: {e}", file=sys.stderr)
    return None

def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else OUT_DEFAULT
    vercel_token = os.environ.get("VERCEL_TOKEN")
    vercel_project = os.environ.get("VERCEL_PROJECT_ID")
    e2b_key = os.environ.get("E2B_API_KEY")
    neon_url = os.environ.get("NEON_DATABASE_URL") or neon_uri(
        os.environ.get("NEON_API_KEY"), os.environ.get("NEON_PROJECT_ID")
    )

    missing = [n for n, v in [
        ("E2B_API_KEY", e2b_key), ("NEON_DATABASE_URL", neon_url)] if not v]
    if missing:
        print(f"missing: {', '.join(missing)} — pass them as env vars", file=sys.stderr)
        sys.exit(1)

    venv = vercel_envs(vercel_token, vercel_project) if vercel_token and vercel_project else {}

    lines = [
        "# scripts/e2b/rotate.env — T16 gateway rotation credentials (chmod 600; NEVER commit)",
        f"# rebuilt {datetime.now(timezone.utc).isoformat()}",
        f"E2B_API_KEY={e2b_key}",
        f"TIER_OPS_KEY={venv.get('TIER_OPS_KEY', '')}",
        f"APP_ORIGIN={venv.get('NEXT_PUBLIC_SITE_URL', 'https://somnia-bay.vercel.app')}",
        f"TEMPLATE_ID={os.environ.get('E2B_TEMPLATE_ID', 'rki5dems9wqfm4r03t7g')}",
        f"GATEWAY_MODEL={venv.get('SELFHOSTED_MODEL', 'e2b-kenburns-cpu')}",
        "RENDER_DEADLINE_MS=240000",
        "SANDBOX_TTL_MS=3600000",
        f"NEON_DATABASE_URL={neon_url}",
        "",
    ]
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    os.chmod(out_path, 0o600)
    print(f"written {out_path} (mode 600)")
    print("TIER_OPS_KEY:", "set" if venv.get("TIER_OPS_KEY") else "unset — direct Neon upsert path")
    print("GATEWAY_MODEL:", venv.get("SELFHOSTED_MODEL", "e2b-kenburns-cpu (default)"))

if __name__ == "__main__":
    main()
