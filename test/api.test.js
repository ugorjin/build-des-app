'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const { seedDemo } = require('../server/seed');
const { createStorage } = require('../server/storage');

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planvault-test-'));
  const app = createApp({ dataDir });
  seedDemo(app.locals.db, createStorage(path.join(dataDir, 'files')));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(username) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}-demo-pass` }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (pathname, { method = 'GET', body, form } = {}) => {
    const headers = { cookie };
    let payload = form;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(`${base}${pathname}`, { method, headers, body: payload });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: type.includes('json') ? await r.json() : await r.text() };
  };
}

test('requires sign in', async () => {
  const res = await fetch(`${base}/plans`);
  assert.equal(res.status, 401);
});

test('rejects bad credentials', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }),
  });
  assert.equal(res.status, 401);
});

test('template -> new plan -> revision -> save as template keeps lineage and files', async () => {
  const api = await login('editor');
  const templates = (await api('/plans?template=1')).data;
  assert.ok(templates.length >= 4);
  const tpl = templates.find((t) => t.plan_number === 'TPL-UH-096');

  const derived = await api(`/plans/${tpl.id}/derive`, { method: 'POST', body: { title: 'Barracks 1305 — Design', building_id: 1 } });
  assert.equal(derived.status, 201);
  let plan = (await api(`/plans/${derived.data.id}`)).data;
  assert.equal(plan.is_template, 0);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.source_plan_id, tpl.id);
  assert.equal(plan.revisions.length, 1);
  assert.equal(plan.revisions[0].files.length, 1, 'template drawings are copied');
  assert.deepEqual(plan.ancestors.map((a) => a.id), [tpl.id]);

  // Upload into the current revision, then issue revision B.
  const form = new FormData();
  form.append('files', new Blob(['%PDF-1.4 test']), 'E-101.pdf');
  form.append('description', 'Electrical plan');
  assert.equal((await api(`/plans/${plan.id}/files`, { method: 'POST', form })).status, 201);
  const rev = await api(`/plans/${plan.id}/revisions`, { method: 'POST', body: { notes: 'Site adaptation' } });
  assert.equal(rev.status, 201);
  plan = (await api(`/plans/${plan.id}`)).data;
  assert.deepEqual(plan.revisions.map((r) => r.label), ['B', 'A']);
  assert.equal(plan.revisions[0].files.length, 2, 'files carried forward');

  // Removing from the current revision leaves history intact.
  const pdfB = plan.revisions[0].files.find((f) => f.original_name === 'E-101.pdf');
  const pdfA = plan.revisions[1].files.find((f) => f.original_name === 'E-101.pdf');
  assert.equal((await api(`/plans/${plan.id}/files/${pdfB.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/plans/${plan.id}/files/${pdfA.id}`, { method: 'DELETE' })).status, 404, 'old revisions are read-only');
  const download = await api(`/files/${pdfA.id}`);
  assert.equal(download.status, 200);
  assert.equal(download.data, '%PDF-1.4 test');

  const t2 = await api(`/plans/${plan.id}/save-as-template`, { method: 'POST', body: { title: 'Barracks — Coastal variant' } });
  assert.equal(t2.status, 201);
  const newTpl = (await api(`/plans/${t2.data.id}`)).data;
  assert.equal(newTpl.is_template, 1);
  assert.equal(newTpl.building_id, null);
  assert.equal(newTpl.category, 'Barracks / Housing');
  assert.deepEqual(newTpl.ancestors.map((a) => a.id), [plan.id, tpl.id]);
  const source = (await api(`/plans/${plan.id}`)).data;
  assert.deepEqual(source.derived.map((d) => d.id), [newTpl.id]);
});

test('rejects disallowed upload types', async () => {
  const api = await login('editor');
  const form = new FormData();
  form.append('files', new Blob(['<script>']), 'evil.html');
  const res = await api('/plans/1/files', { method: 'POST', form });
  assert.equal(res.status, 400);
});

test('uploaded SVG is served sandboxed', async () => {
  const api = await login('admin');
  const plan = (await api('/plans/1')).data;
  const file = plan.revisions[0].files[0];
  const res = await api(`/files/${file.id}`);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('viewers can read but not write', async () => {
  const api = await login('viewer');
  assert.equal((await api('/plans')).status, 200);
  assert.equal((await api('/plans', { method: 'POST', body: { title: 'x' } })).status, 403);
  assert.equal((await api('/plans/1/derive', { method: 'POST', body: { title: 'x' } })).status, 403);
  assert.equal((await api('/users')).status, 403);
});

test('plans above a user clearance are hidden everywhere', async () => {
  const admin = await login('admin');
  const restricted = (await admin('/plans?q=one-line')).data;
  assert.equal(restricted.length, 1);
  const id = restricted[0].id;
  const fileForm = new FormData();
  fileForm.append('files', new Blob(['secret']), 'oneline.pdf');
  const up = await admin(`/plans/${id}/files`, { method: 'POST', form: fileForm });
  const fileId = up.data.ids[0];

  const editor = await login('editor'); // clearance 1 (internal)
  assert.equal((await editor('/plans?q=one-line')).data.length, 0);
  assert.equal((await editor(`/plans/${id}`)).status, 404);
  assert.equal((await editor(`/files/${fileId}`)).status, 404);
  assert.equal((await editor(`/plans/${id}/derive`, { method: 'POST', body: { title: 'x' } })).status, 404);
  const building = (await editor(`/buildings/${restricted[0].building_id}`)).data;
  assert.ok(!building.plans.some((p) => p.id === id));
  // Editors cannot mark plans above their own clearance.
  const create = await editor('/plans', { method: 'POST', body: { title: 'Secret', sensitivity: 'restricted' } });
  assert.equal(create.status, 403);

  const viewer = await login('viewer'); // clearance 0 (open): sees templates only
  const visible = (await viewer('/plans')).data;
  assert.ok(visible.length > 0 && visible.every((p) => p.sensitivity === 0));
});

test('work records link buildings and plans', async () => {
  const api = await login('editor');
  const bad = await api('/work', { method: 'POST', body: { building_id: 1, plan_id: 7, kind: 'repair', title: 'x' } });
  assert.equal(bad.status, 400, 'plan from another building is rejected');
  const ok = await api('/work', { method: 'POST', body: { building_id: 1, plan_id: 5, kind: 'repair', title: 'Replace door closers', cost: 900 } });
  assert.equal(ok.status, 201);
  const done = await api(`/work/${ok.data.id}`, { method: 'PUT', body: { status: 'completed' } });
  assert.equal(done.status, 200);
  const building = (await api('/buildings/1')).data;
  const rec = building.work.find((w) => w.id === ok.data.id);
  assert.equal(rec.status, 'completed');
  assert.ok(rec.completed_date, 'completion date is filled in automatically');
  assert.equal(rec.plan_title, 'Barracks 1201 — As-built');
});

test('admin manages users and sees the audit log', async () => {
  const api = await login('admin');
  const created = await api('/users', { method: 'POST', body: { username: 'new.tech', display_name: 'New Tech', role: 'viewer', clearance: 1, password: 'long-enough-pw' } });
  assert.equal(created.status, 201);
  assert.equal((await api('/users', { method: 'POST', body: { username: 'short', display_name: 'S', role: 'viewer', password: 'x' } })).status, 400);
  const self = (await api('/auth/me')).data;
  assert.equal((await api(`/users/${self.id}`, { method: 'PUT', body: { role: 'viewer' } })).status, 400);
  const log = (await api('/audit')).data;
  assert.ok(log.some((a) => a.action === 'derive'));
});
