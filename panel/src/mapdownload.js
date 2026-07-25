'use strict';

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAPS_DIR = process.env.MAPS_DIR || '/maps-data';
const MAX_BYTES = 200 * 1024 * 1024; // generous cap for a CS map/resource pack

async function downloadToBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);

  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) throw new Error('file too large (over 200MB)');

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) throw new Error('file too large (over 200MB)');
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function walk(dir, found) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, found);
    else if (/\.(bsp|res|txt|wad)$/i.test(entry.name)) found.push(full);
  }
}

// Downloads a map from a URL (zip or bare .bsp), extracts it, and drops the
// .bsp + matching resource files (.res/.txt/.wad) straight into the shared
// maps-data volume — the same volume cs-server mounts as its live maps
// directory, so the map is playable immediately, no restart needed.
async function downloadMap(name, url) {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('invalid map name');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must be http or https');

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'map-'));
  try {
    const buf = await downloadToBuffer(url);
    const extractDir = path.join(tmpDir, 'extracted');
    await fsp.mkdir(extractDir, { recursive: true });

    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
    if (isZip) {
      const zipPath = path.join(tmpDir, 'map.zip');
      await fsp.writeFile(zipPath, buf);
      await execFileAsync('unzip', ['-oq', zipPath, '-d', extractDir]);
    } else {
      await fsp.writeFile(path.join(extractDir, `${name}.bsp`), buf);
    }

    const found = [];
    await walk(extractDir, found);

    const hasMap = found.some((f) => path.basename(f).toLowerCase() === `${name.toLowerCase()}.bsp`);
    if (!hasMap) {
      throw new Error(`no ${name}.bsp found in the downloaded file — check the name matches the archive's contents`);
    }

    for (const file of found) {
      await fsp.copyFile(file, path.join(MAPS_DIR, path.basename(file)));
    }
    return found.map((f) => path.basename(f));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { downloadMap };
