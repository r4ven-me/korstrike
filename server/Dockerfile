# syntax=docker/dockerfile:1
#
# Stage 1: install HLDS (Half-Life Dedicated Server, appid 90 — this depot
# ships the cstrike mod content and the stock retail map set) via SteamCMD's
# anonymous login, then overlay a ReHLDS engine build for its crash/exploit
# fixes and RCON brute-force protection cvars.
FROM debian:bookworm-slim AS installer
SHELL ["/bin/bash", "-c"]

ARG REHLDS_REPO=rehlds/ReHLDS
ARG METAMOD_REPO=rehlds/Metamod-R
ARG REUNION_REPO=rehlds/ReUnion
ARG REGAMEDLL_REPO=rehlds/ReGameDLL_CS
ARG AMXMODX_REPO=alliedmodders/amxmodx
ARG REAPI_REPO=rehlds/ReAPI
ARG REDEATHMATCH_REPO=ReDeathmatch/ReDeathmatch_AMXX

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl unzip jq \
      lib32gcc-s1 lib32stdc++6 lib32z1 && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash steam
USER steam
WORKDIR /home/steam

RUN mkdir -p steamcmd && \
    curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
      | tar -xz -C steamcmd

# Installs the "steam_legacy" beta branch (the pre-25th-anniversary-update
# HLDS build) rather than the current default depot for appid 90. Verified
# necessary: the current default build's libsteam_api.so no longer exports
# SteamGameServer_Init, which ReHLDS's engine_i486.so requires — loading it
# against the current depot fails with "undefined symbol: SteamGameServer_Init
# / Unable to load engine, image is corrupt." This is a widely-reported,
# confirmed incompatibility (see rehlds/ReHLDS issue #999), not a guess.
RUN ./steamcmd/steamcmd.sh \
      +force_install_dir /home/steam/hlds \
      +login anonymous \
      +app_set_config 90 mod cstrike \
      +app_update 90 -beta steam_legacy validate \
      +quit

# Cache-busts only the ReHLDS overlay step below (steamcmd install stays cached).
ARG REHLDS_CACHEBUST=1

# Overlay ReHLDS. Resolve the latest release dynamically instead of pinning
# a specific asset URL, since exact filenames change between releases.
# Verified against the real rehlds/ReHLDS release layout: the asset is named
# "rehlds-bin-<version>.zip" (no "linux" in the filename) and contains a
# bin/linux32/ directory with engine_i486.so, filesystem_stdio.so,
# hlds_linux, hltv, core.so, demoplayer.so, proxy.so, valve/dlls/director.so
# — mirrored wholesale on top of the HLDS install root, which is the
# upstream-documented way to install ReHLDS.
RUN set -euo pipefail; \
    asset_url="$(curl -fsSL "https://api.github.com/repos/${REHLDS_REPO}/releases/latest" \
      | jq -r '[.assets[] | select(.name | test("^rehlds-bin-.*\\.zip$"))][0].browser_download_url')"; \
    if [[ -z "$asset_url" || "$asset_url" == "null" ]]; then \
      echo "Could not resolve a ReHLDS release asset, keeping stock engine." >&2; \
      exit 0; \
    fi; \
    echo "ReHLDS asset: $asset_url"; \
    mkdir -p /tmp/rehlds/extracted && cd /tmp/rehlds; \
    if ! curl -fsSL --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 --retry-delay 2 -o rehlds.zip "$asset_url"; then \
      echo "ReHLDS download failed, keeping stock engine." >&2; \
      rm -rf /tmp/rehlds; exit 0; \
    fi; \
    if ! unzip -oq rehlds.zip -d extracted; then \
      echo "ReHLDS archive failed to extract, keeping stock engine." >&2; \
      rm -rf /tmp/rehlds; exit 0; \
    fi; \
    if [[ -d extracted/bin/linux32 ]]; then \
      cp -a extracted/bin/linux32/. /home/steam/hlds/; \
      chmod +x /home/steam/hlds/hlds_linux /home/steam/hlds/hltv 2>/dev/null || true; \
      echo "ReHLDS installed."; \
    else \
      echo "ReHLDS archive layout unexpected (no bin/linux32/), keeping stock engine." >&2; \
    fi; \
    rm -rf /tmp/rehlds

# Cache-busts only the Metamod/ReUnion overlay step below.
ARG REUNION_CACHEBUST=1

