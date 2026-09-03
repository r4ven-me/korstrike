#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/home/hlds/hlds"
CSTRIKE_DIR="$INSTALL_DIR/cstrike"
MAPS_SRC="/opt/korstrike/maps"

: "${RCON_PASSWORD:?RCON_PASSWORD is required — set it in your .env file (see .env.example)}"
: "${ADMIN_USER:?ADMIN_USER is required — set it in your .env file (see .env.example)}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required — set it in your .env file (see .env.example)}"

export SERVER_HOSTNAME="${SERVER_HOSTNAME:-Korstrike CS 1.6}"
export SV_PASSWORD="${SV_PASSWORD:-}"
export MAXPLAYERS="${MAXPLAYERS:-16}"
export MP_TIMELIMIT="${MP_TIMELIMIT:-30}"
export MP_FRIENDLYFIRE="${MP_FRIENDLYFIRE:-0}"
export MP_AUTOTEAMBALANCE="${MP_AUTOTEAMBALANCE:-1}"
export MP_LIMITTEAMS="${MP_LIMITTEAMS:-2}"
export TICKRATE="${TICKRATE:-1000}"
export SV_MAXRATE="${SV_MAXRATE:-20000}"
export SV_MINRATE="${SV_MINRATE:-3000}"
GAME_PORT="${GAME_PORT:-27015}"
STARTMAP="${STARTMAP:-de_dust2}"

mkdir -p "$CSTRIKE_DIR/maps"

# 1. Fetch any maps listed in maps-list.txt that aren't downloaded yet.
if [[ "${DOWNLOAD_MAPS:-true}" == "true" && -d "$MAPS_SRC" ]]; then
  /server/scripts/download-maps.sh || echo "[entrypoint] map download step reported warnings, continuing"
fi

# 2. Sync host-provided/downloaded maps into the live install (never overwrite newer-in-place files).
if [[ -d "$MAPS_SRC" ]]; then
  find "$MAPS_SRC" -maxdepth 1 -type f \( -iname '*.bsp' -o -iname '*.res' -o -iname '*.txt' -o -iname '*.wad' \) \
    -exec cp -u -f {} "$CSTRIKE_DIR/maps/" \;
fi

# 3. Build mapcycle.txt: stock rotation + any custom maps found.
cp /server/config/mapcycle.txt "$CSTRIKE_DIR/mapcycle.txt"
if [[ -d "$MAPS_SRC" ]]; then
  for bsp in "$MAPS_SRC"/*.bsp; do
    [[ -e "$bsp" ]] || continue
    mapname="$(basename "$bsp" .bsp)"
    grep -qxF "$mapname" "$CSTRIKE_DIR/mapcycle.txt" || echo "$mapname" >> "$CSTRIKE_DIR/mapcycle.txt"
  done
fi

# 4. Render server.cfg from the template.
envsubst < /server/config/server.cfg.template > "$CSTRIKE_DIR/server.cfg"

# 5. Make sure files server.cfg execs actually exist.
touch "$CSTRIKE_DIR/banned.cfg" "$CSTRIKE_DIR/listip.cfg"

# 6. Fill in ReUnion's SteamID hash salt (needed for no-steam client support
# — see Dockerfile). Required to be non-empty or ReUnion refuses to
# initialize; generated once and persisted on the volume so player IDs stay
# stable across restarts, unless the operator sets REUNION_STEAMID_SALT.
if [[ -f "$CSTRIKE_DIR/reunion.cfg" ]]; then
  REUNION_SALT_FILE="$INSTALL_DIR/.reunion_salt"
  if [[ -n "${REUNION_STEAMID_SALT:-}" ]]; then
    REUNION_SALT="$REUNION_STEAMID_SALT"
  elif [[ -f "$REUNION_SALT_FILE" ]]; then
    REUNION_SALT="$(cat "$REUNION_SALT_FILE")"
  else
    REUNION_SALT="$(head -c32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c32)"
    echo "$REUNION_SALT" > "$REUNION_SALT_FILE"
  fi
  sed -i "s|^SteamIdHashSalt.*|SteamIdHashSalt = $REUNION_SALT|" "$CSTRIKE_DIR/reunion.cfg"
fi

# 7. Start the web panel in the background. It talks to the game server
# over loopback RCON (see panel/src/index.js's RCON_HOST default).
node /app/src/index.js &
panel_pid=$!

# 8. Run the game server under our own restart loop instead of hlds_run's
# built-in one, so the panel can genuinely stop it (not just restart it).
# hlds_run's default behavior execs straight into the engine and, on crash,
# loops forever internally — outside our control entirely, so a "stop"
# request would just get silently resurrected a few seconds later. Passing
# -norestart makes hlds_run exec the engine once and return when it exits
# (verified by reading hlds_run itself: with -norestart and no -debug, its
# run() function does a plain `exec $HL_CMD` instead of looping), which
# lets us decide whether to bring it back up.
CONTROL_DIR="/control"
STOP_FLAG="$CONTROL_DIR/stop"
mkdir -p "$CONTROL_DIR"

# The game server never auto-starts on a fresh container boot — only an
# explicit Start from the panel brings it up. Unconditionally (re)writing
# the stop flag here, before the loop below ever looks at it, means
# whatever was left over from a previous container life doesn't matter:
# every boot begins in the "stopped, waiting for the panel" state. Within
# this same run the flag still works exactly as before — cleared by Start,
# set by Stop, untouched by the crash/RCON-quit auto-restart a few lines
# down.
rm -f "$STOP_FLAG"
date -Iseconds > "$STOP_FLAG"

hlds_pid=""
cleanup() {
  echo "[entrypoint] stopping"
  if [[ -n "$hlds_pid" ]]; then
    kill -TERM "$hlds_pid" 2>/dev/null || true
    wait "$hlds_pid" 2>/dev/null || true
  fi
  kill -TERM "$panel_pid" 2>/dev/null || true
  wait "$panel_pid" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

cd "$INSTALL_DIR"
while true; do
  if [[ -f "$STOP_FLAG" ]]; then
    echo "[entrypoint] server is stopped — waiting for Start from the panel"
    while [[ -f "$STOP_FLAG" ]]; do sleep 2; done
    echo "[entrypoint] start requested — bringing the server up"
  fi
  echo "[entrypoint] starting HLDS on port $GAME_PORT, map $STARTMAP"
  ./hlds_run -norestart -console -game cstrike -port "$GAME_PORT" +map "$STARTMAP" +maxplayers "$MAXPLAYERS" &
  hlds_pid=$!
  wait "$hlds_pid" || true
  hlds_pid=""
  echo "[entrypoint] server exited, restarting in 5s (stop it from the panel to keep it down)"
  sleep 5
done
