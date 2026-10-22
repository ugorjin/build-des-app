import { api, html, $, $$, fmtDate, fmtNum, fmtMoney, formDialog } from '../lib.js';
import {
  state, canEdit, go, statusBadge, sensitivityBadge, newPlanDialog, deriveDialog, workDialog, invalidateBuildings,
} from '../common.js';

const siteFields = (s = {}) => [
  { name: 'name', label: 'Name', required: true, value: s.name, full: true, placeholder: 'e.g. Fort Example' },
  { name: 'code', label: 'Code', value: s.code, placeholder: 'e.g. FTEX' },
  { name: 'location', label: 'Location', value: s.location },
  { name: 'description', label: 'Description', type: 'textarea', value: s.description },
];

const buildingFields = (b = {}, sites = []) => {
  const m = state.meta;
  return [
    { name: 'name', label: 'Name', required: true, value: b.name, full: true },
    { name: 'building_number', label: 'Building number', value: b.building_number },
    { name: 'site_id', label: 'Site', type: 'select', required: true, options: sites.map((s) => [s.id, s.name]), value: b.site_id },
    { name: 'building_type', label: 'Type', type: 'select', options: m.buildingTypes, value: b.building_type },
    { name: 'status', label: 'Status', type: 'select', options: m.buildingStatus, required: true, value: b.status || 'in service' },
    { name: 'year_built', label: 'Year built', type: 'number', value: b.year_built },
    { name: 'floors', label: 'Floors', type: 'number', value: b.floors },
    { name: 'gross_area_sqft', label: 'Gross area (sq ft)', type: 'number', value: b.gross_area_sqft },
    { name: 'notes', label: 'Notes', type: 'textarea', value: b.notes },
  ];
};

export async function sitesView({ main, isCurrent }) {
  const sites = await api('/sites');
  if (!isCurrent()) return;
  main.innerHTML = html`
    <header class="page-head">
      <div><h1>Sites & buildings</h1><p class="muted">Installations, campuses or properties, and the buildings on each.</p></div>
      ${canEdit() ? html`<div class="actions"><button class="btn primary" data-new>+ New site</button></div>` : ''}
    </header>
    ${sites.length ? html`<div class="grid sites">${sites.map((s) => html`<a class="card site-card" href="#/sites/${s.id}">
      <h2>${s.name}${s.code ? html` <span class="muted">${s.code}</span>` : ''}</h2>
      <p class="muted">${s.location || ''}</p>
      <strong>${s.building_count} building${s.building_count === 1 ? '' : 's'}</strong></a>`)}</div>`
      : html`<div class="empty-state"><p>No sites yet. Add your first installation or campus to start organizing buildings.</p></div>`}`.s;
  $('[data-new]', main)?.addEventListener('click', async () => {
    const id = await formDialog({ title: 'New site', fields: siteFields(), onSubmit: async (v) => (await api('/sites', { method: 'POST', body: v })).id });
    if (id) go(`#/sites/${id}`);
  });
}

export async function siteView({ main, params, refresh, isCurrent }) {
  const [site, sites] = await Promise.all([api(`/sites/${params[0]}`), api('/sites')]);
  if (!isCurrent()) return;
  main.innerHTML = html`
    <nav class="crumbs"><a href="#/sites">Sites</a></nav>
    <header class="page-head">
      <div><h1>${site.name}${site.code ? html` <span class="muted">${site.code}</span>` : ''}</h1>
        <p class="muted">${site.location || ''}${site.description ? ` · ${site.description}` : ''}</p></div>
      ${canEdit() ? html`<div class="actions"><button class="btn primary" data-act="building">+ New building</button><button class="btn" data-act="edit">Edit site</button></div>` : ''}
    </header>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Bldg #</th><th>Name</th><th>Type</th><th>Status</th><th>Built</th><th>Area</th><th>Plans</th><th>Open work</th></tr></thead>
      <tbody>${site.buildings.length ? site.buildings.map((b) => html`<tr>
        <td>${b.building_number || '—'}</td><td><a href="#/buildings/${b.id}"><strong>${b.name}</strong></a></td>
        <td>${b.building_type || '—'}</td><td>${statusBadge(b.status)}</td><td>${b.year_built || '—'}</td>
        <td>${b.gross_area_sqft ? `${fmtNum(b.gross_area_sqft)} sf` : '—'}</td><td>${b.plan_count}</td><td>${b.open_work || ''}</td></tr>`)
        : html`<tr><td colspan="8" class="muted">No buildings at this site yet.</td></tr>`}</tbody>
    </table></div>`.s;
  $('[data-act=edit]', main)?.addEventListener('click', async () => {
    const ok = await formDialog({ title: 'Edit site', fields: siteFields(site), onSubmit: (v) => api(`/sites/${site.id}`, { method: 'PUT', body: v }) });
    if (ok) refresh();
  });
  $('[data-act=building]', main)?.addEventListener('click', async () => {
    const id = await formDialog({
      title: 'New building', wide: true, fields: buildingFields({ site_id: site.id }, sites),
      onSubmit: async (v) => (await api('/buildings', { method: 'POST', body: v })).id,
    });
    if (id) { invalidateBuildings(); go(`#/buildings/${id}`); }
  });
}