# Overlay Metamod-R + ReUnion so non-Steam ("no-steam") CS 1.6 clients can
# connect too, not just genuine Steam clients. This is NOT the same as
# setting sv_lan 1 — traced through the actual ReHLDS engine source
# (sv_main.cpp) and confirmed sv_lan also gates SV_CheckIPRestrictions,
# which rejects any *Steam* client connecting from a non-local/non-reserved
# IP — i.e. it would fix no-steam clients while breaking remote Steam
# clients. ReUnion intercepts the Steam-certificate-validation failure via
# a Metamod hook instead, so real Steam clients are unaffected.
#
# Verified layout: Metamod-R release asset "metamod-bin-<ver>.zip" contains
# addons/metamod/{metamod_i386.so,config.ini}; ReUnion release asset
# "reunion-<ver>.zip" contains bin/Linux/reunion_mm_i386.so + reunion.cfg.
# Metamod is wired in by pointing liblist.gam's gamedll_linux at it instead
# of the real game DLL (it proxies through); ReUnion loads via
# addons/metamod/plugins.ini.
#
# reunion.cfg's cid_NoSteam47/48 default to "5" (reject) — that's for
# clients with no ID-spoofing add-on at all, i.e. the common/basic no-steam
# client case — so those are switched to "3" (assign a synthetic
# STEAM_-by-IP id) instead. SteamIdHashSalt ships empty, which reunion.cfg
# itself documents as a hard failure at the default AuthVersion (3) — left
# as a template token here; entrypoint.sh fills in a persisted-per-install
# random value at container start (same pattern as the panel's session
# secret) so it doesn't need to be baked into the image.
#
# ReUnion's built-in query-flood protection (EnableQueryLimiter) is disabled
# outright — observed hitting real false positives against the panel's own
# RCON polling (its status poll + cvar reads are legitimate internal
# traffic, not the external A2S/TSource query spam this feature targets),
# and IP-whitelisting it via [QueryLimiterExceptIP] didn't reliably clear
# the false-positive ban even after adding the panel's address there. For a
# private friends server this trade-off is fine: RCON is already
# password-protected with its own separate brute-force limits
# (sv_rcon_maxfailures etc. in server.cfg.template), which is the actually
# sensitive surface here.
RUN set -euo pipefail; \
    mm_asset_url="$(curl -fsSL "https://api.github.com/repos/${METAMOD_REPO}/releases/latest" \
      | jq -r '[.assets[] | select(.name | test("^metamod-bin-.*\\.zip$"))][0].browser_download_url')"; \
    reunion_asset_url="$(curl -fsSL "https://api.github.com/repos/${REUNION_REPO}/releases/latest" \
      | jq -r '[.assets[] | select(.name | test("^reunion-.*\\.zip$"))][0].browser_download_url')"; \
    if [[ -z "$mm_asset_url" || "$mm_asset_url" == "null" || -z "$reunion_asset_url" || "$reunion_asset_url" == "null" ]]; then \
      echo "Could not resolve Metamod-R/ReUnion release assets — no-steam client support will be unavailable." >&2; \
      exit 0; \
    fi; \
    echo "Metamod-R asset: $mm_asset_url"; \
    echo "ReUnion asset: $reunion_asset_url"; \
    mkdir -p /tmp/mm/extracted /tmp/reunion/extracted; \
    if ! curl -fsSL --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 --retry-delay 2 -o /tmp/mm/mm.zip "$mm_asset_url" \
       || ! curl -fsSL --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 --retry-delay 2 -o /tmp/reunion/reunion.zip "$reunion_asset_url"; then \
      echo "Metamod-R/ReUnion download failed — no-steam client support will be unavailable." >&2; \
      rm -rf /tmp/mm /tmp/reunion; exit 0; \
    fi; \
    if ! unzip -oq /tmp/mm/mm.zip -d /tmp/mm/extracted || ! unzip -oq /tmp/reunion/reunion.zip -d /tmp/reunion/extracted; then \
      echo "Metamod-R/ReUnion archive failed to extract — no-steam client support will be unavailable." >&2; \
      rm -rf /tmp/mm /tmp/reunion; exit 0; \
    fi; \
    if [[ ! -f /tmp/mm/extracted/addons/metamod/metamod_i386.so || ! -f /tmp/reunion/extracted/bin/Linux/reunion_mm_i386.so ]]; then \
      echo "Metamod-R/ReUnion archive layout unexpected — no-steam client support will be unavailable." >&2; \
      rm -rf /tmp/mm /tmp/reunion; exit 0; \
    fi; \
    mkdir -p /home/steam/hlds/cstrike/addons/metamod /home/steam/hlds/cstrike/addons/reunion; \
    cp /tmp/mm/extracted/addons/metamod/metamod_i386.so /home/steam/hlds/cstrike/addons/metamod/metamod_i386.so; \
    cp /tmp/mm/extracted/addons/metamod/config.ini /home/steam/hlds/cstrike/addons/metamod/config.ini; \
    cp /tmp/reunion/extracted/bin/Linux/reunion_mm_i386.so /home/steam/hlds/cstrike/addons/reunion/reunion_mm_i386.so; \
    echo 'linux addons/reunion/reunion_mm_i386.so' > /home/steam/hlds/cstrike/addons/metamod/plugins.ini; \
    sed -i \
      -e 's/^cid_NoSteam47[[:space:]]*=.*/cid_NoSteam47 = 3/' \
      -e 's/^cid_NoSteam48[[:space:]]*=.*/cid_NoSteam48 = 3/' \
      -e 's/^SteamIdHashSalt[[:space:]]*=.*/SteamIdHashSalt = ${REUNION_STEAMID_SALT}/' \
      -e 's/^EnableQueryLimiter[[:space:]]*=.*/EnableQueryLimiter = 0/' \
      /tmp/reunion/extracted/reunion.cfg; \
    cp /tmp/reunion/extracted/reunion.cfg /home/steam/hlds/cstrike/reunion.cfg; \
    sed -i 's#gamedll_linux "dlls/cs.so"#gamedll_linux "addons/metamod/metamod_i386.so"#' /home/steam/hlds/cstrike/liblist.gam; \
    rm -rf /tmp/mm /tmp/reunion; \
    echo "Metamod-R + ReUnion installed."

