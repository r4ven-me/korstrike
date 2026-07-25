'use strict';

const dgram = require('dgram');

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

// Collects one or more UDP response packets, treating a short gap of
// inactivity after the last packet as "response complete" — GoldSrc RCON
// has no explicit end-of-response marker, so this is the standard approach.
function sendAndCollect(socket, host, port, payload, { settleMs = 250, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settleTimer = null;
    let hardTimer = null;
    let done = false;

    const cleanup = () => {
      done = true;
      socket.removeListener('message', onMessage);
      clearTimeout(settleTimer);
      clearTimeout(hardTimer);
    };

    const finish = () => {
      if (done) return;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onMessage = (msg) => {
      chunks.push(msg);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settleMs);
    };

    hardTimer = setTimeout(() => {
      if (chunks.length === 0) {
        cleanup();
        reject(new Error('RCON request timed out'));
      } else {
        finish();
      }
    }, timeoutMs);

    socket.on('message', onMessage);
    socket.send(payload, port, host, (err) => {
      if (err && !done) {
        cleanup();
        reject(err);
      }
    });
  });
}

// Strips the `\xff\xff\xff\xffl` framing GoldSrc prefixes onto each RCON
// response packet, concatenating the console text they carry.
function stripPackets(buf) {
  let out = '';
  let offset = 0;
  while (offset <= buf.length - 4 && buf.readUInt32LE(offset) === 0xffffffff) {
    offset += 4;
    if (buf[offset] === 0x6c) offset += 1; // 'l'
    const next = buf.indexOf(HEADER, offset);
    const end = next === -1 ? buf.length : next;
    out += buf.toString('latin1', offset, end);
    offset = end;
  }
  // The engine pads/terminates some responses with trailing NUL bytes
  // (verified against a live server) — never meaningful content.
  return out.replace(/\0+$/, '');
}

function bindSocket(socket) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(() => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}

// Verified against a live server: a challenge token isn't tied to the
// source port it was requested from — one challenge can be reused across
// many parallel commands sent from different sockets. Fetching cvar values
// one-by-one (each a full challenge+command round trip) was the dominant
// cost of loading the Settings tab; sharing a single challenge cuts that
// traffic roughly in half.
async function getChallenge(host, port, password, opts = {}) {
  const socket = dgram.createSocket('udp4');
  try {
    await bindSocket(socket);
    const challengeReq = Buffer.concat([HEADER, Buffer.from('challenge rcon\n', 'latin1')]);
    const challengeRes = stripPackets(await sendAndCollect(socket, host, port, challengeReq, opts));
    const match = challengeRes.match(/challenge rcon\s+(\d+)/);
    if (!match) {
      throw new Error(`Unexpected challenge response from server: ${challengeRes.trim() || '(empty)'}`);
    }
    return match[1];
  } finally {
    socket.close();
  }
}

async function rconCommandWithChallenge(host, port, password, challenge, command, opts = {}) {
  const socket = dgram.createSocket('udp4');
  try {
    await bindSocket(socket);
    const cmdReq = Buffer.concat([
      HEADER,
      Buffer.from(`rcon ${challenge} "${password}" ${command}\n`, 'latin1'),
    ]);
    const cmdRes = await sendAndCollect(socket, host, port, cmdReq, opts);
    return stripPackets(cmdRes);
  } finally {
    socket.close();
  }
}

async function rconCommand(host, port, password, command, opts = {}) {
  const challenge = await getChallenge(host, port, password, opts);
  return rconCommandWithChallenge(host, port, password, challenge, command, opts);
}

module.exports = { rconCommand, getChallenge, rconCommandWithChallenge };
