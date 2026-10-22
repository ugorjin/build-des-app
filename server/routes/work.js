'use strict';

const express = require('express');
const { ENUMS } = require('../db');
const { requireRole } = require('../auth');
const { fail, field, defined, insert, update, audit } = require('../util');
const { canSee } = require('../plans');

function readWork(body, creating) {
  return defined({
    building_id: field.int(body, 'building_id', { min: 1 }),
    plan_id: field.int(body, 'plan_id', { min: 1 }),
    kind: field.oneOf(body, 'kind', ENUMS.workKinds, { required: creating }),
    title: field.text(body, 'title', { required: creating, max: 200 }),
    description: field.text(body, 'description', { max: 10000 }),
    status: field.oneOf(body, 'status', ENUMS.workStatus),
    start_date: field.date(body, 'start_date'),
    completed_date: field.date(body, 'completed_date'),
    contractor: field.text(body, 'contractor', { max: 200 }),
    cost: field.num(body, 'cost'),
  });
}

module.exports = function workRouter({ db }) {
  const router = express.Router();

  function checkRefs(user, row, buildingId) {
    if (row.building_id !== undefined && !db.prepare('SELECT 1 FROM buildings WHERE id = ?').get(row.building_id)) {
      fail(400, 'Unknown building');
    }
    if (row.plan_id) {
      const plan = db.prepare('SELECT id, building_id, sensitivity FROM plans WHERE id = ?').get(row.plan_id);
      if (!plan || !canSee(user, plan)) fail(400, 'Unknown plan');
      if (plan.building_id && plan.building_id !== buildingId) fail(400, 'That plan belongs to a different building');
    }
  }

  router.get('/work', (req, res) => {
    const where = [];
    const params = { c: req.user.clearance };
    if (req.query.building_id) {
      where.push('w.building_id = :building_id');
      params.building_id = Number(req.query.building_id);
    }
    if (req.query.status === 'open') where.push("w.status IN ('planned', 'in progress')");
    else if (req.query.status) {
      where.push('w.status = :status');
      params.status = String(req.query.status);
    }
    if (req.query.kind) {
      where.push('w.kind = :kind');
      params.kind = String(req.query.kind);
    }
    res.json(db.prepare(`
      SELECT w.*, b.name AS building_name, b.building_number, s.name AS site_name, p.title AS plan_title
      FROM work_records w
      JOIN buildings b ON b.id = w.building_id JOIN sites s ON s.id = b.site_id
      LEFT JOIN plans p ON p.id = w.plan_id AND p.sensitivity <= :c
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(w.start_date, w.created_at) DESC LIMIT 500`).all(params));
  });

  router.post('/work', requireRole('editor'), (req, res) => {
    const row = readWork(req.body, true);
    if (!row.building_id) fail(400, 'building_id is required');
    checkRefs(req.user, row, row.building_id);
    const id = insert(db, 'work_records', { ...row, created_by: req.user.id });
    audit(db, req.user, 'create', 'work', id, row.title);
    res.status(201).json({ id });
  });

  router.put('/work/:id', requireRole('editor'), (req, res) => {
    const existing = db.prepare('SELECT * FROM work_records WHERE id = ?').get(req.params.id);
    if (!existing) fail(404, 'Work record not found');
    const row = readWork(req.body, false);
    if (row.title === null) fail(400, 'title is required');
    if (row.building_id === null) fail(400, 'building_id is required');
    checkRefs(req.user, row, row.building_id ?? existing.building_id);
    if (row.status === 'completed' && !existing.completed_date && row.completed_date === undefined) {
      row.completed_date = new Date().toISOString().slice(0, 10);
    }
    update(db, 'work_records', existing.id, row);
    audit(db, req.user, 'update', 'work', existing.id, row.status ? `status: ${row.status}` : null);
    res.json({ id: existing.id });
  });

  return router;
};
