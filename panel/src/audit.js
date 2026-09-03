'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.PANEL_DATA_DIR || '/opt/korstrike/panel';
const LOG_FILE = path.join(DATA_DIR, 'audit.log');

function record(user, action, detail) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const entry = { ts: new Date().toISOString(), user, action, detail };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

function recent(limit = 200) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

module.exports = { record, recent };
