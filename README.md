# Korstrike — CS 1.6 dedicated server + web control panel

A self-hosted Counter-Strike 1.6 (GoldSrc) server for playing with friends,
packaged as a single Docker image/service (`korstrike`) that runs two
processes side by side in one container (see "How it's wired together"
below):

- A [ReHLDS](https://github.com/rehlds/ReHLDS)-based dedicated server (a
  hardened, bug-fixed drop-in replacement for the stock HLDS engine),
  preloaded with the classic retail map pool, with
  [Metamod-R](https://github.com/rehlds/Metamod-R) +
  [ReUnion](https://github.com/rehlds/ReUnion) so both Steam and non-Steam
  ("no-steam") clients can connect.
- A small custom web panel for day-to-day admin: live player list, kick/ban,
  map switching, server password, ~50 gameplay/network/physics cvars, a raw
  RCON console, and an activity log.

Both official Steam clients and non-Steam ("no-steam") CS 1.6 clients can
connect. This needs a real fix, not just a config flag: setting `sv_lan 1`
(the "obvious" way to disable Steam validation) turns out to *also* reject
any Steam client connecting from outside the server's local subnet —
confirmed by reading the actual ReHLDS engine source, not assumed. ReUnion
solves this properly, by intercepting the Steam-certificate-validation
failure via a Metamod hook and assigning non-Steam clients a stable
synthetic SteamID instead, leaving real Steam clients completely unaffected.

## Quick start

```bash
cp .env.example .env
# edit .env: at minimum set RCON_PASSWORD, ADMIN_USER, ADMIN_PASSWORD
docker compose up -d --build
```

- Panel: `http://<your-host>:8080` — log in with `ADMIN_USER`/`ADMIN_PASSWORD`,
  then press **Start server** on the Players tab — the game process doesn't
  launch on its own (see "Server starts stopped" below).
- Game server: `<your-host>:27015` (UDP) — connect from the CS 1.6 client console
  with `connect <host>:27015`, or via the in-game server browser (LAN tab if
  `sv_lan`-visible only on your network, Internet tab once the port is
  forwarded/reachable).

If you're hosting from home, **forward the UDP port** (27015 by default) on
your router to the machine running Docker. GoldSrc uses UDP only — no TCP
port needs forwarding for the game itself.

## Maps

The image ships with the actual factory CS 1.6 map rotation out of the box
(see [server/config/mapcycle.txt](server/config/mapcycle.txt)):

```
de_dust2, de_dust, de_train, de_aztec, de_cbble, de_inferno, de_nuke,
de_prodigy, de_survivor, de_vertigo, cs_assault, cs_italy, cs_office
```

Popular community maps (`fy_iceworld`, `ka_rats`, `awp_*`, `35hp_*`, etc.)
are **not** part of the official install — they're fan-made files spread
across many sites with mixed/unclear redistribution rights, so none are
hardcoded into the image. The live game map directory (`cstrike/maps`) is
part of the `korstrike_data` Docker volume. Three ways to add a map:

1. **Download it from the panel.** Map tab → "Download a map" → give it the
   map's name and a URL to a `.bsp` or a `.zip` containing one (plus any
   `.res`/`.txt`/`.wad` resources). It's fetched, extracted, and dropped
   straight into the live maps directory — **playable immediately via
   `changelevel`, no restart needed** — and shows up in the map switcher
   right away.
2. **Copy files in directly.** `docker cp yourmap.bsp korstrike:/opt/korstrike/maps/`
   (and any matching `.res`/`.txt`/`.wad`), then `docker compose restart` —
   synced into the live install and auto-added to the mapcycle on boot.
3. **Bulk pre-seed.** `docker cp` a `maps-list.txt` (see
   [maps/maps-list.txt.example](maps/maps-list.txt.example) for the format,
   one `name=url` line per map) to `korstrike:/opt/korstrike/maps/maps-list.txt`,
   then `docker compose restart` (or
   `docker compose exec korstrike /server/scripts/download-maps.sh` without
   restarting). Already-downloaded maps are skipped, so it's safe to re-run
   any time.

New maps always show up automatically in the panel's map switcher (it
queries the engine directly, no rebuild needed).

## Panel features

