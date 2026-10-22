import { api, html, $, $$, fmtDate, formDialog, toast } from '../lib.js';
import { state, SENSITIVITY_LABELS } from '../common.js';

const clearanceOptions = () => SENSITIVITY_LABELS.map((l, i) => [i, `${l}${i ? ` (and below)` : ''}`]);

export async function adminView({ main, refresh, isCurrent }) {
  const [users, log] = await Promise.all([api('/users'), api('/audit?limit=150')]);
  if (!isCurrent()) return;
  main.innerHTML = html`
    <header class="page-head">
      <div><h1>Users & audit</h1><p class="muted">Roles control who can edit; clearance controls which plans each person can see.</p></div>
      <div class="actions"><button class="btn primary" data-new>+ New user</button></div>
    </header>
    <section class="card">
      <h2>Users</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Can view</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => html`<tr>
          <td>${u.display_name}</td><td>${u.username}</td><td>${u.role}</td><td>${SENSITIVITY_LABELS[u.clearance]} and below</td>
          <td>${u.active ? 'Active' : html`<span class="muted">Disabled</span>`}</td>
          <td><button class="link" data-edit="${u.id}">Edit</button></td></tr>`)}</tbody>
      </table></div>
      <p class="muted small">Viewers can browse and download. Editors can add plans, revisions, templates and work records. Admins also manage users.</p>
    </section>
    <section class="card">
      <h2>Recent activity</h2>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead>
        <tbody>${log.map((a) => html`<tr>
          <td>${fmtDate(a.at)} <span class="muted small">${a.at.slice(11, 16)} UTC</span></td><td>${a.user_name || '—'}</td><td>${a.action}</td>
          <td>${a.entity === 'plan' && a.entity_id ? html`<a href="#/plans/${a.entity_id}">plan #${a.entity_id}</a>`
            : a.entity === 'building' && a.entity_id ? html`<a href="#/buildings/${a.entity_id}">building #${a.entity_id}</a>`
            : `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}`}</td>
          <td class="muted small">${a.detail || ''}</td></tr>`)}</tbody>
      </table></div>
    </section>`.s;

  const userFields = (u = {}) => [
    { name: 'display_name', label: 'Full name', required: true, value: u.display_name, full: true },
    ...(u.id ? [] : [{ name: 'username', label: 'Username', required: true }]),
    { name: 'role', label: 'Role', type: 'select', required: true, options: state.meta.roles, value: u.role || 'viewer' },
    { name: 'clearance', label: 'Can view plans marked', type: 'select', required: true, options: clearanceOptions(), value: u.clearance ?? 1 },
    { name: 'password', label: u.id ? 'Reset password' : 'Password', type: 'password', required: !u.id, hint: u.id ? 'Leave blank to keep current' : 'At least 10 characters' },
    ...(u.id ? [{ name: 'active', label: 'Account active', type: 'checkbox', value: !!u.active }] : []),
  ];
  const toBody = (v) => ({ ...v, clearance: Number(v.clearance), ...(v.password ? {} : { password: undefined }) });

  $('[data-new]', main).addEventListener('click', async () => {
    const ok = await formDialog({ title: 'New user', fields: userFields(), onSubmit: (v) => api('/users', { method: 'POST', body: toBody(v) }) });
    if (ok) { toast('User created'); refresh(); }
  });
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === Number(b.dataset.edit));
    const ok = await formDialog({ title: `Edit ${u.username}`, fields: userFields(u), onSubmit: (v) => api(`/users/${u.id}`, { method: 'PUT', body: toBody(v) }) });
    if (ok) { toast('User updated'); refresh(); }
  }));
}
