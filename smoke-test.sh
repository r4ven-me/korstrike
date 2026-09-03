#!/usr/bin/env bash
# End-to-end smoke test for the korstrike image: boots a container, confirms
# the panel answers, the server starts stopped, Start actually brings HLDS up
# over RCON, and Stop brings it back down. Used by `make test`/`make release`
# before anything gets pushed.
set -euo pipefail

IMAGE="${1:-korstrike}"
CONTAINER="korstrike-smoke-test"
GAME_PORT="27099"
PANEL_PORT="18099"
COOKIES="$(mktemp)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f korstrike-smoke-test-data korstrike-smoke-test-panel korstrike-smoke-test-maps >/dev/null 2>&1 || true
  rm -f "$COOKIES"
}
trap cleanup EXIT

fail() {
  echo "[smoke-test] FAIL: $1" >&2
  docker logs "$CONTAINER" 2>&1 | tail -40 || true
  exit 1
}

echo "[smoke-test] starting container from image: $IMAGE"
docker run -d --name "$CONTAINER" \
  -e RCON_PASSWORD=smoketest \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=smoketest \
  -e GAME_PORT="$GAME_PORT" \
  -p "$GAME_PORT:$GAME_PORT/udp" \
  -p "$PANEL_PORT:8080" \
  -v korstrike-smoke-test-data:/home/hlds/hlds \
  -v korstrike-smoke-test-panel:/opt/korstrike/panel \
  -v korstrike-smoke-test-maps:/opt/korstrike/maps \
  "$IMAGE" >/dev/null

echo "[smoke-test] waiting for panel..."
for _ in $(seq 1 30); do
  curl -sf "http://localhost:$PANEL_PORT" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:$PANEL_PORT" >/dev/null || fail "panel never came up"

echo "[smoke-test] logging in..."
curl -sf -c "$COOKIES" -H 'Content-Type: application/json' \
  -X POST -d '{"username":"admin","password":"smoketest"}' \
  "http://localhost:$PANEL_PORT/api/login" >/dev/null || fail "login failed"

echo "[smoke-test] checking the server starts stopped..."
state="$(curl -sf -b "$COOKIES" "http://localhost:$PANEL_PORT/api/server/state")"
[[ "$state" == *'"stopped":true'* ]] || fail "server did not start stopped ($state)"

echo "[smoke-test] pressing Start..."
curl -sf -b "$COOKIES" -X POST "http://localhost:$PANEL_PORT/api/server/start" >/dev/null

echo "[smoke-test] waiting for the game server to answer over RCON..."
up=0
for _ in $(seq 1 30); do
  status="$(curl -sf -b "$COOKIES" "http://localhost:$PANEL_PORT/api/status")"
  if [[ "$status" == *'"stopped":false'* && "$status" != *'"error":"RCON'* ]]; then
    up=1
    break
  fi
  sleep 1
done
[[ "$up" == "1" ]] || fail "game server never came up over RCON ($status)"

echo "[smoke-test] pressing Stop..."
curl -sf -b "$COOKIES" -X POST "http://localhost:$PANEL_PORT/api/server/stop" >/dev/null
sleep 2
state="$(curl -sf -b "$COOKIES" "http://localhost:$PANEL_PORT/api/server/state")"
[[ "$state" == *'"stopped":true'* ]] || fail "server did not stop ($state)"

echo "[smoke-test] OK"