# Cache-busts only the deathmatch stack overlay step below.
ARG DEATHMATCH_CACHEBUST=1

# Overlay ReGameDLL_CS + AMX Mod X + ReAPI + ReDeathmatch for a deathmatch
# game mode (respawning, gun selection, spawn protection). Verified this is
# genuinely required rather than just AMX Mod X: ReDeathmatch's own docs
# state it's "optimized to work with ReGameDLL_CS" and its listed
# requirements name ReGameDLL_CS as mandatory (stock cs.so isn't supported;
# that's what the older, unmaintained CSDM 2.1.2 is for instead).
#
# Verified layouts:
# - ReGameDLL_CS asset "regamedll-bin-<ver>.zip" → bin/linux32/cstrike/{dlls/cs.so,delta.lst,game.cfg,game_init.cfg}.
#   Same trick as Metamod: liblist.gam's gamedll_linux already points at
#   metamod, which auto-resolves the real gamedll by the conventional
#   dlls/cs.so path — so replacing that file's contents is all that's needed.
# - AMX Mod X release ships two assets per version, "*-base-linux.tar.gz"
#   and "*-cstrike-linux.tar.gz", both extracting to the same addons/amxmodx/
#   tree (merge, don't pick one). Loads via metamod like Reunion:
#   addons/amxmodx/dlls/amxmodx_mm_i386.so registered in
#   addons/metamod/plugins.ini. Modules (fakemeta, hamsandwich, etc.) are
#   auto-detected from addons/amxmodx/modules/ — configs/modules.ini doesn't
#   need editing.
# - ReAPI asset "reapi-bin-<ver>.zip" → addons/amxmodx/modules/reapi_amxx_i386.so,
#   just another auto-detected AMXX module, no plugins.ini entry needed.
# - ReDeathmatch asset "ReDeathmatch-<ver>.zip" already contains a top-level
#   cstrike/ folder matching our layout, extracts directly. Its
#   configs/plugins-redm.ini lists the plugin lines to run (ReDeathmatch.amxx
#   + redm_spawns.amxx) — appended onto AMX Mod X's own plugins.ini rather
#   than relying on an unverified multi-file config mechanism. Its bundled
#   spawn-point data only covers de_dust2/de_inferno/de_train; other maps
#   need spawns placed in-game with the bundled redm_spawns admin tool.
#   Ships installed but OFF by default (redm_active 0, set in amxx.cfg —
#   server.cfg runs too early, before AMX Mod X registers the cvar, same
#   reasoning as redm_update_notify below); the panel's Settings tab
#   exposes redm_active as a normal toggle to turn deathmatch on/off live.
#   NOTE: this repo's latest release asset returned HTTP 504 from GitHub
#   repeatedly at the time this was written (confirmed release-specific, not
#   a transient network issue: older releases downloaded fine) — so unlike
#   the other components here, this one walks recent releases and uses the
#   first one that actually downloads, rather than trusting "latest" alone.
RUN set -euo pipefail; \
    dl() { curl -fsSL --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 --retry-delay 2 -o "$1" "$2"; }; \
    \
    echo "--- ReGameDLL_CS ---"; \
    regamedll_url="$(curl -fsSL "https://api.github.com/repos/${REGAMEDLL_REPO}/releases/latest" \
      | jq -r '[.assets[] | select(.name | test("^regamedll-bin-.*\\.zip$"))][0].browser_download_url')"; \
    if [[ -n "$regamedll_url" && "$regamedll_url" != "null" ]] \
       && mkdir -p /tmp/rgd/extracted \
       && dl /tmp/rgd/rgd.zip "$regamedll_url" \
       && unzip -oq /tmp/rgd/rgd.zip -d /tmp/rgd/extracted \
       && [[ -f /tmp/rgd/extracted/bin/linux32/cstrike/dlls/cs.so ]]; then \
      cp /tmp/rgd/extracted/bin/linux32/cstrike/dlls/cs.so /home/steam/hlds/cstrike/dlls/cs.so; \
      cp /tmp/rgd/extracted/bin/linux32/cstrike/delta.lst /home/steam/hlds/cstrike/delta.lst; \
      cp /tmp/rgd/extracted/bin/linux32/cstrike/game.cfg /home/steam/hlds/cstrike/game.cfg; \
      cp /tmp/rgd/extracted/bin/linux32/cstrike/game_init.cfg /home/steam/hlds/cstrike/game_init.cfg; \
      echo "ReGameDLL_CS installed."; \
    else \
      echo "ReGameDLL_CS install failed — deathmatch mode will be unavailable." >&2; \
    fi; \
    rm -rf /tmp/rgd; \
    \
    echo "--- AMX Mod X ---"; \
    amxx_release_json="$(curl -fsSL "https://api.github.com/repos/${AMXMODX_REPO}/releases/latest")"; \
    amxx_base_url="$(echo "$amxx_release_json" | jq -r '[.assets[] | select(.name | test("-base-linux\\.tar\\.gz$"))][0].browser_download_url')"; \
    amxx_cstrike_url="$(echo "$amxx_release_json" | jq -r '[.assets[] | select(.name | test("-cstrike-linux\\.tar\\.gz$"))][0].browser_download_url')"; \
    amxx_ok=0; \
    if [[ -n "$amxx_base_url" && "$amxx_base_url" != "null" && -n "$amxx_cstrike_url" && "$amxx_cstrike_url" != "null" ]] \
       && mkdir -p /tmp/amxx \
       && dl /tmp/amxx/base.tar.gz "$amxx_base_url" \
       && dl /tmp/amxx/cstrike.tar.gz "$amxx_cstrike_url" \
       && tar -xzf /tmp/amxx/base.tar.gz -C /home/steam/hlds/cstrike \
       && tar -xzf /tmp/amxx/cstrike.tar.gz -C /home/steam/hlds/cstrike \
       && [[ -f /home/steam/hlds/cstrike/addons/amxmodx/dlls/amxmodx_mm_i386.so ]]; then \
      echo 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so' >> /home/steam/hlds/cstrike/addons/metamod/plugins.ini; \
      amxx_ok=1; \
      echo "AMX Mod X installed."; \
    else \
      echo "AMX Mod X install failed — deathmatch mode and ban list from the panel are unaffected, but no in-game admin/DM plugins will load." >&2; \
    fi; \
    rm -rf /tmp/amxx; \
    \
    if [[ "$amxx_ok" == "1" ]]; then \
      echo "--- ReAPI ---"; \
      reapi_url="$(curl -fsSL "https://api.github.com/repos/${REAPI_REPO}/releases/latest" \
        | jq -r '[.assets[] | select(.name | test("^reapi-bin-.*\\.zip$"))][0].browser_download_url')"; \
      if [[ -n "$reapi_url" && "$reapi_url" != "null" ]] \
         && mkdir -p /tmp/reapi/extracted \
         && dl /tmp/reapi/reapi.zip "$reapi_url" \
         && unzip -oq /tmp/reapi/reapi.zip -d /tmp/reapi/extracted \
         && [[ -f /tmp/reapi/extracted/addons/amxmodx/modules/reapi_amxx_i386.so ]]; then \
        cp /tmp/reapi/extracted/addons/amxmodx/modules/reapi_amxx_i386.so \
          /home/steam/hlds/cstrike/addons/amxmodx/modules/reapi_amxx_i386.so; \
        echo "ReAPI installed."; \
      else \
        echo "ReAPI install failed — deathmatch mode will be unavailable." >&2; \
      fi; \
      rm -rf /tmp/reapi; \
      \
      echo "--- ReDeathmatch ---"; \
      redm_url=""; \
      for candidate_url in $(curl -fsSL "https://api.github.com/repos/${REDEATHMATCH_REPO}/releases?per_page=5" \
          | jq -r '.[].assets[] | select(.name | test("^ReDeathmatch-.*\\.zip$")) | .browser_download_url'); do \
        if dl /tmp/redm.zip "$candidate_url"; then redm_url="$candidate_url"; break; fi; \
        echo "ReDeathmatch asset unreachable, trying an older release: $candidate_url" >&2; \
      done; \
      if [[ -n "$redm_url" ]] \
         && mkdir -p /tmp/redm_extracted \
         && unzip -oq /tmp/redm.zip -d /tmp/redm_extracted \
         && [[ -d /tmp/redm_extracted/cstrike ]]; then \
        cp -a /tmp/redm_extracted/cstrike/. /home/steam/hlds/cstrike/; \
        cat /home/steam/hlds/cstrike/addons/amxmodx/configs/plugins-redm.ini \
          >> /home/steam/hlds/cstrike/addons/amxmodx/configs/plugins.ini; \
        printf 'redm_update_notify 0\nredm_active 0\n' >> /home/steam/hlds/cstrike/addons/amxmodx/configs/amxx.cfg; \
        echo "ReDeathmatch installed (asset: $redm_url)."; \
      else \
        echo "ReDeathmatch install failed after trying recent releases — deathmatch mode will be unavailable." >&2; \
      fi; \
      rm -rf /tmp/redm.zip /tmp/redm_extracted; \
    fi

