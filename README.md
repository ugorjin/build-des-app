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

## Deploying to Render (free demo)

`render.yaml` is a Render Blueprint for a **free** web service. The free plan has no persistent disk, so the app **resets to the sample data whenever it restarts**: on each deploy, and when it wakes after sleeping for 15 idle minutes. Uploads and edits made during a demo don't survive that. The first visit after sleeping takes about 30 seconds.

1. In Render: **New → Blueprint**, connect GitHub, and pick the `build-des-app` repo and the branch to deploy.
2. Click **Apply**. The build takes a few minutes.
3. Open the service's **Environment** tab and copy `ADMIN_PASSWORD`. Sign in at the `onrender.com` URL as `admin`. A changed password won't persist on the free plan, so share this one with demo viewers or create temporary users.

For real use, switch the service to a paid plan, add a disk (for example mounted at `/var/data`), set `DATA_DIR=/var/data`, and set `SEED_DEMO=0`.

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