| Tab | What it does |
|---|---|
| Игроки (Players) | Server power (status badge, Start/Stop) right at the top — see "Server starts stopped" below. Live player list (name, SteamID, IP, ping, time, frags), updated over a WebSocket every ~2.5s. Kick or ban directly from a row; add/remove bots from the toolbar above the table (see "Bots" below). |
| Карта (Map) | Change the live map from a dropdown of all installed maps; download a new map from a URL directly into the live maps directory, playable immediately. |
| Баны (Bans) | Ban/unban by SteamID **and** by IP, with the current lists. IP bans matter because non-Steam clients often all share the same placeholder SteamID — banning by IP is what actually works against those. |
| Настройки (Settings) | Toggle the server join password (`sv_password`); restart the game process; ~50 gameplay/network/physics cvars grouped by category, each with a hover tooltip and live current value. Settings that can't be changed while the server is running (like `maxplayers`) are shown read-only with an explanation instead of a broken "Apply" button — those come from `.env` and need a container recreate (`docker compose up -d`), which the panel deliberately doesn't have the privileges to trigger itself. |
| Консоль (Console) | Run any raw RCON command for anything not covered by a button. |
| Журнал (Activity) | Who did what and when — every panel action is appended to an audit log. |

Note: CS 1.6/GoldSrc has no native *per-team* join password — only the one
server-wide `sv_password`, which is what the Settings tab exposes.

**Restart** sends `quit` over RCON; the game process shuts down cleanly and
our own restart loop in `entrypoint.sh` brings it back up a few seconds
later — no Docker-level access needed from the panel for this.

**Stop/Start** genuinely stops the game process rather than just restarting
it — useful if you don't want the server running all the time. This needed
more than RCON alone: `hlds_run`'s *own* built-in supervisor auto-restarts
on any exit, including a clean `quit`, so it never actually "stays down" on
its own. `entrypoint.sh` instead runs `hlds_run -norestart` (which, read
straight from `hlds_run`'s own source, execs the engine once and returns
control instead of looping) inside its own restart loop that checks a stop
flag in a small local `/control` directory between each run — the panel
process (running in the same container) just sets/clears that flag, no
RCON needed either way. The container itself keeps running either way;
only the game process inside stops.

### Server starts stopped

`docker compose up` brings the container up, but the actual HLDS process
does **not** launch on its own — the Players tab's status badge shows
"Stopped" and you press **Start server** yourself whenever you want to
play. This holds on every container (re)start, not just the very first
one: `entrypoint.sh` unconditionally (re)writes the stop flag before it
ever looks at it, so whatever was left over from a previous container life
is ignored — every boot begins stopped, waiting for the panel. Within a
single container's uptime, Start/Stop, the Restart button, and crash
recovery all keep working exactly as described above; only a fresh
container boot resets to stopped.

## Deathmatch mode

