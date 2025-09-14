#!/usr/bin/env bash
set -euo pipefail

SESSION="beerbot"
WORKDIR="/home/bots/BeerBot"

cd "$WORKDIR"

echo "[deploy] Pulling…"
git pull

echo "[deploy] Installing deps (bun)…"
bun i --no-progress

# stop old session if present
if screen -list | grep -q "\.${SESSION}\b"; then
    echo "[deploy] Stopping existing screen session ${SESSION}…"
    screen -S "$SESSION" -X quit || true
    sleep 0.5
fi

echo "[deploy] Starting new screen session…"
# bash -lc ensures the shell loads rc files so PATH/env are correct
screen -dmS "$SESSION" bash -lc 'cd /home/bots/BeerBot && bun run start:prod'

echo "[deploy] Done."