export async function buildingView({ main, params, refresh, isCurrent }) {
  const [b, sites] = await Promise.all([api(`/buildings/${params[0]}`), api('/sites')]);
  if (!isCurrent()) return;
  const edit = canEdit();
  const active = b.plans.filter((p) => p.status !== 'archived');
  const byDiscipline = {};
  for (const p of b.plans) (byDiscipline[p.discipline] ||= []).push(p);
  const openWork = b.work.filter((w) => ['planned', 'in progress'].includes(w.status));
  const spent = b.work.filter((w) => w.status === 'completed').reduce((sum, w) => sum + (w.cost || 0), 0);

  main.innerHTML = html`
    <nav class="crumbs"><a href="#/sites">Sites</a> / <a href="#/sites/${b.site_id}">${b.site_name}</a></nav>
    <header class="page-head">
      <div><h1>${b.name}</h1>
        <div class="badges">${statusBadge(b.status)} <span class="muted">${b.building_number ? `Bldg ${b.building_number} · ` : ''}${b.building_type || ''}</span></div></div>
      ${edit ? html`<div class="actions">
        <button class="btn primary" data-act="work">Log maintenance / renovation</button>
        <button class="btn" data-act="from-template">Add plan from template</button>
        <button class="btn" data-act="new-plan">Upload plan</button>
        <button class="btn" data-act="edit">Edit</button></div>` : ''}
    </header>
    <section class="stats small">
      <div class="stat"><strong>${b.year_built || '—'}</strong><span>Year built</span></div>
      <div class="stat"><strong>${b.floors ?? '—'}</strong><span>Floors</span></div>
      <div class="stat"><strong>${b.gross_area_sqft ? fmtNum(b.gross_area_sqft) : '—'}</strong><span>Gross sq ft</span></div>
      <div class="stat"><strong>${active.length}</strong><span>Plans on file</span></div>
      <div class="stat"><strong>${openWork.length}</strong><span>Open work</span></div>
      <div class="stat"><strong>${fmtMoney(spent)}</strong><span>Completed work cost</span></div>
    </section>
    ${b.notes ? html`<section class="card"><h2>Notes</h2><p class="prose">${b.notes}</p></section>` : ''}
    <div class="cols">
      <section class="card">
        <h2>Plans on file</h2>
        ${b.plans.length ? Object.entries(byDiscipline).map(([d, plans]) => html`<h3>${d}</h3><ul class="list">${plans.map((p) => html`<li>
          <a href="#/plans/${p.id}"><strong>${p.title}</strong></a> ${statusBadge(p.status)} ${p.sensitivity > 0 ? sensitivityBadge(p.sensitivity) : ''}
          <div class="muted small">Rev ${p.revision} · ${fmtDate(p.updated_at)}${p.source_title ? html` · from ${p.source_is_template ? 'template' : ''} <a href="#/plans/${p.source_plan_id}">${p.source_title}</a>` : ''}</div></li>`)}</ul>`)
          : html`<p class="muted">No plans on file for this building.${edit ? ' Upload the existing drawings, or start from a template.' : ''}</p>`}
      </section>
      <section class="card">
        <h2>Maintenance & renovation history</h2>
        ${b.work.length ? html`<ul class="list">${b.work.map((w) => html`<li>
          <div class="row-between"><strong>${w.title}</strong>${edit ? html`<button class="link" data-edit-work="${w.id}">Edit</button>` : ''}</div>
          <div>${statusBadge(w.status)} <span class="muted small">${w.kind} · ${fmtDate(w.start_date)}${w.completed_date ? ` → ${fmtDate(w.completed_date)}` : ''}${w.contractor ? ` · ${w.contractor}` : ''}${w.cost ? ` · ${fmtMoney(w.cost)}` : ''}</span></div>
          ${w.plan_title ? html`<div class="small">Drawings: <a href="#/plans/${w.plan_id}">${w.plan_title}</a></div>` : ''}
          ${w.description ? html`<div class="muted small">${w.description}</div>` : ''}</li>`)}</ul>`
          : html`<p class="muted">No work recorded yet.</p>`}
      </section>
    </div>`.s;
  if (!edit) return;

  const act = (name, fn) => $(`[data-act=${name}]`, main).addEventListener('click', fn);
  act('edit', async () => {
    const ok = await formDialog({ title: 'Edit building', wide: true, fields: buildingFields(b, sites), onSubmit: (v) => api(`/buildings/${b.id}`, { method: 'PUT', body: v }) });
    if (ok) { invalidateBuildings(); refresh(); }
  });
  act('work', async () => { if (await workDialog({ building_id: b.id, plans: active })) refresh(); });
  act('new-plan', async () => {
    const id = await newPlanDialog({ building_id: b.id });
    if (id) go(`#/plans/${id}`);
  });
  act('from-template', async () => {
    const templates = await api('/plans?template=1&sort=title');
    if (!templates.length) {
      await formDialog({ title: 'No templates yet', intro: 'Publish a plan as a template, or create one from the Template library first.', fields: [], submitLabel: 'OK', onSubmit: () => true });
      return;
    }
    // Templates matching this building's type are listed first.
    const sorted = [...templates].sort((x, y) => (y.building_type === b.building_type) - (x.building_type === b.building_type));
    const choice = await formDialog({
      title: 'Choose a template',
      fields: [{ name: 'template', label: 'Template', type: 'select', required: true, full: true,
        options: sorted.map((t) => [t.id, `${t.title}${t.building_type === b.building_type ? ' ★' : ''}`]),
        hint: '★ matches this building\'s type' }],
      submitLabel: 'Next',
      onSubmit: (v) => templates.find((t) => t.id === Number(v.template)),
    });
    if (!choice) return;
    const id = await deriveDialog(choice, { building_id: b.id });
    if (id) go(`#/plans/${id}`);
  });
  $$('[data-edit-work]', main).forEach((btn) => btn.addEventListener('click', async () => {
    const record = b.work.find((w) => w.id === Number(btn.dataset.editWork));
    if (await workDialog({ record, building_id: b.id, plans: active })) refresh();
  }));
}
