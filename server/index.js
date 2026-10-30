'use strict';

const path = require('node:path');
const { createApp } = require('./app');
const { ensureAdmin, seedDemo } = require('./seed');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const port = Number(process.env.PORT) || 3000;

const app = createApp({ dataDir, secureCookies: process.env.SECURE_COOKIES === '1' });
ensureAdmin(app.locals.db);
// Hosted demos: load sample data on first boot (no known-password accounts).
if (process.env.SEED_DEMO === '1') seedDemo(app.locals.db, app.locals.storage, { demoUsers: false });

app.listen(port, () => {
  console.log(`Plan Vault listening on http://localhost:${port} (data: ${dataDir})`);
});
