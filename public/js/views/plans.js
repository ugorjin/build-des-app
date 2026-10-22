import { api, html, $, $$, fmtDate, fmtNum, fmtBytes, formDialog, confirmDialog, openViewer, toast } from '../lib.js';
import {
  state, canEdit, go, sensitivityBadge, statusBadge, templateBadge, thumb, planFields, buildingOptions,
  newPlanDialog, deriveDialog, saveAsTemplateDialog, workDialog, sendFiles, SENSITIVITY_LABELS,
} from '../common.js';

// ---------- Template library ----------

export async function templatesView({ main, query, isCurrent }) {
  const all = await api('/plans?template=1&sort=title');
  if (!isCurrent()) return;
  const categories = [...new Set(all.map((t) => t.category || 'Uncategorized'))].sort();
  let active = query.get('category') || '';
  let q = '';

  main.innerHTML = html`
    <header class="page-head">
      <div><h1>Template library</h1><p class="muted">Proven designs to use as the starting point for new buildings. Any plan can be published here.</p></div>
      ${canEdit() ? html`<div class="actions"><button class="btn primary" data-new>+ New template</button></div>` : ''}
    </header>
    <div class="toolbar">
      <input type="search" placeholder="Filter templates…" data-q aria-label="Filter templates">
      <div class="chips">
        <button class="chip" data-cat="">All</button>
        ${categories.map((c) => html`<button class="chip" data-cat="${c}">${c}</button>`)}
      </div>
    </div>
    <div class="grid cards" data-grid></div>`.s;

  const draw = () => {
    const needle = q.toLowerCase();
    const items = all.filter((t) => (!active || (t.category || 'Uncategorized') === active)
      && (!needle || [t.title, t.plan_number, t.tags, t.category].some((s) => s && s.toLowerCase().includes(needle))));
    $$('[data-cat]', main).forEach((b) => b.classList.toggle('on', b.dataset.cat === active));
    $('[data-grid]', main).innerHTML = (items.length ? html`${items.map((t) => html`
      <article class="tpl-card">
        <a href="#/plans/${t.id}">${thumb(t.thumb_file_id, t.title)}</a>
        <div class="tpl-body">
          <a href="#/plans/${t.id}"><strong>${t.title}</strong></a>
          <span class="muted small">${t.category || ''}${t.plan_number ? ` · ${t.plan_number}` : ''}</span>
          <span class="muted small">${t.floors ? `${t.floors} floor${t.floors > 1 ? 's' : ''} · ` : ''}${t.gross_area_sqft ? `${fmtNum(t.gross_area_sqft)} sf · ` : ''}${t.file_count} file${t.file_count === 1 ? '' : 's'} · used ${t.derived_count}×</span>
          ${canEdit() ? html`<button class="btn sm primary" data-use="${t.id}">Use as base</button>` : ''}
        </div>
      </article>`)}` : html`<p class="muted">No templates match.</p>`).s;
    $$('[data-use]', main).forEach((b) => b.addEventListener('click', async () => {
      const id = await deriveDialog(all.find((t) => t.id === Number(b.dataset.use)));
      if (id) go(`#/plans/${id}`);
    }));
  };
  $$('[data-cat]', main).forEach((b) => b.addEventListener('click', () => { active = b.dataset.cat; draw(); }));
  $('[data-q]', main).addEventListener('input', (e) => { q = e.target.value; draw(); });
  $('[data-new]', main)?.addEventListener('click', async () => {
    const id = await newPlanDialog({ is_template: true });
    if (id) go(`#/plans/${id}`);
  });
  draw();
}

// ---------- Plan search ----------

