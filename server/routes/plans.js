'use strict';

const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const { ENUMS, tx } = require('../db');
const { requireRole } = require('../auth');
const { fail, field, defined, insert, update, audit } = require('../util');
const P = require('../plans');

const MAX_FILE_BYTES = 250 * 1024 * 1024;

const PLAN_LIST_SQL = `
  SELECT p.id, p.title, p.plan_number, p.is_template, p.category, p.building_type, p.discipline,
         p.status, p.sensitivity, p.floors, p.gross_area_sqft, p.tags, p.updated_at, p.source_plan_id,
         b.id AS building_id, b.name AS building_name, b.building_number,
         s.id AS site_id, s.name AS site_name,
         (SELECT label FROM plan_revisions r WHERE r.plan_id = p.id ORDER BY r.id DESC LIMIT 1) AS revision,
         (SELECT COUNT(*) FROM plan_files f WHERE f.revision_id =
            (SELECT id FROM plan_revisions r WHERE r.plan_id = p.id ORDER BY r.id DESC LIMIT 1)) AS file_count,
         (SELECT COUNT(*) FROM plans c WHERE c.source_plan_id = p.id) AS derived_count,
         (SELECT f.id FROM plan_files f WHERE f.mime_type IN ('image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif')
            AND f.revision_id = (SELECT id FROM plan_revisions r WHERE r.plan_id = p.id ORDER BY r.id DESC LIMIT 1)
            ORDER BY f.id LIMIT 1) AS thumb_file_id
  FROM plans p
  LEFT JOIN buildings b ON b.id = p.building_id
  LEFT JOIN sites s ON s.id = b.site_id`;

function readPlanBody(body, { creating }) {
  const sensitivity = field.oneOf(body, 'sensitivity', ENUMS.sensitivity);
  return defined({
    title: field.text(body, 'title', { required: creating, max: 200 }),
    plan_number: field.text(body, 'plan_number', { max: 60 }),
    category: field.text(body, 'category', { max: 100 }),
    building_type: field.oneOf(body, 'building_type', ENUMS.buildingTypes),
    discipline: field.oneOf(body, 'discipline', ENUMS.disciplines),
    status: field.oneOf(body, 'status', ENUMS.planStatus),
    sensitivity: sensitivity == null ? sensitivity : ENUMS.sensitivity.indexOf(sensitivity),
    description: field.text(body, 'description', { max: 10000 }),
    tags: field.text(body, 'tags', { max: 500 }),
    floors: field.int(body, 'floors', { max: 300 }),
    gross_area_sqft: field.int(body, 'gross_area_sqft'),
    construction_type: field.text(body, 'construction_type', { max: 100 }),
    building_id: field.int(body, 'building_id', { min: 1 }),
  });
}

