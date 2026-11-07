'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { openDb, ENUMS } = require('./db');
const { createStorage } = require('./storage');
const { sessionMiddleware, requireUser } = require('./auth');
const { HttpError } = require('./util');

function createApp({ dataDir, secureCookies = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'planvault.db'));
  const storage = createStorage(path.join(dataDir, 'files'));
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const ctx = { db, storage, tmpDir, secureCookies };

  const app = express();
  app.disable('x-powered-by');
  // Behind a platform load balancer (e.g. Render) set TRUST_PROXY=1.
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : 'loopback');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  const api = express.Router();
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  api.use(express.json({ limit: '1mb' }));
  api.use(sessionMiddleware(db));
  api.use(require('./routes/account')(ctx));
  api.use(requireUser);

  api.get('/meta', (_req, res) => res.json(ENUMS));
  api.get('/stats', (req, res) => {
    const c = req.user.clearance;
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    res.json({
      templates: one("SELECT COUNT(*) AS n FROM plans WHERE is_template = 1 AND status <> 'archived' AND sensitivity <= ?", c),
      plans: one("SELECT COUNT(*) AS n FROM plans WHERE is_template = 0 AND status <> 'archived' AND sensitivity <= ?", c),
      sites: one('SELECT COUNT(*) AS n FROM sites'),
      buildings: one('SELECT COUNT(*) AS n FROM buildings'),
      open_work: one("SELECT COUNT(*) AS n FROM work_records WHERE status IN ('planned', 'in progress')"),
      work: one('SELECT COUNT(*) AS n FROM work_records'),
      users: one('SELECT COUNT(*) AS n FROM users WHERE active = 1'),
    });
  });
  api.use(require('./routes/plans')(ctx));
  api.use(require('./routes/facilities')(ctx));
  api.use(require('./routes/work')(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = 'File is too large';
    } else if (err.code === 'ERR_SQLITE_ERROR' && /FOREIGN KEY/.test(err.message)) {
      status = 400;
      message = 'Referenced record does not exist';
    }
    if (status >= 500) {
      console.error(err);
      message = 'Internal server error';
    }
    res.status(status).json({ error: message });
  });

  app.locals.db = db;
  app.locals.storage = storage;
  return app;
}

module.exports = { createApp };
