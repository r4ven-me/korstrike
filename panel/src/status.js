'use strict';

// Parses the text output of the GoldSrc `status` RCON command into a
// structured object. Column layout has been stable across HLDS/ReHLDS for
// a long time, but we parse defensively since it's plain text.
function parseStatus(text) {
  const hostnameMatch = text.match(/^hostname:\s*(.+)$/m);
  const mapMatch = text.match(/^map\s*:\s*(\S+)/m);
  const playersMatch = text.match(/^players\s*:\s*(\d+)\s+\w+\s*\((\d+)\s*max\)/m);

  // Real layout (verified against a captured HLDS status dump):
  // "#  <row> \"<name>\" <userid> <uniqueid> <frag> <time> <ping> <loss> <adr>"
  // `userid` (not the leading row number) is what `kick #<id>` expects.
  const players = [];
  const lineRe = /^#\s*(\d+)\s+"(.*)"\s+(\d+)\s+(\S+)\s+(-?\d+)\s+([\d:]+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/gm;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    players.push({
      name: m[2],
      userid: m[3],
      steamid: m[4],
      frags: Number(m[5]),
      time: m[6],
      ping: Number(m[7]),
      loss: Number(m[8]),
      address: m[9],
    });
  }

  return {
    hostname: hostnameMatch ? hostnameMatch[1].trim() : null,
    map: mapMatch ? mapMatch[1] : null,
    playersActive: playersMatch ? Number(playersMatch[1]) : players.length,
    maxPlayers: playersMatch ? Number(playersMatch[2]) : null,
    players,
    raw: text,
  };
}

// Parses `maps *` output into a de-duplicated list of installed map names.
// Verified against a live server: each installed map is printed as its own
// "<name>.bsp" line (the list appears twice, once per search path, hence
// the de-dup), preceded by a "-------------" separator line. Matching on
// the ".bsp" suffix specifically (rather than scraping bare words) avoids
// picking up stray non-map tokens from the surrounding output.
function parseMapList(text) {
  const names = new Set();
  const tokenRe = /\b([a-z][a-z0-9_]{2,})\.bsp\b/gi;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    names.add(m[1].toLowerCase());
  }
  return [...names].sort();
}

module.exports = { parseStatus, parseMapList };
