'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { hashPassword } = require('./auth');
const { tx } = require('./db');
const { insert } = require('./util');

// Creates the first admin account on an empty database.
function ensureAdmin(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return null;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  insert(db, 'users', { username: 'admin', display_name: 'Administrator', role: 'admin', clearance: 2, password_hash: hashPassword(password) });
  console.log(`Created initial admin account -> username: admin  password: ${password}`);
  console.log('Change this password after signing in.');
  return password;
}

// ---- Demo floor plan drawings (simple SVG sheets) ----

function floorPlanSvg({ title, sheet, width, height, rooms }) {
  const S = 10; // px per grid unit
  const pad = 40;
  const W = width * S + pad * 2;
  const H = height * S + pad * 2 + 70;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const roomEls = rooms.map(([x, y, w, h, label]) => {
    const cx = pad + (x + w / 2) * S;
    const cy = pad + (y + h / 2) * S;
    return `<rect x="${pad + x * S}" y="${pad + y * S}" width="${w * S}" height="${h * S}" fill="#f4f8fc" stroke="#1d3557" stroke-width="2"/>
<text x="${cx}" y="${cy}" font-size="11" text-anchor="middle" dominant-baseline="middle" fill="#1d3557">${esc(label)}</text>
<text x="${cx}" y="${cy + 14}" font-size="9" text-anchor="middle" fill="#6b7f99">${w * 2}' × ${h * 2}'</text>`;
  }).join('\n');
  const ty = pad * 2 + height * S;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="${pad - 6}" y="${pad - 6}" width="${width * S + 12}" height="${height * S + 12}" fill="none" stroke="#1d3557" stroke-width="6"/>
${roomEls}
<g transform="translate(${pad}, ${ty})">
  <rect width="${width * S}" height="54" fill="none" stroke="#1d3557"/>
  <text x="10" y="22" font-size="14" font-weight="bold" fill="#1d3557">${esc(title)}</text>
  <text x="10" y="42" font-size="11" fill="#6b7f99">Sheet ${esc(sheet)} · Scale: 1 grid = 2 ft · Demo drawing</text>
  <g transform="translate(${width * S - 40}, 27)"><circle r="16" fill="none" stroke="#1d3557"/><path d="M0,-14 L6,6 L0,2 L-6,6 Z" fill="#1d3557"/><text y="-19" font-size="9" text-anchor="middle">N</text></g>
</g>
</svg>`;
}

const TEMPLATES = [
  {
    key: 'barracks',
    title: 'Unaccompanied Housing — 3-Story, 96 Person',
    plan_number: 'TPL-UH-096',
    category: 'Barracks / Housing',
    building_type: 'Barracks / Housing',
    floors: 3,
    gross_area_sqft: 42000,
    construction_type: 'Type II-B, CMU bearing walls',
    tags: 'barracks, dormitory, standard design',
    description: 'Standard design for a 3-story unaccompanied housing building with 2+2 suite modules, central laundry and day room on each floor.',
    sheets: [{
      sheet: 'A-101', name: 'Typical floor plan', width: 80, height: 34, rooms: [
        [0, 0, 12, 14, 'Suite 101'], [12, 0, 12, 14, 'Suite 102'], [24, 0, 12, 14, 'Suite 103'], [36, 0, 8, 14, 'Stair 1'],
        [44, 0, 12, 14, 'Suite 104'], [56, 0, 12, 14, 'Suite 105'], [68, 0, 12, 14, 'Suite 106'],
        [0, 14, 80, 6, 'Corridor'],
        [0, 20, 12, 14, 'Suite 107'], [12, 20, 12, 14, 'Laundry'], [24, 20, 20, 14, 'Day room'],
        [44, 20, 12, 14, 'Mech / Elec'], [56, 20, 12, 14, 'Suite 108'], [68, 20, 12, 14, 'Stair 2'],
      ],
    }],
  },
  {
    key: 'office',
    title: 'Battalion Headquarters — 2-Story Administrative',
    plan_number: 'TPL-ADM-002',
    category: 'Administrative / Office',
    building_type: 'Administrative / Office',
    floors: 2,
    gross_area_sqft: 18500,
    construction_type: 'Type II-B, steel frame',
    tags: 'headquarters, office, admin',
    description: 'Two-story headquarters with command suite, open office, conference rooms and secure records room.',
    sheets: [{
      sheet: 'A-101', name: 'First floor plan', width: 64, height: 36, rooms: [
        [0, 0, 16, 14, 'Command suite'], [16, 0, 14, 14, 'Conference A'], [30, 0, 20, 14, 'Open office'], [50, 0, 14, 14, 'Records (secure)'],
        [0, 14, 64, 6, 'Corridor'],
        [0, 20, 12, 16, 'Lobby'], [12, 20, 10, 16, 'Restrooms'], [22, 20, 14, 16, 'Break room'], [36, 20, 14, 16, 'Conference B'], [50, 20, 14, 16, 'IT / Comms'],
      ],
    }],
  },
  {
    key: 'vmf',
    title: 'Vehicle Maintenance Facility — 6 Bay',
    plan_number: 'TPL-VMF-006',
    category: 'Vehicle maintenance',
    building_type: 'Vehicle maintenance',
    floors: 1,
    gross_area_sqft: 24000,
    construction_type: 'Pre-engineered metal building',
    tags: 'motor pool, maintenance, bays',
    description: 'Six drive-through maintenance bays with overhead crane, parts storage, tool room and shop offices.',
    sheets: [{
      sheet: 'A-101', name: 'Floor plan', width: 84, height: 40, rooms: [
        [0, 0, 14, 26, 'Bay 1'], [14, 0, 14, 26, 'Bay 2'], [28, 0, 14, 26, 'Bay 3'], [42, 0, 14, 26, 'Bay 4'], [56, 0, 14, 26, 'Bay 5'], [70, 0, 14, 26, 'Bay 6'],
        [0, 26, 20, 14, 'Parts storage'], [20, 26, 14, 14, 'Tool room'], [34, 26, 16, 14, 'Shop office'], [50, 26, 14, 14, 'Locker / Wash'], [64, 26, 20, 14, 'POL storage'],
      ],
    }],
  },
  {
    key: 'warehouse',
    title: 'General Purpose Warehouse — 20,000 SF',
    plan_number: 'TPL-WH-020',
    category: 'Warehouse / Storage',
    building_type: 'Warehouse / Storage',
    floors: 1,
    gross_area_sqft: 20000,
    construction_type: 'Tilt-up concrete',
    tags: 'warehouse, storage, logistics',
    description: 'Clear-span warehouse with loading docks, cage storage and small administrative office.',
    sheets: [{
      sheet: 'A-101', name: 'Floor plan', width: 70, height: 36, rooms: [
        [0, 0, 50, 36, 'Bulk storage (clear span)'], [50, 0, 20, 12, 'Secure cage'], [50, 12, 20, 12, 'Loading docks'], [50, 24, 10, 12, 'Office'], [60, 24, 10, 12, 'Restroom'],
      ],
    }],
  },
];

// Loads demo sites, buildings, templates, derived plans and work history.
// demoUsers adds editor/viewer accounts with well-known passwords, so it must
// stay off on anything reachable from the internet.
function seedDemo(db, storage, { demoUsers = true } = {}) {
  if (db.prepare('SELECT COUNT(*) AS n FROM sites').get().n > 0) {
    console.log('Database already has data; skipping demo seed.');
    return;
  }
  const created = [];
  tx(db, () => {
    let admin = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    const users = [
      ['admin', 'Administrator', 'admin', 2],
      ['editor', 'Facilities Engineer', 'editor', 1],
      ['viewer', 'Maintenance Technician', 'viewer', 0],
    ];
    for (const [username, display_name, role, clearance] of demoUsers ? users : []) {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) continue;
      insert(db, 'users', { username, display_name, role, clearance, password_hash: hashPassword(`${username}-demo-pass`) });
      created.push(`${username} / ${username}-demo-pass`);
    }
    admin = admin || db.prepare("SELECT * FROM users WHERE username = 'admin'").get();

    const fileRow = (revId, name, description, svg) => insert(db, 'plan_files', {
      revision_id: revId, original_name: name, description, mime_type: 'image/svg+xml',
      size_bytes: Buffer.byteLength(svg), sha256: storage.put(Buffer.from(svg)), uploaded_by: admin.id,
    });

    const tplIds = {};
    for (const t of TEMPLATES) {
      const id = insert(db, 'plans', {
        title: t.title, plan_number: t.plan_number, is_template: 1, category: t.category, building_type: t.building_type,
        discipline: 'Full set', status: 'active', sensitivity: 0, description: t.description, tags: t.tags,
        floors: t.floors, gross_area_sqft: t.gross_area_sqft, construction_type: t.construction_type, created_by: admin.id,
      });
      const rev = insert(db, 'plan_revisions', { plan_id: id, label: 'A', notes: 'Standard design issued', created_by: admin.id });
      for (const s of t.sheets) {
        fileRow(rev, `${t.plan_number}_${s.sheet}.svg`, s.name, floorPlanSvg({ title: `${t.title} — ${s.name}`, ...s }));
      }
      tplIds[t.key] = id;
    }

    const site1 = insert(db, 'sites', { name: 'Fort Example', code: 'FTEX', location: 'Example County', description: 'Demo installation' });
    const site2 = insert(db, 'sites', { name: 'Example Air Station', code: 'EXAS', location: 'Coastal district', description: 'Demo installation' });

    const b = (site_id, name, building_number, building_type, year_built, floors, gross_area_sqft, status = 'in service') =>
      insert(db, 'buildings', { site_id, name, building_number, building_type, year_built, floors, gross_area_sqft, status });
    const bks1 = b(site1, 'Barracks 1201', '1201', 'Barracks / Housing', 2009, 3, 42000);
    const bks2 = b(site1, 'Barracks 1202', '1202', 'Barracks / Housing', 2011, 3, 42000, 'under renovation');
    const hq = b(site1, 'Headquarters, 2nd Battalion', '1100', 'Administrative / Office', 1998, 2, 18500);
    const vmf = b(site1, 'Motor Pool Shop', '1500', 'Vehicle maintenance', 2004, 1, 24000);
    const wh = b(site2, 'Supply Warehouse', 'W-12', 'Warehouse / Storage', 2015, 1, 20000);
    b(site2, 'Hangar 3', 'H-3', 'Hangar', 1987, 1, 60000);

    // As-built plans derived from templates, so lineage is visible.
    const fromTemplate = (key, building_id, title, plan_number, extraRevisions = []) => {
      const src = db.prepare('SELECT * FROM plans WHERE id = ?').get(tplIds[key]);
      const srcRev = db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ?').get(src.id);
      const id = insert(db, 'plans', {
        title, plan_number, is_template: 0, building_type: src.building_type, discipline: 'Full set', status: 'active',
        sensitivity: 1, description: `As-built drawings. Based on ${src.plan_number}.`, tags: src.tags, floors: src.floors,
        gross_area_sqft: src.gross_area_sqft, construction_type: src.construction_type, building_id,
        source_plan_id: src.id, source_revision_id: srcRev.id, created_by: admin.id,
      });
      let revId = insert(db, 'plan_revisions', { plan_id: id, label: 'A', notes: `Started from template "${src.title}" rev A`, created_by: admin.id });
      db.prepare(`INSERT INTO plan_files (revision_id, original_name, description, mime_type, size_bytes, sha256, uploaded_by)
        SELECT ?, original_name, description, mime_type, size_bytes, sha256, uploaded_by FROM plan_files WHERE revision_id = ?`).run(revId, srcRev.id);
      extraRevisions.forEach((notes, i) => {
        const next = insert(db, 'plan_revisions', { plan_id: id, label: String.fromCharCode(66 + i), notes, created_by: admin.id });
        db.prepare(`INSERT INTO plan_files (revision_id, original_name, description, mime_type, size_bytes, sha256, uploaded_by)
          SELECT ?, original_name, description, mime_type, size_bytes, sha256, uploaded_by FROM plan_files WHERE revision_id = ?`).run(next, revId);
        revId = next;
      });
      return id;
    };
    const p1 = fromTemplate('barracks', bks1, 'Barracks 1201 — As-built', 'FTEX-1201-A');
    const p2 = fromTemplate('barracks', bks2, 'Barracks 1202 — As-built', 'FTEX-1202-A', ['Laundry relocated to 1st floor (2019 renovation)']);
    const p3 = fromTemplate('office', hq, 'Bldg 1100 HQ — As-built', 'FTEX-1100-A');
    fromTemplate('vmf', vmf, 'Bldg 1500 Motor Pool — As-built', 'FTEX-1500-A');
    fromTemplate('warehouse', wh, 'Warehouse W-12 — As-built', 'EXAS-W12-A');

    const elec = insert(db, 'plans', {
      title: 'Bldg 1100 — Electrical one-line diagram', plan_number: 'FTEX-1100-E', discipline: 'Electrical', status: 'active',
      sensitivity: 2, building_type: 'Administrative / Office', building_id: hq, description: 'Service entrance, panel schedules and generator transfer. Restricted distribution.', created_by: admin.id,
    });
    insert(db, 'plan_revisions', { plan_id: elec, label: 'A', notes: 'Initial issue', created_by: admin.id });

    const w = (building_id, plan_id, kind, title, status, start_date, completed_date, contractor, cost, description) =>
      insert(db, 'work_records', { building_id, plan_id, kind, title, status, start_date, completed_date, contractor, cost, description, created_by: admin.id });
    w(bks1, p1, 'maintenance', 'Annual HVAC service — all suites', 'completed', '2026-03-02', '2026-03-06', 'Base Ops Contractor', 18400, 'Filters, coil cleaning, condensate lines.');
    w(bks1, p1, 'inspection', 'Fire alarm annual inspection', 'completed', '2026-05-14', '2026-05-14', 'Fire Dept', 0, null);
    w(bks2, p2, 'renovation', 'Suite bathroom modernization, floors 2-3', 'in progress', '2026-09-01', null, 'Example Builders LLC', 640000, 'Replace fixtures, waterproofing and tile in 32 suites.');
    w(hq, p3, 'repair', 'Roof leak over Conference A', 'planned', '2026-11-10', null, null, 12500, 'Membrane patch and flashing repair.');
    w(vmf, null, 'maintenance', 'Overhead crane load test', 'planned', '2026-12-01', null, 'Crane Services Inc', 3200, null);
  });
  console.log('Demo data loaded.');
  if (created.length) console.log(`Demo logins: ${created.join(', ')}`);
}

module.exports = { ensureAdmin, seedDemo, floorPlanSvg };

if (require.main === module) {
  const { openDb } = require('./db');
  const { createStorage } = require('./storage');
  const fs = require('node:fs');
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'planvault.db'));
  seedDemo(db, createStorage(path.join(dataDir, 'files')));
}
