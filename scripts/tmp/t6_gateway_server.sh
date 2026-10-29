#!/usr/bin/env bash
# scripts/tmp/t6_gateway_server.sh — start the fake GPU gateway fully detached
# (same pattern as scripts/dev-server.sh so it survives tool invocations).
cd /home/z/my-project/somnia
setsid nohup node scripts/tmp/t6_fake_gateway.mjs > scripts/tmp/gateway.log 2>&1 < /dev/null &
echo "fake gateway started (detached, pid group $!)"
