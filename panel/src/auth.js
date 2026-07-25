'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.PANEL_DATA_DIR || '/panel-data';
const SECRET_FILE = path.join(DATA_DIR, 'session_secret');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

function buildAdmin() {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('ADMIN_USER and ADMIN_PASSWORD must be set (see .env.example)');
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  return { username, passwordHash };
}

function verifyCredentials(admin, username, password) {
  if (username !== admin.username) return false;
  return bcrypt.compareSync(password || '', admin.passwordHash);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'not authenticated' });
}

module.exports = { getSessionSecret, buildAdmin, verifyCredentials, requireAuth };
