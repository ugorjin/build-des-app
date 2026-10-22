import { api, html, $, fmtDate, fmtMoney, toast } from '../lib.js';
import { state, canEdit, statusBadge } from '../common.js';

export async function workView({ main, isCurrent }) {
  const m = state.meta;
  main.innerHTML = html`
    <header class="page-head">
      <div><h1>Maintenance & renovation</h1><p class="muted">Work across every building, with the drawings each job relies on.</p></div>
    </header>
    <form class="filters" data-filters>
      <select name="status" aria-label="Status"><option value="open">Open (planned + in progress)</option><option value="">All</option>${m.workStatus.map((s) => html`<option>${s}</option>`)}</select>
      <select name="kind" aria-label="Type"><option value="">All types</option>${m.workKinds.map((s) => html`<option>${s}</option>`)}</select>
    </form>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Work</th><th>Building</th><th>Drawings</th><th>Dates</th><th>Cost</th><th>Status</th></tr></thead>
      <tbody data-rows></tbody>
    </table></div>
    <p class="muted small">To log new work, open the building it applies to.</p>`.s;

  const form = $('[data-filters]', main);
  const load = async () => {
    const qs = new URLSearchParams([...new FormData(form)].filter(([, v]) => v));
    const rows = await api(`/work?${qs}`);
    if (!isCurrent()) return;
    const statusCell = (w) => (canEdit()
      ? html`<select class="inline-select" data-id="${w.id}" aria-label="Status">${m.workStatus.map((s) => html`<option${s === w.status ? html` selected` : ''}>${s}</option>`)}</select>`
      : statusBadge(w.status));
    $('[data-rows]', main).innerHTML = (rows.length ? html`${rows.map((w) => html`<tr>
      <td><strong>${w.title}</strong><div class="muted small">${w.kind}${w.contractor ? ` · ${w.contractor}` : ''}</div></td>
      <td><a href="#/buildings/${w.building_id}">${w.building_name}</a><div class="muted small">${w.site_name}</div></td>
      <td>${w.plan_title ? html`<a href="#/plans/${w.plan_id}">${w.plan_title}</a>` : html`<span class="muted">—</span>`}</td>
      <td>${fmtDate(w.start_date)}${w.completed_date ? html`<div class="muted small">done ${fmtDate(w.completed_date)}</div>` : ''}</td>
      <td>${fmtMoney(w.cost)}</td><td>${statusCell(w)}</td></tr>`)}`
      : html`<tr><td colspan="6" class="muted">No work records match.</td></tr>`).s;
  };
  form.addEventListener('change', load);
  main.addEventListener('change', async (e) => {
    if (!e.target.matches('.inline-select')) return;
    try {
      await api(`/work/${e.target.dataset.id}`, { method: 'PUT', body: { status: e.target.value } });
      toast('Status updated');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await load();
}