export async function plansView({ main, query, isCurrent }) {
  const m = state.meta;
  const sites = await api('/sites');
  if (!isCurrent()) return;
  const filters = { q: query.get('q') || '', template: '', discipline: '', building_type: '', status: '', site_id: '' };

  main.innerHTML = html`
    <header class="page-head">
      <div><h1>All plans</h1><p class="muted">Every drawing set on file — as-builts, designs in progress and templates.</p></div>
      ${canEdit() ? html`<div class="actions"><button class="btn primary" data-new>+ New plan</button></div>` : ''}
    </header>
    <form class="filters" data-filters>
      <input type="search" name="q" placeholder="Search title, number, building, tags…" value="${filters.q}" aria-label="Search">
      <select name="template" aria-label="Kind"><option value="">Plans & templates</option><option value="0">Building plans</option><option value="1">Templates</option></select>
      <select name="site_id" aria-label="Site"><option value="">All sites</option>${sites.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
      <select name="discipline" aria-label="Discipline"><option value="">All disciplines</option>${m.disciplines.map((d) => html`<option>${d}</option>`)}</select>
      <select name="building_type" aria-label="Building type"><option value="">All building types</option>${m.buildingTypes.map((d) => html`<option>${d}</option>`)}</select>
      <select name="status" aria-label="Status"><option value="">Any status (excl. archived)</option>${m.planStatus.map((d) => html`<option>${d}</option>`)}</select>
    </form>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Plan</th><th>Building</th><th>Discipline</th><th>Rev</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody data-rows><tr><td colspan="6" class="muted">Loading…</td></tr></tbody>
    </table></div>`.s;

  const form = $('[data-filters]', main);
  let seq = 0;
  const load = async () => {
    const mySeq = ++seq;
    for (const k of Object.keys(filters)) filters[k] = form.elements[k].value;
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const rows = await api(`/plans?${qs}`);
    if (mySeq !== seq || !isCurrent()) return;
    $('[data-rows]', main).innerHTML = (rows.length ? html`${rows.map((p) => html`<tr>
      <td><a href="#/plans/${p.id}"><strong>${p.title}</strong></a> ${p.is_template ? templateBadge() : ''} ${p.sensitivity > 0 ? sensitivityBadge(p.sensitivity) : ''}
        <div class="muted small">${p.plan_number || ''}</div></td>
      <td>${p.building_id ? html`<a href="#/buildings/${p.building_id}">${p.building_name}</a><div class="muted small">${p.site_name}</div>` : html`<span class="muted">${p.is_template ? p.category || '—' : 'Unassigned'}</span>`}</td>
      <td>${p.discipline}</td><td>${p.revision}</td><td>${statusBadge(p.status)}</td><td>${fmtDate(p.updated_at)}</td>
    </tr>`)}` : html`<tr><td colspan="6" class="muted">No plans match these filters.</td></tr>`).s;
  };
  let timer;
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('[data-new]', main)?.addEventListener('click', async () => {
    const id = await newPlanDialog();
    if (id) go(`#/plans/${id}`);
  });
  load();
}

// ---------- Plan detail ----------

function fileGrid(files, { removable }) {
  if (!files.length) return html`<p class="muted">No files in this revision.</p>`;
  return html`<div class="files">${files.map((f) => html`
    <div class="file">
      <button class="file-open" data-open="${f.id}" title="Open ${f.original_name}">
        ${f.mime_type.startsWith('image/') && f.mime_type !== 'image/tiff' ? thumb(f.id, f.original_name)
          : html`<div class="thumb empty ext">${f.original_name.split('.').pop().toUpperCase()}</div>`}
      </button>
      <div class="file-meta">
        <strong title="${f.original_name}">${f.original_name}</strong>
        <span class="muted small">${f.description ? `${f.description} · ` : ''}${fmtBytes(f.size_bytes)}</span>
        <span class="file-actions">
          <a href="/api/files/${f.id}?download=1">Download</a>
          ${removable ? html`<button class="link danger" data-remove="${f.id}">Remove</button>` : ''}
        </span>
      </div>
    </div>`)}</div>`;
}

