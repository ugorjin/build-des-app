# Plan Vault

A building-plan library for organizations that manage many facilities, such as military installations, campuses, municipalities or property portfolios.

- **Template library**: proven designs (for example "3-story 96-person barracks" or "6-bay vehicle maintenance facility") that anyone can pull up and **use as the base for a new building**.
- **Building plans**: as-built and in-progress drawing sets attached to real buildings at real sites. When renovation or maintenance comes up, pull up exactly what was built.
- **Plans become templates**: any plan can be **saved as a template**, which publishes a snapshot to the library without touching the original.
- **Lineage**: every plan remembers what it was started from (template → design → variant template → …). Each template shows what has been built from it.
- **Revisions**: plans are issued as Rev A, B, C… Earlier revisions are read-only history. A new revision carries the current files forward, so you only replace what changed.
- **Maintenance & renovation log**: work records per building (maintenance, repair, inspection, renovation) that link to the drawings crews used, with dates, contractor and cost.
- **Access control**: roles (viewer / editor / admin) control who can change things. A per-user **clearance** (Open / Internal / Restricted) controls which plans each person can see, including through search, lineage, building pages and file downloads.
- **Audit log** of every change, sign-in and upload.
- Drawings: PDF, DWG, DXF, DWF, IFC, RVT, SKP, images, ZIP and Office files. PDFs and images preview in the browser with zoom.

## Quick start

Requires Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
npm run seed     # optional: demo sites, buildings, templates and work history
npm start        # http://localhost:3000
```

Demo logins (only created by `npm run seed`):

| User | Password | Role | Can view |
|---|---|---|---|
| admin | admin-demo-pass | admin | everything |
| editor | editor-demo-pass | editor | Open + Internal |
| viewer | viewer-demo-pass | viewer | Open only |

Without the seed, the first start creates an `admin` account and prints its password. Set `ADMIN_PASSWORD` to choose it instead.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and uploaded files |
| `ADMIN_PASSWORD` | random | Initial admin password on an empty database |
| `SECURE_COOKIES` | unset | Set to `1` when served over HTTPS |
| `TRUST_PROXY` | unset | Set to `1` behind a platform load balancer (Render) |
| `SEED_DEMO` | unset | `1` loads sample data on first boot (no demo logins) |

Back up the whole `DATA_DIR`. It contains `planvault.db` and `files/`, which holds the drawings, stored once each by SHA-256. Copying a plan or carrying files into a new revision never duplicates bytes.

## Deploying to Render

`render.yaml` is a Render Blueprint: one Node web service with a 10 GB persistent disk at `/var/data` for the database and drawings. It needs the Starter plan (about $7/month plus disk), because free instances can't have disks.

1. Merge this branch into the repo's default branch, or point the Blueprint at this branch.
2. In Render: **New → Blueprint**, then connect the `build-des-app` GitHub repo. Render reads `render.yaml`, so click **Apply**.
3. Once it's live, open the service's **Environment** tab and copy `ADMIN_PASSWORD`. Sign in at the `onrender.com` URL as `admin`, then change the password (sidebar → Password).
4. `SEED_DEMO=1` loads the sample sites and templates on first boot so there's something to show. It never overwrites data and doesn't create the demo editor/viewer accounts. Set it to `0` before loading real plans, and create real users under **Users & audit**.

Render snapshots disks daily. For anything beyond a demo, also copy `/var/data` off-site on a schedule. A custom domain can be added under **Settings → Custom Domains**.

## Typical workflows

**New building from a standard design.** Template library → pick a template → *Use as base*. Name it and assign a building. You get a draft plan with all of the template's drawings at Rev A. Adapt it, upload site-specific sheets and issue new revisions.

**Renovation or maintenance.** Sites & buildings → building → open its plans for the current drawings. *Log maintenance / renovation* records the job against the plan it refers to. After the work, issue a new revision ("Updated after 2026 HVAC replacement") so the next crew sees the as-built state.

**Promote a good design.** On a plan that worked well, *Save as template* publishes it to the library with a link back to where it came from.

## Project layout

```
server/
  app.js           Express app (API + static UI)
  db.js            SQLite schema and shared enumerations
  auth.js          scrypt passwords, session cookies, role checks
  plans.js         revisions, cloning (derive / save-as-template), file types
  storage.js       content-addressed file store
  routes/          plans & files, sites & buildings, work records, account/users/audit
  seed.js          initial admin + demo data (with generated SVG floor plans)
public/            no-build single-page UI (ES modules)
test/              API tests (node:test)
```

Run the tests with `npm test`.

## Security notes

- Sessions are HttpOnly, SameSite=Strict cookies. Passwords use scrypt. Repeated failed sign-ins lock that username for 15 minutes.
- Uploads are restricted to an allow-list of extensions, and the server decides content types. Uploaded SVG/text files are served with a sandboxing CSP and `nosniff`.
- The clearance levels separate audiences inside one organization. **This is not an accredited system for classified information.** Deploy it behind your organization's network controls, SSO/reverse proxy and TLS as your policies require.
