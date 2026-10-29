#!/usr/bin/env bash
# scripts/tmp/t6_dev_with_gateway.sh — dev server pointed at the fake GPU
# gateway (live verification of the T6a hosted-provider path).
cd /home/z/my-project/somnia
export DATABASE_URL="file:/home/z/my-project/somnia/db/custom.db"
export SELFHOSTED_URL="http://127.0.0.1:9911"
export SELFHOSTED_MODEL="wan2.2-t2v-5b"
export PORT=3000
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
echo "dev server started with SELFHOSTED_URL=$SELFHOSTED_URL (pid group $!)"
