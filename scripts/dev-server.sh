#!/usr/bin/env bash
# scripts/dev-server.sh — start the Somnia dev server fully detached so it
# survives across tool invocations. Usage: bash scripts/dev-server.sh
cd /home/z/my-project/somnia
export DATABASE_URL="file:/home/z/my-project/somnia/db/custom.db"
export PORT=3000
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
echo "dev server started (detached, pid group $!)"