module.exports = function plansRouter({ db, storage, tmpDir }) {
  const router = express.Router();
  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: MAX_FILE_BYTES, files: 50 },
    fileFilter: (_req, file, cb) => {
      if (P.fileType(file.originalname)) return cb(null, true);
      cb(Object.assign(new Error(`File type not allowed: ${file.originalname}`), { status: 400 }));
    },
  });

  function checkBuilding(id) {
    if (id && !db.prepare('SELECT 1 FROM buildings WHERE id = ?').get(id)) fail(400, 'Unknown building');
  }

  function checkClearance(user, level) {
    if (level != null && level > user.clearance) fail(403, 'You cannot assign a sensitivity above your own clearance');
  }

  router.get('/plans', (req, res) => {
    const q = req.query;
    const where = ['p.sensitivity <= :clearance'];
    const params = { clearance: req.user.clearance };
    if (q.template === '1' || q.template === '0') {
      where.push('p.is_template = :tpl');
      params.tpl = Number(q.template);
    }
    for (const [key, col] of [['discipline', 'p.discipline'], ['building_type', 'p.building_type'], ['status', 'p.status'], ['category', 'p.category']]) {
      if (q[key]) {
        where.push(`${col} = :${key}`);
        params[key] = String(q[key]);
      }
    }
    if (q.building_id) {
      where.push('p.building_id = :building_id');
      params.building_id = Number(q.building_id);
    }
    if (q.site_id) {
      where.push('b.site_id = :site_id');
      params.site_id = Number(q.site_id);
    }
    if (!q.status && q.include_archived !== '1') where.push("p.status <> 'archived'");
    if (q.q) {
      where.push(`(p.title LIKE :q OR p.plan_number LIKE :q OR p.description LIKE :q OR p.tags LIKE :q
                   OR p.category LIKE :q OR b.name LIKE :q OR b.building_number LIKE :q OR s.name LIKE :q)`);
      params.q = `%${String(q.q).trim()}%`;
    }
    const sort = q.sort === 'title' ? 'p.title COLLATE NOCASE' : 'p.updated_at DESC';
    const limit = Math.min(Number(q.limit) || 200, 500);
    res.json(db.prepare(`${PLAN_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ${limit}`).all(params));
  });

  router.get('/plans/:id', (req, res) => {
    const plan = P.getPlanOr404(db, req.user, req.params.id);
    const building = plan.building_id
      ? db.prepare(`SELECT b.*, s.name AS site_name FROM buildings b JOIN sites s ON s.id = b.site_id WHERE b.id = ?`).get(plan.building_id)
      : null;
    const revisions = db.prepare(`
      SELECT r.*, u.display_name AS author FROM plan_revisions r
      LEFT JOIN users u ON u.id = r.created_by WHERE r.plan_id = ? ORDER BY r.id DESC`).all(plan.id);
    const files = db.prepare(`
      SELECT f.id, f.revision_id, f.original_name, f.description, f.mime_type, f.size_bytes, f.uploaded_at
      FROM plan_files f JOIN plan_revisions r ON r.id = f.revision_id
      WHERE r.plan_id = ? ORDER BY f.original_name COLLATE NOCASE`).all(plan.id);
    for (const r of revisions) r.files = files.filter((f) => f.revision_id === r.id);

    // Walk up the lineage; plans above the user's clearance show as redacted.
    const ancestors = [];
    const seen = new Set([plan.id]);
    let cursor = plan;
    while (cursor.source_plan_id && !seen.has(cursor.source_plan_id)) {
      const parent = db.prepare('SELECT * FROM plans WHERE id = ?').get(cursor.source_plan_id);
      if (!parent) break;
      seen.add(parent.id);
      const rev = cursor.source_revision_id
        ? db.prepare('SELECT label FROM plan_revisions WHERE id = ?').get(cursor.source_revision_id)
        : null;
      ancestors.push(P.canSee(req.user, parent)
        ? { id: parent.id, title: parent.title, is_template: parent.is_template, from_revision: rev && rev.label }
        : { id: null, title: 'Restricted plan', is_template: parent.is_template, from_revision: null });
      cursor = parent;
    }
    const derived = db.prepare(`${PLAN_LIST_SQL} WHERE p.source_plan_id = ? AND p.sensitivity <= ? ORDER BY p.created_at DESC`)
      .all(plan.id, req.user.clearance);
    const work = db.prepare(`
      SELECT w.*, b.name AS building_name FROM work_records w JOIN buildings b ON b.id = w.building_id
      WHERE w.plan_id = ? ORDER BY COALESCE(w.start_date, w.created_at) DESC`).all(plan.id);
    const creator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(plan.created_by);

    res.json({ ...plan, created_by_name: creator && creator.display_name, building, revisions, ancestors, derived, work });
  });

  router.post('/plans', requireRole('editor'), (req, res) => {
    const row = readPlanBody(req.body, { creating: true });
    row.is_template = req.body.is_template ? 1 : 0;
    if (row.is_template) row.building_id = null;
    checkBuilding(row.building_id);
    checkClearance(req.user, row.sensitivity);
    const id = tx(db, () => {
      const planId = insert(db, 'plans', { ...row, created_by: req.user.id });
      insert(db, 'plan_revisions', { plan_id: planId, label: 'A', notes: field.text(req.body, 'revision_notes') || 'Initial issue', created_by: req.user.id });
      audit(db, req.user, 'create', 'plan', planId, row.title);
      return planId;
    });
    res.status(201).json({ id });
  });

  router.put('/plans/:id', requireRole('editor'), (req, res) => {
    const plan = P.getPlanOr404(db, req.user, req.params.id);
    const row = readPlanBody(req.body, { creating: false });
    if ('is_template' in req.body) row.is_template = req.body.is_template ? 1 : 0;
    if (row.title === null) fail(400, 'title is required');
    if ((row.is_template ?? plan.is_template) === 1) row.building_id = null;
    checkBuilding(row.building_id);
    checkClearance(req.user, row.sensitivity);
    update(db, 'plans', plan.id, row, "updated_at = datetime('now')");
    audit(db, req.user, 'update', 'plan', plan.id, Object.keys(row).join(', '));
    res.json({ id: plan.id });
  });

  // Start a new plan from this one (typically a template).
  router.post('/plans/:id/derive', requireRole('editor'), (req, res) => {
    const source = P.getPlanOr404(db, req.user, req.params.id);
    const overrides = defined({
      title: field.text(req.body, 'title', { required: true, max: 200 }),
      plan_number: field.text(req.body, 'plan_number', { max: 60 }),
      building_id: field.int(req.body, 'building_id', { min: 1 }) ?? null,
      is_template: 0,
      status: 'draft',
      category: source.is_template ? null : source.category,
    });
    checkBuilding(overrides.building_id);
    const srcRev = P.currentRevision(db, source.id);
    const id = tx(db, () => {
      const newId = P.clonePlan(db, req.user, source, overrides,
        `Started from ${source.is_template ? 'template' : 'plan'} "${source.title}"${srcRev ? ` rev ${srcRev.label}` : ''}`);
      audit(db, req.user, 'derive', 'plan', newId, `from plan ${source.id}`);
      return newId;
    });
    res.status(201).json({ id });
  });

  // Publish a snapshot of this plan into the template library.
  router.post('/plans/:id/save-as-template', requireRole('editor'), (req, res) => {
    const source = P.getPlanOr404(db, req.user, req.params.id);
    const overrides = defined({
      title: field.text(req.body, 'title', { required: true, max: 200 }),
      category: field.text(req.body, 'category', { max: 100 }) ?? source.building_type,
      description: field.text(req.body, 'description', { max: 10000 }),
      plan_number: null,
      building_id: null,
      is_template: 1,
      status: 'active',
    });
    const srcRev = P.currentRevision(db, source.id);
    const id = tx(db, () => {
      const newId = P.clonePlan(db, req.user, source, overrides,
        `Template created from "${source.title}"${srcRev ? ` rev ${srcRev.label}` : ''}`);
      audit(db, req.user, 'save-as-template', 'plan', newId, `from plan ${source.id}`);
      return newId;
    });
    res.status(201).json({ id });
  });

  router.post('/plans/:id/revisions', requireRole('editor'), (req, res) => {
    const plan = P.getPlanOr404(db, req.user, req.params.id);
    const notes = field.text(req.body, 'notes', { required: true, max: 5000 });
    const carryForward = req.body.carry_forward !== false;
    const revId = tx(db, () => {
      const id = P.addRevision(db, req.user, plan.id, notes, { carryForward });
      audit(db, req.user, 'revise', 'plan', plan.id, notes);
      return id;
    });
    res.status(201).json({ id: revId });
  });

  // Uploads always land in the current (latest) revision; older revisions are immutable.
  router.post('/plans/:id/files', requireRole('editor'), upload.array('files'), async (req, res, next) => {
    const cleanup = () => (req.files || []).forEach((f) => fs.rmSync(f.path, { force: true }));
    try {
      const plan = P.getPlanOr404(db, req.user, req.params.id);
      if (!req.files || !req.files.length) fail(400, 'No files uploaded');
      const rev = P.currentRevision(db, plan.id);
      const description = field.text(req.body, 'description', { max: 300 }) ?? null;
      const stored = [];
      for (const f of req.files) stored.push({ f, sha: await storage.putFile(f.path) });
      const ids = tx(db, () => {
        const out = stored.map(({ f, sha }) => insert(db, 'plan_files', {
          revision_id: rev.id,
          original_name: f.originalname.slice(0, 255),
          description,
          mime_type: P.fileType(f.originalname),
          size_bytes: f.size,
          sha256: sha,
          uploaded_by: req.user.id,
        }));
        db.prepare("UPDATE plans SET updated_at = datetime('now') WHERE id = ?").run(plan.id);
        audit(db, req.user, 'upload', 'plan', plan.id, req.files.map((f) => f.originalname).join(', '));
        return out;
      });
      res.status(201).json({ ids });
    } catch (err) {
      cleanup();
      next(err);
    }
  });

  router.delete('/plans/:id/files/:fileId', requireRole('editor'), (req, res) => {
    const plan = P.getPlanOr404(db, req.user, req.params.id);
    const rev = P.currentRevision(db, plan.id);
    const file = db.prepare('SELECT * FROM plan_files WHERE id = ? AND revision_id = ?').get(req.params.fileId, rev.id);
    if (!file) fail(404, 'File not found in the current revision (earlier revisions are read-only)');
    db.prepare('DELETE FROM plan_files WHERE id = ?').run(file.id);
    audit(db, req.user, 'remove-file', 'plan', plan.id, file.original_name);
    res.json({ ok: true });
  });

  router.get('/files/:id', (req, res) => {
    const file = db.prepare(`
      SELECT f.*, p.sensitivity FROM plan_files f
      JOIN plan_revisions r ON r.id = f.revision_id JOIN plans p ON p.id = r.plan_id
      WHERE f.id = ?`).get(req.params.id);
    if (!file || !P.canSee(req.user, file)) fail(404, 'File not found');
    const inline = P.INLINE_TYPES.has(file.mime_type) && req.query.download !== '1';
    res.set({
      'Content-Type': file.mime_type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    // Stops scripts in uploaded SVG/HTML-ish content from running in our
    // origin. Not applied to PDFs: browsers refuse to render them sandboxed.
    if (file.mime_type !== 'application/pdf') {
      res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    }
    res.attachment(file.original_name);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
    res.sendFile(storage.blobPath(file.sha256));
  });

  return router;
};
