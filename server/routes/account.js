'use strict';

const express = require('express');
const { ENUMS } = require('../db');
const A = require('../auth');
const { fail, field, defined, insert, update, audit } = require('../util');

// Rejects obvious brute force without external state: per-username lockout.
const failures = new Map();
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60 * 1000;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) fail(400, 'Password must be at least 10 characters');
  return pw;
}

module.exports = function accountRouter({ db, secureCookies }) {
  const router = express.Router();

  const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };

  router.post('/auth/login', (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const f = failures.get(username);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.at < LOCK_MS) fail(429, 'Too many attempts; try again later');
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user || !A.verifyPassword(password, user.password_hash)) {
      failures.set(username, { count: (f && Date.now() - f.at < LOCK_MS ? f.count : 0) + 1, at: Date.now() });
      fail(401, 'Invalid username or password');
    }
    failures.delete(username);
    const { token, maxAge } = A.createSession(db, user.id);
    res.cookie(A.COOKIE, token, { ...cookieOpts, maxAge });
    audit(db, user, 'login', 'user', user.id);
    res.json({ id: user.id });
  });

  router.post('/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.clearCookie(A.COOKIE, cookieOpts);
    res.json({ ok: true });
  });

  router.get('/auth/me', A.requireUser, (req, res) => res.json(req.user));

  router.post('/auth/password', A.requireUser, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!A.verifyPassword(String(req.body.current_password || ''), row.password_hash)) fail(400, 'Current password is incorrect');
    const hash = A.hashPassword(checkPassword(req.body.new_password));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
    audit(db, req.user, 'change-password', 'user', req.user.id);
    res.json({ ok: true });
  });

  const admin = A.requireRole('admin');

  function readUser(body, creating) {
    const row = defined({
      username: field.text(body, 'username', { required: creating, max: 60 }),
      display_name: field.text(body, 'display_name', { required: creating, max: 120 }),
      role: field.oneOf(body, 'role', ENUMS.roles, { required: creating }),
      clearance: field.int(body, 'clearance', { max: ENUMS.sensitivity.length - 1 }),
      active: 'active' in body ? (body.active ? 1 : 0) : undefined,
    });
    if (row.username) {
      row.username = row.username.toLowerCase();
      if (!/^[a-z0-9._-]+$/.test(row.username)) fail(400, 'Username may contain letters, digits, dot, dash, underscore');
    }
    return row;
  }

  router.get('/users', admin, (_req, res) => {
    res.json(db.prepare('SELECT id, username, display_name, role, clearance, active, created_at FROM users ORDER BY username').all());
  });

  router.post('/users', admin, (req, res) => {
    const row = readUser(req.body, true);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(row.username)) fail(409, 'Username already exists');
    row.password_hash = A.hashPassword(checkPassword(req.body.password));
    const id = insert(db, 'users', row);
    audit(db, req.user, 'create', 'user', id, row.username);
    res.status(201).json({ id });
  });

  router.put('/users/:id', admin, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!target) fail(404, 'User not found');
    const row = readUser(req.body, false);
    delete row.username;
    if (target.id === req.user.id && (row.role && row.role !== 'admin' || row.active === 0)) {
      fail(400, 'You cannot demote or deactivate your own account');
    }
    if (req.body.password) row.password_hash = A.hashPassword(checkPassword(req.body.password));
    update(db, 'users', target.id, row);
    if (row.active === 0 || row.password_hash) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    audit(db, req.user, 'update', 'user', target.id, Object.keys(row).filter((k) => k !== 'password_hash').join(', ') + (row.password_hash ? ' (password reset)' : ''));
    res.json({ id: target.id });
  });

  router.get('/audit', admin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(db.prepare(`
      SELECT a.*, u.display_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT ?`).all(limit));
  });

  return router;
};
