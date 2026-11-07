// Session state, shared badges and the dialogs used from several pages.
import { api, html, formDialog, toast, uploadFiles } from './lib.js';

export const state = { me: null, meta: null };

export const canEdit = () => state.me && ['editor', 'admin'].includes(state.me.role);
export const isAdmin = () => state.me?.role === 'admin';
export const go = (hash) => { location.hash = hash; };

export const SENSITIVITY_LABELS = ['Open', 'Internal', 'Restricted'];

export const sensitivityBadge = (level) =>
  html`<span class="badge sens-${level}" title="Distribution">${SENSITIVITY_LABELS[level] ?? level}</span>`;
export const statusBadge = (status) => html`<span class="badge st-${status.replace(/\s+/g, '-')}">${status}</span>`;
export const templateBadge = () => html`<span class="badge tpl">Template</span>`;

export function sensitivityOptions() {
  return state.meta.sensitivity
    .map((v, i) => [v, SENSITIVITY_LABELS[i]])
    .filter((_, i) => i <= state.me.clearance);
}

let buildingCache = null;
export async function buildingOptions(force = false) {
  if (!buildingCache || force) buildingCache = await api('/buildings');
  return buildingCache.map((b) => [b.id, `${b.site_name} · ${b.building_number ? `${b.building_number} ` : ''}${b.name}`]);
}
export const invalidateBuildings = () => { buildingCache = null; };

export function planFields(plan = {}, { isTemplate = !!plan.is_template } = {}) {
  const m = state.meta;
  return [
    { name: 'title', label: 'Title', required: true, value: plan.title, full: true },
    { name: 'plan_number', label: 'Plan / drawing number', value: plan.plan_number, placeholder: 'e.g. FTEX-1201-A' },
    { name: 'discipline', label: 'Discipline', type: 'select', options: m.disciplines, required: true, value: plan.discipline || 'Full set' },
    { name: 'building_type', label: 'Building type', type: 'select', options: m.buildingTypes, value: plan.building_type },
    isTemplate
      ? { name: 'category', label: 'Template category', value: plan.category, placeholder: 'Defaults to building type' }
      : { name: 'status', label: 'Status', type: 'select', options: m.planStatus, required: true, value: plan.status || 'draft' },
    { name: 'sensitivity', label: 'Distribution', type: 'select', options: sensitivityOptions(), required: true,
      value: m.sensitivity[plan.sensitivity ?? 1] ?? m.sensitivity[0], hint: 'Who may view this plan' },
    { name: 'floors', label: 'Floors', type: 'number', value: plan.floors },
    { name: 'gross_area_sqft', label: 'Gross area (sq ft)', type: 'number', value: plan.gross_area_sqft },
    { name: 'construction_type', label: 'Construction type', value: plan.construction_type },
    { name: 'tags', label: 'Tags', value: plan.tags, placeholder: 'comma separated' },
    { name: 'description', label: 'Description / scope', type: 'textarea', value: plan.description },
  ];
}

// New plan, optionally attached to a building, with optional first files.
export async function newPlanDialog({ building_id = null, is_template = false } = {}) {
  const fields = planFields({ is_template }, { isTemplate: is_template });
  if (!is_template) {
    fields.splice(1, 0, { name: 'building_id', label: 'Building', type: 'select', options: await buildingOptions(), value: building_id,
      empty: '— Not yet assigned —', hint: 'Optional. Leave unassigned for a design not tied to a building yet.' });
  }
  fields.push({ name: 'files', label: 'Drawings & documents', type: 'file', multiple: true, full: true,
    hint: 'PDF, DWG, DXF, IFC, images, ZIP, Office files. You can add more later.' });
  return formDialog({
    title: is_template ? 'New template' : 'New plan',
    fields,
    wide: true,
    submitLabel: 'Create',
    onSubmit: async (v, progress) => {
      const { files, ...body } = v;
      const { id } = await api('/plans', { method: 'POST', body: { ...body, is_template } });
      if (files.length) await sendFiles(id, files, '', progress);
      toast(is_template ? 'Template created' : 'Plan created');
      return id;
    },
  });
}

