'use strict';

const express = require('express');
const { ENUMS } = require('../db');
const { requireRole } = require('../auth');
const { fail, field, defined, insert, update, audit } = require('../util');

function readSite(body, creating) {
  return defined({
    name: field.text(body, 'name', { required: creating, max: 200 }),
    code: field.text(body, 'code', { max: 40 }),
    location: field.text(body, 'location', { max: 300 }),
    description: field.text(body, 'description', { max: 5000 }),
  });
}

function readBuilding(body, creating) {
  return defined({
    site_id: field.int(body, 'site_id', { min: 1 }),
    name: field.text(body, 'name', { required: creating, max: 200 }),
    building_number: field.text(body, 'building_number', { max: 40 }),
    building_type: field.oneOf(body, 'building_type', ENUMS.buildingTypes),
    status: field.oneOf(body, 'status', ENUMS.buildingStatus),
    year_built: field.int(body, 'year_built', { min: 1700, max: 2200 }),
    floors: field.int(body, 'floors', { max: 300 }),
    gross_area_sqft: field.int(body, 'gross_area_sqft'),
    notes: field.text(body, 'notes', { max: 10000 }),
  });
}

module.exports = function facilitiesRouter({ db }) {
  const router = express.Router();

  const siteOr404 = (id) => db.prepare('SELECT * FROM sites WHERE id = ?').get(id) || fail(404, 'Site not found');
  const buildingOr404 = (id) =>
    db.prepare('SELECT b.*, s.name AS site_name FROM buildings b JOIN sites s ON s.id = b.site_id WHERE b.id = ?').get(id)
    || fail(404, 'Building not found');

  router.get('/sites', (_req, res) => {
    res.json(db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM buildings b WHERE b.site_id = s.id) AS building_count
      FROM sites s ORDER BY s.name COLLATE NOCASE`).all());
  });

  router.get('/sites/:id', (req, res) => {
    const site = siteOr404(req.params.id);
    site.buildings = db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM plans p WHERE p.building_id = b.id AND p.status <> 'archived' AND p.sensitivity <= ?) AS plan_count,
        (SELECT COUNT(*) FROM work_records w WHERE w.building_id = b.id AND w.status IN ('planned', 'in progress')) AS open_work
      FROM buildings b WHERE b.site_id = ? ORDER BY b.building_number, b.name COLLATE NOCASE`).all(req.user.clearance, site.id);
    res.json(site);
  });

  router.post('/sites', requireRole('editor'), (req, res) => {
    const row = readSite(req.body, true);
    const id = insert(db, 'sites', row);
    audit(db, req.user, 'create', 'site', id, row.name);
    res.status(201).json({ id });
  });

  router.put('/sites/:id', requireRole('editor'), (req, res) => {
    const site = siteOr404(req.params.id);
    const row = readSite(req.body, false);
    if (row.name === null) fail(400, 'name is required');
    update(db, 'sites', site.id, row);
    audit(db, req.user, 'update', 'site', site.id);
    res.json({ id: site.id });
  });

  router.get('/buildings', (req, res) => {
    const params = [];
    let where = '';
    if (req.query.site_id) {
      where = 'WHERE b.site_id = ?';
      params.push(Number(req.query.site_id));
    }
    res.json(db.prepare(`
      SELECT b.id, b.name, b.building_number, b.building_type, b.status, b.site_id, s.name AS site_name
      FROM buildings b JOIN sites s ON s.id = b.site_id ${where}
      ORDER BY s.name COLLATE NOCASE, b.building_number, b.name COLLATE NOCASE`).all(...params));
  });

  router.get('/buildings/:id', (req, res) => {
    const building = buildingOr404(req.params.id);
    building.plans = db.prepare(`
      SELECT p.id, p.title, p.plan_number, p.discipline, p.status, p.sensitivity, p.updated_at, p.source_plan_id,
        (SELECT label FROM plan_revisions r WHERE r.plan_id = p.id ORDER BY r.id DESC LIMIT 1) AS revision,
        src.title AS source_title, src.is_template AS source_is_template
      FROM plans p LEFT JOIN plans src ON src.id = p.source_plan_id AND src.sensitivity <= :c
      WHERE p.building_id = :b AND p.sensitivity <= :c
      ORDER BY p.discipline, p.title COLLATE NOCASE`).all({ b: building.id, c: req.user.clearance });
    building.work = db.prepare(`
      SELECT w.*, p.title AS plan_title, u.display_name AS created_by_name
      FROM work_records w
      LEFT JOIN plans p ON p.id = w.plan_id AND p.sensitivity <= ?
      LEFT JOIN users u ON u.id = w.created_by
      WHERE w.building_id = ? ORDER BY COALESCE(w.start_date, w.created_at) DESC`).all(req.user.clearance, building.id);
    res.json(building);
  });

  router.post('/buildings', requireRole('editor'), (req, res) => {
    const row = readBuilding(req.body, true);
    if (!row.site_id) fail(400, 'site_id is required');
    siteOr404(row.site_id);
    const id = insert(db, 'buildings', row);
    audit(db, req.user, 'create', 'building', id, row.name);
    res.status(201).json({ id });
  });

  router.put('/buildings/:id', requireRole('editor'), (req, res) => {
    const building = buildingOr404(req.params.id);
    const row = readBuilding(req.body, false);
    if (row.name === null) fail(400, 'name is required');
    if (row.site_id === null) fail(400, 'site_id is required');
    if (row.site_id) siteOr404(row.site_id);
    update(db, 'buildings', building.id, row);
    audit(db, req.user, 'update', 'building', building.id);
    res.json({ id: building.id });
  });

  return router;
};
