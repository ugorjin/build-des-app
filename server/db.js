'use strict';

const { DatabaseSync } = require('node:sqlite');

// Enumerations shared by validation and the UI (served from /api/meta).
const ENUMS = {
  roles: ['viewer', 'editor', 'admin'],
  // Ordered: a user may see a plan when plan level <= user clearance.
  sensitivity: ['open', 'internal', 'restricted'],
  planStatus: ['draft', 'active', 'superseded', 'archived'],
  disciplines: [
    'Full set',
    'Architectural',
    'Structural',
    'Civil / Site',
    'Mechanical / HVAC',
    'Electrical',
    'Plumbing',
    'Fire protection',
    'Telecom / IT',
    'Security',
    'Landscape',
  ],
  buildingTypes: [
    'Administrative / Office',
    'Barracks / Housing',
    'Dining facility',
    'Hangar',
    'Vehicle maintenance',
    'Warehouse / Storage',
    'Training / Classroom',
    'Medical / Clinic',
    'Fitness / Recreation',
    'Utility plant',
    'Operations center',
    'Other',
  ],
  buildingStatus: ['planned', 'under construction', 'in service', 'under renovation', 'decommissioned'],
  workKinds: ['maintenance', 'renovation', 'repair', 'inspection', 'new construction'],
  workStatus: ['planned', 'in progress', 'completed', 'cancelled'],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  clearance     INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT,
  location    TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS buildings (
  id              INTEGER PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id),
  name            TEXT NOT NULL,
  building_number TEXT,
  building_type   TEXT,
  status          TEXT NOT NULL DEFAULT 'in service',
  year_built      INTEGER,
  floors          INTEGER,
  gross_area_sqft INTEGER,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id                  INTEGER PRIMARY KEY,
  title               TEXT NOT NULL,
  plan_number         TEXT,
  is_template         INTEGER NOT NULL DEFAULT 0,
  category            TEXT,
  building_type       TEXT,
  discipline          TEXT NOT NULL DEFAULT 'Full set',
  status              TEXT NOT NULL DEFAULT 'draft',
  sensitivity         INTEGER NOT NULL DEFAULT 1,
  description         TEXT,
  tags                TEXT,
  floors              INTEGER,
  gross_area_sqft     INTEGER,
  construction_type   TEXT,
  building_id         INTEGER REFERENCES buildings(id),
  source_plan_id      INTEGER REFERENCES plans(id),
  source_revision_id  INTEGER REFERENCES plan_revisions(id),
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS plans_building ON plans(building_id);
CREATE INDEX IF NOT EXISTS plans_source ON plans(source_plan_id);

CREATE TABLE IF NOT EXISTS plan_revisions (
  id          INTEGER PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES plans(id),
  label       TEXT NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (plan_id, label)
);

-- File rows point at content-addressed blobs, so cloning a plan or carrying
-- files into a new revision never duplicates bytes on disk.
CREATE TABLE IF NOT EXISTS plan_files (
  id            INTEGER PRIMARY KEY,
  revision_id   INTEGER NOT NULL REFERENCES plan_revisions(id),
  original_name TEXT NOT NULL,
  description   TEXT,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS plan_files_rev ON plan_files(revision_id);

CREATE TABLE IF NOT EXISTS work_records (
  id             INTEGER PRIMARY KEY,
  building_id    INTEGER NOT NULL REFERENCES buildings(id),
  plan_id        INTEGER REFERENCES plans(id),
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'planned',
  start_date     TEXT,
  completed_date TEXT,
  contractor     TEXT,
  cost           REAL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS work_building ON work_records(building_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  detail    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside a transaction; node:sqlite has no built-in helper.
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx, ENUMS };
