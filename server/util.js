'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

// Field coercers for request bodies. Each returns undefined when the key is
// absent so callers can tell "not sent" (keep current value) from "cleared".
const field = {
  text(body, key, { required = false, max = 2000 } = {}) {
    if (!(key in body)) return required ? fail(400, `${key} is required`) : undefined;
    const v = body[key] == null ? '' : String(body[key]).trim();
    if (required && !v) fail(400, `${key} is required`);
    if (v.length > max) fail(400, `${key} is too long`);
    return v || null;
  },
  int(body, key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!(key in body)) return undefined;
    if (body[key] === '' || body[key] == null) return null;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < min || n > max) fail(400, `${key} must be a whole number`);
    return n;
  },
  num(body, key) {
    if (!(key in body)) return undefined;
    if (body[key] === '' || body[key] == null) return null;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) fail(400, `${key} must be a positive number`);
    return n;
  },
  oneOf(body, key, options, { required = false } = {}) {
    if (!(key in body) || body[key] === '' || body[key] == null) {
      return required ? fail(400, `${key} is required`) : key in body ? null : undefined;
    }
    if (!options.includes(body[key])) fail(400, `${key} must be one of: ${options.join(', ')}`);
    return body[key];
  },
  date(body, key) {
    if (!(key in body)) return undefined;
    if (!body[key]) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body[key])) fail(400, `${key} must be YYYY-MM-DD`);
    return body[key];
  },
};

// Drops undefined entries so only submitted fields are written.
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function insert(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => ':' + k).join(', ')})`;
  return Number(db.prepare(sql).run(row).lastInsertRowid);
}

function update(db, table, id, row, extraSet = '') {
  const keys = Object.keys(row);
  if (!keys.length && !extraSet) return;
  const sets = keys.map((k) => `${k} = :${k}`);
  if (extraSet) sets.push(extraSet);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = :id`).run({ ...row, id });
}

function audit(db, user, action, entity, entityId, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(user ? user.id : null, action, entity, entityId ?? null, detail ?? null);
}

module.exports = { HttpError, fail, field, defined, insert, update, audit };