Stock CS 1.6 has no built-in deathmatch — the `cstrike` mod only knows the
classic round-based bomb/hostage flow. This image adds it via
[ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS) (a reimplementation
of the game-logic DLL, required — [ReDeathmatch](https://github.com/ReDeathmatch/ReDeathmatch_AMXX)
is built against its extended API and doesn't run on the stock gamedll) +
[AMX Mod X](https://github.com/alliedmodders/amxmodx) +
[ReAPI](https://github.com/rehlds/ReAPI) + ReDeathmatch itself, all
installed but **off by default** — toggle it live from the panel's Settings
tab ("Deathmatch mode", the `redm_active` cvar) whenever you want it instead
of classic round-based play. Once on: respawning, gun selection menu, spawn
protection.

**Maps**: ReDeathmatch ships ready-made spawn points for `de_dust2`,
`de_inferno`, and `de_train` only. Other maps need spawns placed manually —
it bundles an in-game admin tool for exactly that (`redm_spawns`, loaded
alongside the main plugin); see the
[ReDeathmatch docs](https://redeathmatch.github.io/) for how to use it and
for the full list of `redm_*` cvars (weapon sets, respawn timing, spawn
protection, etc.) — not reproduced here, tune it from the panel's Console
tab.

You may see a harmless `AmxxEasyHttp module is not loaded` warning in the
logs on map change — that's ReDeathmatch's optional self-update checker,
not installed here on purpose (nothing to do with gameplay).

Every component here resolves its "latest" GitHub release dynamically at
build time, same as ReHLDS/ReUnion — see the comments in `Dockerfile`
for the verified file layouts and the one case (ReDeathmatch) where the
latest release's asset was intermittently unreachable on GitHub's end, so
the build walks recent releases instead of trusting "latest" alone.

## Bots

The image ships with [YaPB](https://github.com/yapb/yapb), a maintained CS
bot, installed as a Metamod plugin (independent of the AMX Mod X/deathmatch
stack above). The Players tab has a small toolbar above the player list:
**+ Add bot**, **− Remove bot** (kicks one, picked by the bot itself), and
**Remove all bots** — each just sends `yb add` / `yb kick` / `yb kickall`
over RCON. Bots show up as regular rows in the player list (with SteamID
shown as `BOT`, which is also how the panel tells bots apart from real
players to hide the meaningless Ban button on their row) and can be kicked
individually from there like any other player.

No bots spawn on their own — the bundled config leaves YaPB's auto-fill
quota (`yb_quota`) at 0, so bot count is whatever you set from the panel,
nothing more. YaPB's bundled waypoints already cover this image's entire
stock map pool (`de_dust2`, `de_dust`, `de_train`, `de_aztec`, `de_cbble`,
`de_inferno`, `de_nuke`, `de_prodigy`, `de_survivor`, `de_vertigo`,
`cs_assault`, `cs_italy`, `cs_office`), so bots work immediately without
generating waypoints yourself. Custom maps you add will need their own
waypoints — see the
[YaPB docs](https://yapb.readthedocs.io/en/latest/waypointing.html) for how
to place them in-game, or the panel's Console tab for the full `yb_*` cvar
set (difficulty, personality, weapon restrictions, etc.) not otherwise
exposed as buttons.

## Personal spray (custom decal)

There's no server setting for "give only me a unique spray" — sprays are
entirely **client-side**. Every player's game already only shows *their own*
chosen decal to others; nobody else's spray changes no matter what you do on
your end, so this is naturally already "only you have it."

To set your own:

1. A ready-to-use decal image is included at
   [assets/admin-spray.bmp](assets/admin-spray.bmp) (96×96, converted from
   `favicon.png` — GoldSrc sprays are capped at 12,288 px of total surface
   area, e.g. 96×96 or 128×96, so fine detail gets soft at this size; use
   your own source image at that size for a sharper result if you want).
2. In CS 1.6: **Options → Multiplayer → Spraypaint Image**, browse to the
   `.bmp` file, select it — the game converts and saves it as
   `tempdecal.wad` in your local install automatically.
3. If your spray key isn't bound, add `bind "t" "impulse 201"` (or any key
   you like) to your own `userconfig.cfg`.
4. Optional: mark your local `tempdecal.wad` read-only so other servers you
   play on can't silently overwrite it with their own default spray.

## Panel branding

The panel's browser tab icon, login screen, and header logo are generated
from `favicon.png` at the repo root (`panel/public/logo.png` and
`panel/public/icons/`). Swap `favicon.png` for your own image and regenerate
with:

```bash
python3 -c "
from PIL import Image
src = Image.open('favicon.png').convert('RGBA')
for size, path in [(32,'panel/public/icons/favicon-32.png'), (192,'panel/public/icons/favicon-192.png'), (256,'panel/public/logo.png')]:
    src.resize((size, size), Image.LANCZOS).save(path)
"
docker compose up -d --build
```

## How it's wired together

- **One image, one container, two processes.** `entrypoint.sh` is PID 1: it
  renders the game server's config, starts the panel (`node`) in the
  background, then runs the HLDS supervisor loop in the foreground (see
  "Stop/Start" above). Both are started by the same script and stopped by
  the same `trap … TERM INT` handler, so `docker stop`/`restart` shuts down
  cleanly. `docker compose logs` interleaves both processes' output in one
  stream — server lines (`[entrypoint] …`, HLDS console output) alongside
  the panel's (`Panel listening on :8080`, RCON warnings, etc.).
- The panel talks to the game server over the **GoldSrc RCON protocol** (a
  small UDP challenge/response scheme — not the same protocol as
  Source-engine RCON), over loopback (`127.0.0.1`). It polls `status`
  periodically for the player list and issues admin commands (`kick`,
  `banid`, `addip`, `changelevel`, cvar sets, etc.) the same way you would
  over `rcon` in a console.
- `RCON_PASSWORD` in `.env` configures both sides of that same RCON
  connection — the server enforces it, the panel authenticates with it. It
  has no built-in default; compose refuses to start without it.
- The panel itself has a single admin account, seeded from `ADMIN_USER` /
  `ADMIN_PASSWORD` at startup (hashed with bcrypt), with cookie-based
  sessions (in-memory — restarting the container logs everyone out).
  `SESSION_SECRET` is auto-generated and persisted to the `korstrike_panel`
  volume if you don't set one.

## Security notes

- **ReHLDS** fixes a number of known GoldSrc engine crash/exploit bugs and
  adds RCON brute-force protection (`sv_rcon_maxfailures`,
  `sv_rcon_banpenalty`, etc. — see `server/config/server.cfg.template`),
  used here instead of stock HLDS.
- The container runs as a single **non-root user**, with `cap_drop: ALL` and
  `no-new-privileges`, plus memory/CPU limits in `compose.yaml`. The game
  server and the panel share that user and filesystem — fine for this
  project's threat model (friends-only server, RCON already
  password-protected, panel not exposed to the open internet), not a fit
  for a multi-tenant or public-facing deployment.
- The panel is served over **plain HTTP**, by design — it's meant for a home
  LAN or a port forwarded just for your friend group, not for open internet
  exposure. If you want remote access:
  - Put it behind a **VPN** (Tailscale, WireGuard) and don't publish
    `PANEL_PORT` to the internet at all — the recommended option.
  - Or put your own TLS-terminating reverse proxy (Caddy, Nginx, Traefik) in
    front of it — not included here to keep the stack simple, and because it
    requires a domain name pointed at your server.
- Never commit your real `.env` — it's gitignored.

## Extending

- **Metamod-R and AMX Mod X** both ship already (needed for ReUnion and
  ReDeathmatch respectively — see "Deathmatch mode" above), with a basic set
  of admin plugins from AMX Mod X's own default install. Beyond that, the
  panel's RCON-based admin covers the common cases (kick/ban/map/password/
  cvars). If you want more in-game plugins (Gun Game, Zombie Mod, stats,
  etc.), drop their `.amxx` files into `cstrike/addons/amxmodx/plugins/` and
  add a line to `cstrike/addons/amxmodx/configs/plugins.ini` — no further
  Metamod/AMX Mod X setup needed, it's already there.
- The RCON console tab in the panel already gives you an escape hatch for
  any server cvar or command not otherwise exposed in the UI.

## Troubleshooting

- **Container restarts immediately / "RCON_PASSWORD is required"** (or the
  same for `ADMIN_USER`/`ADMIN_PASSWORD`): you haven't set it in `.env`.
- **Players tab shows "Server is stopped" after `docker compose up`**: expected —
  see "Server starts stopped" above; press **Start server** on the Players tab.
- **Panel shows no players / "not polled yet"** (server already started):
  check `docker compose logs korstrike` — usually means the game server
  hasn't finished starting yet (give it a few more seconds after Start), or
  a stale `RCON_PASSWORD` baked into an old container (`docker compose up -d`
  after changing `.env` to recreate it).
- **Can't connect from outside your network**: confirm the UDP port is
  forwarded on your router to the Docker host, and that `sv_lan 0` is set
  (it is, by default, in `server.cfg.template`).
- **Custom map doesn't show up**: check `docker compose logs korstrike` for
  `[download-maps]` warnings, and confirm the `.bsp` filename (without
  extension) matches what you typed in `maps-list.txt`.
- **Panel became unreachable but the game server is still up**: the panel
  process crashed independently of the game server — restart the whole
  thing with `docker compose restart` (see "How it's wired together": a
  panel crash isn't auto-recovered on its own, unlike the game process).

## Author

Ivan Cherniy — [r4ven.me](https://r4ven.me).
Source: [github.com/r4ven-me/korstrike](https://github.com/r4ven-me/korstrike).

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later), see
[LICENSE](LICENSE).
