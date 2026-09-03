'use strict';

const fs = require('fs');
const path = require('path');

const CONTROL_DIR = process.env.CONTROL_DIR || '/control';
const STOP_FLAG = path.join(CONTROL_DIR, 'stop');

// entrypoint.sh's restart loop polls for this same file in /control to
// decide whether to bring the game process back up after it exits.
// Writing/removing it here is the entire "stop"/"start" mechanism; no RCON
// needed.
function isStopped() {
  return fs.existsSync(STOP_FLAG);
}

function requestStop() {
  fs.mkdirSync(CONTROL_DIR, { recursive: true });
  // Delete before writing rather than a plain truncate-write: entrypoint.sh
  // also writes this same file on its own boot-time reset (see
  // /entrypoint.sh).
  fs.rmSync(STOP_FLAG, { force: true });
  fs.writeFileSync(STOP_FLAG, new Date().toISOString());
}

function requestStart() {
  fs.rmSync(STOP_FLAG, { force: true });
}

module.exports = { isStopped, requestStop, requestStart };
