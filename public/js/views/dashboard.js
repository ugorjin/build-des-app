import { api, html, fmtDate } from '../lib.js';
import { state, canEdit, statusBadge, templateBadge, thumb } from '../common.js';

export async function dashboardView({ main, isCurrent }) {
  const [stats, recent, templates, work] = await Promise.all([
    api('/stats'),
    api('/plans?limit=8'),
    api('/plans?template=1&sort=title&limit=4'),
    api('/work?status=open'),
  ]);
  if (!isCurrent()) return;
  const tile = (n, label, href) => html`<a class="stat" href="${href}"><strong>${n}</strong><span>${label}</span></a>`;
  main.innerHTML = html`
    <header class="page-head">
      <div><h1>Welcome, ${state.me.display_name}</h1><p class="muted">Find the drawings you need, or start a new building from a proven design.</p></div>
    </header>
    <form class="search-hero" action="#/plans">
      <input name="q" type="search" placeholder="Search plans by building, number, keyword…" aria-label="Search plans">
      <button class="btn primary">Search</button>
    </form>
    <section class="stats">
      ${tile(stats.templates, 'Templates', '#/templates')}
      ${tile(stats.plans, 'Building plans', '#/plans')}
      ${tile(stats.buildings, `Buildings across ${stats.sites} site${stats.sites === 1 ? '' : 's'}`, '#/sites')}
      ${tile(stats.open_work, 'Open work orders', '#/work')}
    </section>
    <div class="cols">
      <section class="card">
        <header class="card-head"><h2>Recently updated</h2><a href="#/plans">All plans →</a></header>
        ${recent.length ? html`<ul class="list">${recent.map((p) => html`<li>
          <a href="#/plans/${p.id}"><strong>${p.title}</strong></a> ${p.is_template ? templateBadge() : statusBadge(p.status)}
          <div class="muted small">${p.building_name ? `${p.site_name} · ${p.building_name}` : p.is_template ? p.category || 'Template' : 'Unassigned'} · Rev ${p.revision} · ${fmtDate(p.updated_at)}</div>
        </li>`)}</ul>` : html`<p class="muted">No plans yet.</p>`}
      </section>
      <section class="card">
        <header class="card-head"><h2>Open maintenance & renovation</h2><a href="#/work">All work →</a></header>
        ${work.length ? html`<ul class="list">${work.slice(0, 8).map((w) => html`<li>
          <a href="#/buildings/${w.building_id}"><strong>${w.title}</strong></a> ${statusBadge(w.status)}
          <div class="muted small">${w.kind} · ${w.building_name} · ${w.start_date ? fmtDate(w.start_date) : 'no date'}${w.plan_title ? html` · refers to <a href="#/plans/${w.plan_id}">${w.plan_title}</a>` : ''}</div>
        </li>`)}</ul>` : html`<p class="muted">Nothing open.</p>`}
      </section>
    </div>
    <section>
      <header class="section-head"><h2>Start from a template</h2><a href="#/templates">Browse library →</a></header>
      <div class="grid cards">${templates.map((t) => html`<a class="tpl-card" href="#/plans/${t.id}">
        ${thumb(t.thumb_file_id, t.title)}
        <div class="tpl-body"><strong>${t.title}</strong><span class="muted small">${t.category || t.building_type || ''} · used ${t.derived_count}×</span></div>
      </a>`)}
      ${canEdit() ? html`<a class="tpl-card add" href="#/templates"><span>+ Add or publish a template</span></a>` : ''}</div>
    </section>`.s;
  main.querySelector('.search-hero').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/plans?q=${encodeURIComponent(e.target.q.value)}`;
  });
}