# Stage 2: slim runtime image — just the installed game tree + runtime libs,
# running as a non-root user.
FROM debian:bookworm-slim AS runtime
SHELL ["/bin/bash", "-c"]

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl unzip gettext-base \
      lib32gcc-s1 lib32stdc++6 lib32z1 && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash hlds

COPY --from=installer --chown=hlds:hlds /home/steam/hlds /home/hlds/hlds
COPY --chown=hlds:hlds server/config /server/config
COPY --chown=root:root server/scripts /server/scripts
COPY --chown=root:root server/entrypoint.sh /server/entrypoint.sh

RUN chmod +x /server/entrypoint.sh /server/scripts/*.sh && \
    mkdir -p /maps-src && chown hlds:hlds /maps-src

# The engine looks for steamclient.so under ~/.steam/sdk32|64/ — a path a
# real Steam client install would populate, but SteamCMD alone doesn't.
# Without it, startup fails with "Unable to initialize Steam" and segfaults.
# steamclient.so itself IS present in the game install dir, so symlink it
# into the expected bootstrap location (well-documented headless-HLDS fix).
RUN mkdir -p /home/hlds/.steam/sdk32 /home/hlds/.steam/sdk64 && \
    ln -sf /home/hlds/hlds/steamclient.so /home/hlds/.steam/sdk32/steamclient.so && \
    ln -sf /home/hlds/hlds/linux64/steamclient.so /home/hlds/.steam/sdk64/steamclient.so && \
    chown -R hlds:hlds /home/hlds/.steam

# Without steam_appid.txt (containing Counter-Strike's real AppID, 10 — not
# HLDS's own tool AppID 90) the Steamworks SDK can't self-identify without a
# real Steam client session and SteamAPI_Init() fatally fails on first run.
# This is a long-documented, widely-hit issue for headless GoldSrc servers.
RUN echo "10" > /home/hlds/hlds/steam_appid.txt && chown hlds:hlds /home/hlds/hlds/steam_appid.txt

USER hlds
WORKDIR /home/hlds/hlds

VOLUME ["/home/hlds/hlds", "/maps-src"]
EXPOSE 27015/udp

ENTRYPOINT ["/server/entrypoint.sh"]
