'use strict';

const path = require('node:path');
const { fail, insert } = require('./util');

// Extension -> served content type. Anything else is rejected at upload.
const FILE_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.dwg': 'application/acad',
  '.dxf': 'image/vnd.dxf',
  '.dwf': 'model/vnd.dwf',
  '.ifc': 'application/x-step',
  '.rvt': 'application/octet-stream',
  '.skp': 'application/octet-stream',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};
// Types safe to show inline in the browser (SVG is additionally sandboxed).
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'text/plain']);

function fileType(name) {
  return FILE_TYPES[path.extname(name).toLowerCase()] || null;
}

// A, B, ... Z, AA, AB, ...
function revisionLabel(index) {
  let label = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    label = String.fromCharCode(65 + r) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function canSee(user, plan) {
  return plan && plan.sensitivity <= user.clearance;
}

function getPlanOr404(db, user, id) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!plan || !canSee(user, plan)) fail(404, 'Plan not found');
  return plan;
}

function currentRevision(db, planId) {
  return db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY id DESC LIMIT 1').get(planId);
}

function addRevision(db, user, planId, notes, { carryForward = true } = {}) {
  const prev = currentRevision(db, planId);
  const count = db.prepare('SELECT COUNT(*) AS n FROM plan_revisions WHERE plan_id = ?').get(planId).n;
  const revId = insert(db, 'plan_revisions', {
    plan_id: planId,
    label: revisionLabel(count),
    notes: notes || null,
    created_by: user.id,
  });
  if (prev && carryForward) copyFiles(db, prev.id, revId);
  db.prepare("UPDATE plans SET updated_at = datetime('now') WHERE id = ?").run(planId);
  return revId;
}

function copyFiles(db, fromRevisionId, toRevisionId) {
  db.prepare(`
    INSERT INTO plan_files (revision_id, original_name, description, mime_type, size_bytes, sha256, uploaded_by, uploaded_at)
    SELECT ?, original_name, description, mime_type, size_bytes, sha256, uploaded_by, uploaded_at
    FROM plan_files WHERE revision_id = ?`).run(toRevisionId, fromRevisionId);
}

const COPIED_FIELDS = [
  'title', 'plan_number', 'category', 'building_type', 'discipline', 'sensitivity',
  'description', 'tags', 'floors', 'gross_area_sqft', 'construction_type',
];

// Creates a new plan whose first revision starts from the source plan's
// current revision. Used both for "use template as base" and for
// "save plan as template"; lineage is kept via source_plan_id.
function clonePlan(db, user, source, overrides, note) {
  const srcRev = currentRevision(db, source.id);
  const row = {};
  for (const k of COPIED_FIELDS) row[k] = source[k];
  Object.assign(row, overrides, {
    source_plan_id: source.id,
    source_revision_id: srcRev ? srcRev.id : null,
    created_by: user.id,
  });
  const id = insert(db, 'plans', row);
  const revId = insert(db, 'plan_revisions', { plan_id: id, label: 'A', notes: note, created_by: user.id });
  if (srcRev) copyFiles(db, srcRev.id, revId);
  return id;
}

module.exports = {
  FILE_TYPES,
  INLINE_TYPES,
  fileType,
  revisionLabel,
  canSee,
  getPlanOr404,
  currentRevision,
  addRevision,
  clonePlan,
};
