'use strict';

const crypto = require('node:crypto');
const { fail } = require('./util');

const SESSION_DAYS = 7;
const COOKIE = 'pv_session';
const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 864e5 };
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Attaches req.user when a valid session cookie is present.
function sessionMiddleware(db) {
  const lookup = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.clearance
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    req.sessionToken = token;
    req.user = token ? lookup.get(token, new Date().toISOString()) || null : null;
    next();
  };
}

function requireUser(req, _res, next) {
  if (!req.user) fail(401, 'Sign in required');
  next();
}

function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) fail(401, 'Sign in required');
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) fail(403, `Requires ${role} role`);
    next();
  };
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  sessionMiddleware,
  requireUser,
  requireRole,
};