export async function planView({ main, params, refresh, isCurrent }) {
  const p = await api(`/plans/${params[0]}`);
  if (!isCurrent()) return;
  const edit = canEdit();
  const [current, ...older] = p.revisions;
  const allFiles = p.revisions.flatMap((r) => r.files);

  main.innerHTML = html`
    <nav class="crumbs">
      ${p.is_template ? html`<a href="#/templates">Template library</a>` : p.building
        ? html`<a href="#/sites/${p.building.site_id}">${p.building.site_name}</a> / <a href="#/buildings/${p.building.id}">${p.building.name}</a>`
        : html`<a href="#/plans">All plans</a>`}
    </nav>
    <header class="page-head">
      <div>
        <h1>${p.title}</h1>
        <div class="badges">${p.is_template ? templateBadge() : ''} ${statusBadge(p.status)} ${sensitivityBadge(p.sensitivity)}
          <span class="muted">${p.plan_number || ''} · ${p.discipline} · Rev ${current.label}</span></div>
      </div>
      ${edit ? html`<div class="actions">
        <button class="btn primary" data-act="derive">${p.is_template ? 'Use as base for new plan' : 'Copy to new plan'}</button>
        ${p.is_template ? '' : html`<button class="btn" data-act="template">Save as template</button>`}
        <button class="btn" data-act="edit">Edit details</button>
      </div>` : ''}
    </header>

    <div class="detail">
      <div class="detail-main">
        <section class="card">
          <header class="card-head">
            <h2>Current drawings <span class="muted">· Rev ${current.label}</span></h2>
            ${edit ? html`<div class="actions"><button class="btn sm" data-act="upload">Upload files</button><button class="btn sm" data-act="revise">New revision</button></div>` : ''}
          </header>
          ${current.notes ? html`<p class="rev-note">${current.notes} <span class="muted small">— ${current.author || 'unknown'}, ${fmtDate(current.created_at)}</span></p>` : ''}
          <div data-drop>${fileGrid(current.files, { removable: edit })}</div>
          ${edit ? html`<p class="muted small drop-hint">Tip: drag files onto this panel to add them to Rev ${current.label}.</p>` : ''}
        </section>

        ${p.description ? html`<section class="card"><h2>Description</h2><p class="prose">${p.description}</p></section>` : ''}

        <section class="card">
          <h2>Revision history</h2>
          <ol class="timeline">
            <li class="current"><strong>Rev ${current.label}</strong> <span class="badge">current</span>
              <div>${current.notes || ''}</div><div class="muted small">${current.author || ''} · ${fmtDate(current.created_at)} · ${current.files.length} files</div></li>
            ${older.map((r) => html`<li><details><summary><strong>Rev ${r.label}</strong> — ${r.notes || 'No notes'}
                <span class="muted small">· ${r.author || ''} · ${fmtDate(r.created_at)} · ${r.files.length} files</span></summary>
              ${fileGrid(r.files, { removable: false })}</details></li>`)}
          </ol>
        </section>

        <section class="card">
          <header class="card-head"><h2>Maintenance & renovation using this plan</h2>
            ${edit && p.building ? html`<button class="btn sm" data-act="work">Log work</button>` : ''}</header>
          ${p.work.length ? html`<ul class="list">${p.work.map((w) => html`<li>
            <strong>${w.title}</strong> ${statusBadge(w.status)}
            <div class="muted small">${w.kind} · ${w.building_name} · ${fmtDate(w.start_date)}${w.contractor ? ` · ${w.contractor}` : ''}</div></li>`)}</ul>`
            : html`<p class="muted">${p.is_template ? 'Templates are not linked to work records — buildings built from them are.' : 'No work records reference this plan yet.'}</p>`}
        </section>
      </div>

      <aside class="detail-side">
        <section class="card">
          <h2>Details</h2>
          <dl class="props">
            ${p.building ? html`<dt>Building</dt><dd><a href="#/buildings/${p.building.id}">${p.building.name}</a><br><span class="muted small">${p.building.site_name}</span></dd>` : ''}
            ${p.is_template ? html`<dt>Category</dt><dd>${p.category || '—'}</dd>` : ''}
            <dt>Building type</dt><dd>${p.building_type || '—'}</dd>
            <dt>Floors</dt><dd>${p.floors ?? '—'}</dd>
            <dt>Gross area</dt><dd>${p.gross_area_sqft ? `${fmtNum(p.gross_area_sqft)} sq ft` : '—'}</dd>
            <dt>Construction</dt><dd>${p.construction_type || '—'}</dd>
            <dt>Distribution</dt><dd>${SENSITIVITY_LABELS[p.sensitivity]}</dd>
            <dt>Tags</dt><dd>${p.tags ? p.tags.split(',').map((t) => html`<span class="tag">${t.trim()}</span>`) : '—'}</dd>
            <dt>Created</dt><dd>${fmtDate(p.created_at)}${p.created_by_name ? ` by ${p.created_by_name}` : ''}</dd>
          </dl>
        </section>
        <section class="card">
          <h2>Lineage</h2>
          <ol class="lineage">
            ${[...p.ancestors].reverse().map((a) => html`<li>${a.id ? html`<a href="#/plans/${a.id}">${a.title}</a>` : html`<span class="muted">${a.title}</span>`}
              ${a.is_template ? templateBadge() : ''}${a.from_revision ? html` <span class="muted small">rev ${a.from_revision}</span>` : ''}</li>`)}
            <li class="self"><strong>${p.title}</strong></li>
          </ol>
          ${p.derived.length ? html`<h3>Built from this ${p.is_template ? 'template' : 'plan'} (${p.derived.length})</h3>
            <ul class="list compact">${p.derived.map((d) => html`<li><a href="#/plans/${d.id}">${d.title}</a> ${d.is_template ? templateBadge() : ''}
              <div class="muted small">${d.building_name ? `${d.site_name} · ${d.building_name}` : 'Unassigned'}</div></li>`)}</ul>`
            : html`<p class="muted small">Nothing has been started from this ${p.is_template ? 'template' : 'plan'} yet.</p>`}
        </section>
      </aside>
    </div>`.s;

  $$('[data-open]', main).forEach((b) => b.addEventListener('click', () => {
    const file = allFiles.find((f) => f.id === Number(b.dataset.open));
    openViewer(file, p.revisions.find((r) => r.id === file.revision_id).files);
  }));
  if (!edit) return;

  const act = (name, fn) => $(`[data-act=${name}]`, main)?.addEventListener('click', fn);
  act('derive', async () => {
    const id = await deriveDialog(p, { building_id: p.is_template ? null : p.building_id });
    if (id) go(`#/plans/${id}`);
  });
  act('template', async () => {
    const id = await saveAsTemplateDialog(p);
    if (id) go(`#/plans/${id}`);
  });
  act('edit', async () => {
    const fields = planFields(p);
    if (!p.is_template) fields.splice(1, 0, { name: 'building_id', label: 'Building', type: 'select', options: await buildingOptions(), value: p.building_id, empty: '— Not assigned —' });
    else fields.push({ name: 'status', label: 'Status', type: 'select', options: state.meta.planStatus, required: true, value: p.status, hint: 'Archive to retire a template' });
    const ok = await formDialog({
      title: 'Edit plan details', fields, wide: true,
      onSubmit: (v) => api(`/plans/${p.id}`, { method: 'PUT', body: v }),
    });
    if (ok) { toast('Saved'); refresh(); }
  });
  act('upload', async () => {
    const ok = await formDialog({
      title: `Upload files to Rev ${current.label}`,
      fields: [
        { name: 'files', label: 'Files', type: 'file', multiple: true, required: true, full: true },
        { name: 'description', label: 'Sheet / description', full: true, placeholder: 'e.g. A-101 First floor plan' },
      ],
      submitLabel: 'Upload',
      onSubmit: (v, progress) => sendFiles(p.id, v.files, v.description, progress),
    });
    if (ok) { toast('Files uploaded'); refresh(); }
  });
  act('revise', async () => {
    const ok = await formDialog({
      title: 'Issue a new revision',
      intro: `Rev ${current.label} will be kept as read-only history. The new revision starts with a copy of its files so you can replace only what changed.`,
      fields: [
        { name: 'notes', label: 'What changed?', type: 'textarea', required: true, placeholder: 'e.g. Updated after 2026 HVAC replacement — new RTU locations' },
        { name: 'carry_forward', label: 'Carry current files forward', type: 'checkbox', value: true, full: true },
      ],
      submitLabel: 'Create revision',
      onSubmit: (v) => api(`/plans/${p.id}/revisions`, { method: 'POST', body: v }),
    });
    if (ok) { toast('New revision created'); refresh(); }
  });
  act('work', async () => {
    const ok = await workDialog({ building_id: p.building.id, record: { plan_id: p.id }, plans: [{ id: p.id, title: p.title, revision: current.label }] });
    if (ok) refresh();
  });
  $$('[data-remove]', main).forEach((b) => b.addEventListener('click', async () => {
    const f = current.files.find((x) => x.id === Number(b.dataset.remove));
    if (!(await confirmDialog(`Remove ${f.original_name} from Rev ${current.label}? Earlier revisions keep their copy.`, { okLabel: 'Remove' }))) return;
    await api(`/plans/${p.id}/files/${f.id}`, { method: 'DELETE' });
    toast('File removed');
    refresh();
  }));

  const drop = $('[data-drop]', main).closest('.card');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    if (!e.dataTransfer.files.length) return;
    try {
      await sendFiles(p.id, e.dataTransfer.files, '');
      toast('Files uploaded');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
