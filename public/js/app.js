import { api, html, $, $$, toast, formDialog } from './lib.js';
import { state, isAdmin } from './common.js';
import { dashboardView } from './views/dashboard.js';
import { templatesView, plansView, planView } from './views/plans.js';
import { sitesView, siteView, buildingView } from './views/facilities.js';
import { workView } from './views/work.js';
import { adminView } from './views/admin.js';

const routes = [
  [/^\/?$/, dashboardView, 'home'],
  [/^\/templates$/, templatesView, 'templates'],
  [/^\/plans$/, plansView, 'plans'],
  [/^\/plans\/(\d+)$/, planView, 'plans'],
  [/^\/sites$/, sitesView, 'sites'],
  [/^\/sites\/(\d+)$/, siteView, 'sites'],
  [/^\/buildings\/(\d+)$/, buildingView, 'sites'],
  [/^\/work$/, workView, 'work'],
  [/^\/admin$/, adminView, 'admin'],
];

const NAV = [
  ['home', '#/', 'Dashboard', 'M3 11l9-8 9 8v10h-6v-6H9v6H3z'],
  ['templates', '#/templates', 'Template library', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  ['plans', '#/plans', 'All plans', 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8'],
  ['sites', '#/sites', 'Sites & buildings', 'M3 21V9l6-4 6 4v12M15 21V12h6v9M3 21h18M7 12h4M7 16h4'],
  ['work', '#/work', 'Maintenance & renovation', 'M14 6l4 4-9 9H5v-4zM16 4l4 4'],
];

function shell() {
  const me = state.me;
  $('#app').innerHTML = html`
    <aside class="sidebar">
      <a class="brand" href="#/">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M8 8h16v16H8zM8 16h9M17 8v16" stroke="#fff" stroke-width="2" fill="none"/></svg>
        <span>Plan Vault</span>
      </a>
      <nav>
        ${NAV.map(([key, href, label, d]) => html`<a href="${href}" data-nav="${key}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${label}</span></a>`)}
        ${isAdmin() ? html`<a href="#/admin" data-nav="admin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg><span>Users & audit</span></a>` : ''}
      </nav>
      <div class="me">
        <div><strong>${me.display_name}</strong><small>${me.username} · ${me.role}</small></div>
        <div class="me-actions">
          <button class="link" data-action="password">Password</button>
          <button class="link" data-action="logout">Sign out</button>
        </div>
      </div>
    </aside>
    <button class="menu-toggle" aria-label="Menu">☰</button>
    <main id="main" tabindex="-1"></main>`.s;
  $('[data-action=logout]').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.me = null;
    showLogin();
  });
  $('[data-action=password]').addEventListener('click', changePassword);
  $('.menu-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
}

function changePassword() {
  formDialog({
    title: 'Change password',
    fields: [
      { name: 'current_password', label: 'Current password', type: 'password', required: true, full: true },
      { name: 'new_password', label: 'New password', type: 'password', required: true, full: true, hint: 'At least 10 characters' },
    ],
    onSubmit: async (v) => {
      await api('/auth/password', { method: 'POST', body: v });
      toast('Password changed');
    },
  });
}

let renderSeq = 0;
async function route() {
  if (!state.me) return;
  document.body.classList.remove('nav-open');
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const match = routes.map(([re, view, nav]) => [path.match(re), view, nav]).find(([m]) => m);
  const main = $('#main');
  const seq = ++renderSeq;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', !!match && a.dataset.nav === match[2]));
  if (!match) {
    main.innerHTML = html`<div class="empty-state"><h2>Page not found</h2><a href="#/">Back to dashboard</a></div>`.s;
    return;
  }
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const ctx = { main, params: match[0].slice(1), query: new URLSearchParams(location.hash.split('?')[1] || ''), refresh: route, isCurrent: () => seq === renderSeq };
    await match[1](ctx);
    if (seq === renderSeq) main.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err.status === 401) return;
    main.innerHTML = html`<div class="empty-state"><h2>${err.status === 404 ? 'Not found' : 'Something went wrong'}</h2><p>${err.message}</p><a href="#/">Back to dashboard</a></div>`.s;
  }
}

function showLogin(message) {
  $('#app').innerHTML = html`
    <div class="login">
      <form class="login-card">
        <div class="brand big">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M8 8h16v16H8zM8 16h9M17 8v16" stroke="#fff" stroke-width="2" fill="none"/></svg>
          <span>Plan Vault</span>
        </div>
        <p class="muted">Building plans, templates and facility history in one place.</p>
        <label>Username<input name="username" autocomplete="username" required autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error"${message ? '' : html` hidden`}>${message || ''}</p>
        <button class="btn primary block">Sign in</button>
      </form>
    </div>`.s;
  $('.login-card').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      await boot();
    } catch (err) {
      const el = $('.form-error', f);
      el.textContent = err.message;
      el.hidden = false;
    }
  });
}

async function boot() {
  try {
    state.me = await api('/auth/me');
  } catch {
    showLogin();
    return;
  }
  state.meta = await api('/meta');
  shell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('pv:signedout', () => {
  if (state.me) {
    state.me = null;
    showLogin('Your session has ended. Please sign in again.');
  }
});
boot();
