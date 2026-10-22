// Small helpers shared by all views: escaping templates, API calls, dialogs.

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Raw(s);

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

// Tagged template: interpolations are escaped unless wrapped in raw()/html``.
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('pv:signedout'));
    throw new ApiError(res.status, data?.error || res.statusText);
  }
  return data;
}

// Uploads with progress (fetch has no upload progress events).
export function uploadFiles(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(form);
  });
}

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

// ---- Formatting ----

export const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
export const fmtMoney = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
export const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
};
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ---- Form dialog ----
// fields: [{ name, label, type, options, value, required, hint, placeholder, full }]
// options may be strings or [value, label] pairs. Resolves with the onSubmit
// result, or null if cancelled. onSubmit errors are shown inline.

function fieldHtml(f) {
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const val = f.value ?? '';
  let input;
  if (f.type === 'textarea') {
    input = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" placeholder="${f.placeholder || ''}"${req}>${val}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
    input = html`<select id="${id}" name="${f.name}"${req}>
      ${f.required ? '' : html`<option value="">${f.empty || '—'}</option>`}
      ${opts.map(([v, l]) => html`<option value="${v}"${String(v) === String(val) ? raw(' selected') : ''}>${l}</option>`)}
    </select>`;
  } else if (f.type === 'checkbox') {
    return html`<label class="check${f.full ? ' full' : ''}"><input type="checkbox" name="${f.name}"${f.value ? raw(' checked') : ''}> ${f.label}
      ${f.hint ? html`<small>${f.hint}</small>` : ''}</label>`;
  } else if (f.type === 'file') {
    input = html`<input id="${id}" type="file" name="${f.name}"${f.multiple ? raw(' multiple') : ''}${f.accept ? raw(` accept="${esc(f.accept)}"`) : ''}${req}>`;
  } else {
    input = html`<input id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${val}" placeholder="${f.placeholder || ''}"${f.step ? raw(` step="${esc(f.step)}"`) : ''}${req}>`;
  }
  return html`<div class="field${f.full || f.type === 'textarea' ? ' full' : ''}">
    <label for="${id}">${f.label}${f.required ? html`<span class="req">*</span>` : ''}</label>
    ${input}${f.hint ? html`<small>${f.hint}</small>` : ''}
  </div>`;
}

export function formDialog({ title, intro, fields, submitLabel = 'Save', onSubmit, wide = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal${wide ? ' wide' : ''}`;
    dlg.innerHTML = html`<form method="dialog" novalidate>
      <header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
      <div class="modal-body">
        ${intro ? html`<p class="intro">${intro}</p>` : ''}
        <div class="form-grid">${fields.map(fieldHtml)}</div>
        <p class="form-error" hidden></p>
        <div class="progress" hidden><div></div></div>
      </div>
      <footer><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${submitLabel}</button></footer>
    </form>`.s;
    document.body.append(dlg);
    const form = $('form', dlg);
    const errEl = $('.form-error', dlg);
    let result = null;
    const close = () => { dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', close));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const values = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else if (f.type === 'file') values[f.name] = el.files;
        else values[f.name] = el.value.trim();
      }
      const btn = $('button[type=submit]', dlg);
      btn.disabled = true;
      errEl.hidden = true;
      try {
        const progress = $('.progress', dlg);
        result = (await onSubmit(values, (p) => {
          progress.hidden = false;
          progress.firstElementChild.style.width = `${Math.round(p * 100)}%`;
        })) ?? true;
        close();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    });
    dlg.showModal();
    $('input:not([type=checkbox]), select, textarea', dlg)?.focus();
  });
}

export function confirmDialog(message, { okLabel = 'Confirm' } = {}) {
  return formDialog({ title: 'Please confirm', intro: message, fields: [], submitLabel: okLabel, onSubmit: () => true })
    .then((r) => !!r);
}

// Full-screen viewer for drawings: images get zoom/pan, PDFs use the browser viewer.
export function openViewer(file, siblings = [file]) {
  let index = Math.max(0, siblings.findIndex((f) => f.id === file.id));
  const dlg = document.createElement('dialog');
  dlg.className = 'viewer';
  document.body.append(dlg);
  let scale = 1;

  const show = () => {
    const f = siblings[index];
    scale = 1;
    const url = `/api/files/${f.id}`;
    const isImg = f.mime_type.startsWith('image/') && f.mime_type !== 'image/tiff';
    const isPdf = f.mime_type === 'application/pdf';
    dlg.innerHTML = html`<header>
        <div><strong>${f.original_name}</strong>${f.description ? html` <span class="muted">— ${f.description}</span>` : ''}</div>
        <div class="viewer-tools">
          ${siblings.length > 1 ? html`<button class="btn sm" data-prev>‹</button><span class="muted">${index + 1} / ${siblings.length}</span><button class="btn sm" data-next>›</button>` : ''}
          ${isImg ? html`<button class="btn sm" data-zoom="-1">−</button><button class="btn sm" data-zoom="0">Fit</button><button class="btn sm" data-zoom="1">+</button>` : ''}
          <a class="btn sm" href="${url}?download=1">Download</a>
          <button class="btn sm" data-close>Close</button>
        </div>
      </header>
      <div class="viewer-stage">
        ${isImg ? html`<img src="${url}" alt="${f.original_name}" draggable="false">`
          : isPdf ? html`<iframe src="${url}" title="${f.original_name}"></iframe>`
          : html`<div class="no-preview"><p>No in-browser preview for this file type.</p><a class="btn primary" href="${url}?download=1">Download ${f.original_name}</a></div>`}
      </div>`.s;
    const img = $('img', dlg);
    const apply = () => { if (img) img.style.transform = `scale(${scale})`; };
    $$('[data-zoom]', dlg).forEach((b) => b.addEventListener('click', () => {
      const z = Number(b.dataset.zoom);
      scale = z === 0 ? 1 : Math.min(8, Math.max(0.25, scale * (z > 0 ? 1.25 : 0.8)));
      apply();
    }));
    $('.viewer-stage', dlg).addEventListener('wheel', (e) => {
      if (!img || !e.ctrlKey) return;
      e.preventDefault();
      scale = Math.min(8, Math.max(0.25, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      apply();
    }, { passive: false });
    $('[data-close]', dlg).addEventListener('click', () => dlg.close());
    $('[data-prev]', dlg)?.addEventListener('click', () => { index = (index - 1 + siblings.length) % siblings.length; show(); });
    $('[data-next]', dlg)?.addEventListener('click', () => { index = (index + 1) % siblings.length; show(); });
  };
  dlg.addEventListener('close', () => dlg.remove());
  show();
  dlg.showModal();
}