export async function sendFiles(planId, files, description, progress) {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (description) form.append('description', description);
  return uploadFiles(`/plans/${planId}/files`, form, progress);
}

// "Use as base": copy a template (or any plan) into a new plan.
export async function deriveDialog(source, { building_id = null } = {}) {
  return formDialog({
    title: source.is_template ? 'Start a new plan from this template' : 'Copy into a new plan',
    intro: html`The new plan starts with every drawing in <strong>${source.title}</strong>'s current revision and keeps a link back to it.
      The original is not changed.`,
    fields: [
      { name: 'title', label: 'New plan title', required: true, full: true, value: source.is_template ? '' : `${source.title} (copy)`,
        placeholder: 'e.g. Barracks 1305 — Design' },
      { name: 'building_id', label: 'Building', type: 'select', options: await buildingOptions(), value: building_id,
        empty: '— Not yet assigned —', hint: 'Assign now or later' },
      { name: 'plan_number', label: 'Plan number', placeholder: 'optional' },
    ],
    submitLabel: 'Create plan',
    onSubmit: async (v) => {
      const { id } = await api(`/plans/${source.id}/derive`, { method: 'POST', body: v });
      toast('New plan created from base');
      return id;
    },
  });
}

export async function saveAsTemplateDialog(plan) {
  return formDialog({
    title: 'Save as template',
    intro: 'Publishes a snapshot of this plan\'s current revision to the template library so others can start from it. This plan stays as it is.',
    fields: [
      { name: 'title', label: 'Template title', required: true, full: true, value: plan.title.replace(/\s*[—-]\s*As-built$/i, '') },
      { name: 'category', label: 'Category', value: plan.category || plan.building_type || '', placeholder: 'e.g. Barracks / Housing' },
      { name: 'description', label: 'What is this template for?', type: 'textarea', value: plan.description },
    ],
    submitLabel: 'Publish template',
    onSubmit: async (v) => {
      const { id } = await api(`/plans/${plan.id}/save-as-template`, { method: 'POST', body: v });
      toast('Template published');
      return id;
    },
  });
}

export async function workDialog({ record = {}, building_id, plans = [] } = {}) {
  const m = state.meta;
  const fields = [
    { name: 'title', label: 'Title', required: true, full: true, value: record.title },
    { name: 'kind', label: 'Type', type: 'select', options: m.workKinds, required: true, value: record.kind || 'maintenance' },
    { name: 'status', label: 'Status', type: 'select', options: m.workStatus, required: true, value: record.status || 'planned' },
    { name: 'plan_id', label: 'Related plan', type: 'select', options: plans.map((p) => [p.id, `${p.title}${p.revision ? ` (rev ${p.revision})` : ''}`]),
      value: record.plan_id, empty: '— None —', hint: 'The drawings crews should refer to' },
    { name: 'contractor', label: 'Performed by', value: record.contractor },
    { name: 'start_date', label: 'Start date', type: 'date', value: record.start_date },
    { name: 'completed_date', label: 'Completed date', type: 'date', value: record.completed_date },
    { name: 'cost', label: 'Cost (USD)', type: 'number', step: '0.01', value: record.cost },
    { name: 'description', label: 'Description / findings', type: 'textarea', value: record.description },
  ];
  return formDialog({
    title: record.id ? 'Edit work record' : 'Log maintenance / renovation',
    fields,
    wide: true,
    onSubmit: async (v) => {
      if (record.id) await api(`/work/${record.id}`, { method: 'PUT', body: v });
      else await api('/work', { method: 'POST', body: { ...v, building_id } });
      toast('Work record saved');
      return true;
    },
  });
}

export function thumb(fileId, alt) {
  return fileId
    ? html`<img class="thumb" src="/api/files/${fileId}" alt="${alt}" loading="lazy">`
    : html`<div class="thumb empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 12h8M12 4v16" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div>`;
}
