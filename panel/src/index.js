'use strict';

const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');

const { rconCommand, getChallenge, rconCommandWithChallenge } = require('./rcon');
const { parseStatus } = require('./status');
const { getSessionSecret, buildAdmin, verifyCredentials } = require('./auth');
const { createRouter } = require('./routes');
const { setupWebSocket } = require('./ws');
const serverControl = require('./servercontrol');

const PORT = 8080;
const RCON_HOST = process.env.RCON_HOST || '127.0.0.1';
const RCON_PORT = Number(process.env.RCON_PORT || process.env.GAME_PORT || 27015);
const RCON_PASSWORD = process.env.RCON_PASSWORD;
const POLL_INTERVAL_MS = 2500;

if (!RCON_PASSWORD) {
  console.error("RCON_PASSWORD is required and must match the game server's rcon_password");
  process.exit(1);
}

const admin = buildAdmin(); // throws if ADMIN_USER/ADMIN_PASSWORD missing
const wsTokens = new Map();

let cachedStatus = {
  hostname: null,
  map: null,
  playersActive: 0,
  maxPlayers: null,
  players: [],
  raw: '',
  error: 'not polled yet',
};

async function rcon(command) {
  return rconCommand(RCON_HOST, RCON_PORT, RCON_PASSWORD, command);
}

// The server appears to track only one outstanding challenge rather than
// one per requester (observed: two near-simultaneous challenge requests
// from concurrent page loads caused the earlier one to stop working) — so
// concurrent callers within this panel share a short-lived cached
// challenge instead of each fetching their own and stomping on each other.
// Dedupes truly-simultaneous callers onto the same in-flight fetch too —
// a plain "check cache, then fetch" isn't atomic across concurrent requests.
let cachedChallenge = null;
let cachedChallengeAt = 0;
let inFlightChallenge = null;
const CHALLENGE_TTL_MS = 2000;

async function rconGetChallenge() {
  if (cachedChallenge && Date.now() - cachedChallengeAt < CHALLENGE_TTL_MS) {
    return cachedChallenge;
  }
  if (!inFlightChallenge) {
    inFlightChallenge = getChallenge(RCON_HOST, RCON_PORT, RCON_PASSWORD)
      .then((challenge) => {
        cachedChallenge = challenge;
        cachedChallengeAt = Date.now();
        return challenge;
      })
      .finally(() => {
        inFlightChallenge = null;
      });
  }
  return inFlightChallenge;
}

async function rconWithChallenge(challenge, command) {
  return rconCommandWithChallenge(RCON_HOST, RCON_PORT, RCON_PASSWORD, challenge, command);
}

const app = express();
app.use(express.json());
app.use(
  session({
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 },
  })
);

app.use('/api', createRouter({ rcon, rconGetChallenge, rconWithChallenge, getStatus: () => cachedStatus, admin, verifyCredentials, wsTokens }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const server = http.createServer(app);
const { broadcast } = setupWebSocket(server, { wsTokens });

async function poll() {
  // Skip hammering RCON with a doomed request every tick while the operator
  // has intentionally stopped the game process from the panel — there's
  // nothing listening, and each failed attempt would otherwise cost a full
  // multi-second timeout for no reason.
  if (serverControl.isStopped()) {
    cachedStatus = { ...cachedStatus, stopped: true, error: null };
    broadcast(cachedStatus);
    return;
  }
  try {
    const raw = await rcon('status');
    cachedStatus = { ...parseStatus(raw), stopped: false };
  } catch (err) {
    cachedStatus = { ...cachedStatus, stopped: false, error: err.message };
  }
  broadcast(cachedStatus);
}

setInterval(poll, POLL_INTERVAL_MS);
poll();

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of wsTokens) {
    if (entry.expires < now) wsTokens.delete(token);
  }
}, 60_000);

server.listen(PORT, () => {
  console.log(`Panel listening on :${PORT}`);
});
