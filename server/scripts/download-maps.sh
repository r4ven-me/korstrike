#!/usr/bin/env bash
# Fetches any maps listed in maps-list.txt that aren't already present.
# Safe to re-run: existing .bsp files are never re-downloaded or overwritten.
set -uo pipefail

MAPS_SRC="${MAPS_SRC:-/maps-src}"
LIST_FILE="$MAPS_SRC/maps-list.txt"

if [[ ! -f "$LIST_FILE" ]]; then
  echo "[download-maps] no $LIST_FILE found, skipping custom map downloads."
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
  line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$line" || "$line" == \#* ]] && continue

  name="${line%%=*}"
  url="${line#*=}"
  name="$(echo "$name" | sed -e 's/[[:space:]]*$//')"
  url="$(echo "$url" | sed -e 's/^[[:space:]]*//')"
  [[ -z "$name" || -z "$url" ]] && continue

  if [[ -f "$MAPS_SRC/$name.bsp" ]]; then
    echo "[download-maps] $name already present, skipping."
    continue
  fi

  echo "[download-maps] fetching $name from $url"
  out_file="$tmp_dir/$name.download"
  if ! curl -fsSL --max-time 120 -o "$out_file" "$url"; then
    echo "[download-maps] WARNING: failed to download $name from $url" >&2
    continue
  fi

  extract_dir="$tmp_dir/$name"
  mkdir -p "$extract_dir"
  if [[ "$(head -c2 "$out_file")" == "PK" ]]; then
    unzip -oq "$out_file" -d "$extract_dir"
  else
    cp "$out_file" "$extract_dir/$name.bsp"
  fi

  find "$extract_dir" -type f \( -iname '*.bsp' -o -iname '*.res' -o -iname '*.txt' -o -iname '*.wad' \) -exec cp -f {} "$MAPS_SRC/" \;

  if [[ -f "$MAPS_SRC/$name.bsp" ]]; then
    echo "[download-maps] installed $name"
  else
    echo "[download-maps] WARNING: $name.bsp not found after extracting $url — check the URL/archive contents." >&2
  fi
done < "$LIST_FILE"
