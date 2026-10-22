'use strict';

const path = require('node:path');
const { createApp } = require('./app');
const { ensureAdmin } = require('./seed');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const port = Number(process.env.PORT) || 3000;

const app = createApp({ dataDir, secureCookies: process.env.SECURE_COOKIES === '1' });
ensureAdmin(app.locals.db);

app.listen(port, () => {
  console.log(`Plan Vault listening on http://localhost:${port} (data: ${dataDir})`);
});
