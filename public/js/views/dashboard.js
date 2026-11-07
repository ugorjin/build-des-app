import { api, html, $, fmtDate } from '../lib.js';
import { state, canEdit, isAdmin, statusBadge, templateBadge, thumb } from '../common.js';

const DISMISS_KEY = 'pv.gettingStarted.dismissed';

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

// Setup checklist for editors until every step is done (or it is hidden).
function gettingStarted(stats) {
  if (!canEdit() || dismissed()) return '';
  const steps = [
    [stats.sites > 0, 'Add a site', 'An installation, campus or property that groups buildings.', '#/sites'],
    [stats.buildings > 0, 'Add its buildings', 'Open a site and add each building, with number, type and year built.', '#/sites'],
    [stats.plans > 0, 'Upload existing drawings', 'On a building, choose Upload plan to store its as-built drawings.', '#/sites'],
    [stats.templates > 0, 'Publish a template', 'Save a proven design to the library so new buildings can start from it.', '#/templates'],
    [stats.work > 0, 'Log maintenance or renovation', 'Record work against a building and the drawings the crew used.', '#/work'],
  ];
  if (isAdmin()) steps.push([stats.users > 1, 'Invite your team', 'Create accounts and set what each person can edit and view.', '#/admin']);
  const done = steps.filter(([ok]) => ok).length;
  if (done === steps.length) return '';
  return html`<section class="card getting-started">
    <header class="card-head">
      <div><h2>Getting started</h2><p class="muted small">${done} of ${steps.length} done. Sites and buildings are optional for templates and new designs, but needed to store existing drawings and log work.</p></div>
      <button class="link" data-dismiss>Hide</button>
    </header>
    <ol class="steps">${steps.map(([ok, title, text, href]) => html`<li class="${ok ? 'done' : ''}">
      <span class="step-mark" aria-label="${ok ? 'Done' : 'To do'}">${ok ? '✓' : ''}</span>
      <div><a href="${href}"><strong>${title}</strong></a><div class="muted small">${text}</div></div>
    </li>`)}</ol>
  </section>`;
}

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
    ${gettingStarted(stats)}
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
  $('[data-dismiss]', main)?.addEventListener('click', (e) => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable: hide for this view only */ }
    e.target.closest('.getting-started').remove();
  });
  main.querySelector('.search-hero').addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/plans?q=${encodeURIComponent(e.target.q.value)}`;
  });
}
