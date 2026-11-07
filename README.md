# Electronic Andrology Logbook

A role-based electronic logbook for Andrology **Master** and **MD** candidates. Candidates record clinical and academic activities, supervisors approve them, and the department manager monitors progress and produces reports for training, accreditation and exams.

Built with **Node.js** and **no external packages**. It uses Node's built-in SQLite database, so there is nothing to `npm install`.

---

## Quick start

1. Install **Node.js 22.13 or newer**. The current LTS (v22 or v24) from https://nodejs.org works.
2. Open a terminal in this folder and run:

   ```bash
   npm start
   ```

3. Open **http://localhost:3000** in your browser.

The first start creates a database in `data/logbook.db` and fills it with **demo data**: 5 staff members, 8 candidates and about a year of logbook entries.

| Role | Email | Password |
|---|---|---|
| Department Manager | `manager@andrology.edu` | `Logbook@2026` |
| Staff / Supervisor | `k.mansour@andrology.edu` | `Logbook@2026` |
| Candidate (MD) | `ahmed.hassan@student.andrology.edu` | `Logbook@2026` |
| Candidate (Master) | `sara.mahmoud@student.andrology.edu` | `Logbook@2026` |

You can also click any demo account on the sign-in page to log in as that user.

### Start with a clean department (real use)

```bash
# Windows (PowerShell)
npm run reset
$env:DEMO="0"; $env:ADMIN_EMAIL="you@university.edu"; $env:ADMIN_PASSWORD="ChooseAStrong#Pass1"; npm start

# macOS / Linux
npm run reset
DEMO=0 ADMIN_EMAIL=you@university.edu ADMIN_PASSWORD='ChooseAStrong#Pass1' npm start
```

This creates one manager account. Use it to add staff and candidates from the admin panel. Each new account gets a temporary password that the user must change at first sign-in.

---

## Features

### Candidate portal
- **Dashboard**: overall progress ring, "time elapsed vs requirements approved" timeline, totals (submitted / approved / pending / rejected), progress table per requirement category, recent supervisor comments and a monthly activity chart.
- **Add activity**: one form per activity type: Clinic attendance, Operation, Procedure, Lecture/teaching, Research meeting, Case presentation and Other. Each form has its own fields and validation. Evidence files (PDF, images, Word) can be attached. Entries can be saved as a draft or submitted. A **Duplicate** button speeds up repeated entries.
- **My Logbook**: filter by date range, type, supervisor, status and training year. Search and pagination are included, plus Excel export.
- **Progress**: shows requirements by category, operations by role, most frequent operations and a breakdown by training year.
- **Logbook report**: printable, can be saved as PDF and exported to Excel. It includes a signature section.
- Activities returned with **Correction Required** can be edited and resubmitted.

### Staff / supervisor portal
- **Dashboard** showing the approval queue, overdue items, approvals this month, average approval time and the supervisor's own candidates.
- **Pending approvals**, sorted oldest first. Overdue items are flagged, and several items can be approved at once.
- **Review page** with **Approve**, **Request correction** and **Reject** buttons. A comment is required to reject or request a correction. The page also shows the candidate's progress and the activity's full history.
- Candidate profiles and the supervisor report.

### Manager / admin portal
- **Department dashboard** with:
  - Number of active candidates and average progress
  - Pending and overdue approvals, and candidates needing follow-up
  - Monthly volume chart and status distribution
  - Candidate progress table, with a marker for the expected progress
  - Master vs MD comparison
  - Supervisor approval performance
- **Candidates** and **Staff** management: create, edit, deactivate accounts and reset passwords. Staff can upload a signature image, which is printed on reports.
- **Activities**: every entry across all candidates, with filters and Excel export.
- **Requirements**: required numbers per program (Master/MD), per training year and per activity category. The defaults come from the specification.
- **Reports**:
  - Candidate report
  - Department (manager) report
  - Supervisor report

  All three can be printed, saved as PDF or exported to Excel.
- **Settings**:
  - Department name
  - Risk and approval-delay thresholds
  - Category names and on/off switches
  - Every drop-down list (clinic types, operations, procedures, teaching types, diagnosis categories, locations)
  - One-click **database backup** download
- **Audit log**: every login, edit, approval, export and settings change, with old and new values. It can be exported to Excel for accreditation.

### Workflow and statuses
`Draft → Pending Approval → Approved | Rejected | Correction Required → (edit) → Pending Approval`

Only **approved** activities count toward requirements, and progress updates as soon as an activity is approved. Operations count toward one of two categories depending on the candidate's role:
- **Observed / assisted**: Observer or Assistant.
- **Surgeon**: Surgeon under supervision or First surgeon.

### Notifications (in-app)
- **Candidates** are notified when an activity is approved, rejected or returned for correction, when requirements are incomplete, and when their training deadline is approaching.
- **Staff** are notified when a new submission needs approval, when a corrected activity is resubmitted, and when approvals are overdue.
- **Managers** are notified when a candidate is behind schedule or near completion, when a candidate has many rejections, and when a supervisor's approvals are delayed.

Automatic alerts are checked at startup and every 6 hours.

### Risk rules
Expected progress is the share of the training period that has elapsed. A candidate is flagged as:
- **Needs follow-up** when approved progress is 10 or more percentage points behind expected progress.
- **At risk** when it is 25 or more points behind.

Both thresholds can be changed in Settings.

---

## Security and privacy

- Passwords are hashed with **scrypt**. New passwords need at least 10 characters with letters and digits. Temporary passwords must be changed at first sign-in.
- Sessions use HttpOnly, SameSite cookies and expire after 12 hours. Every form is **CSRF**-protected.
- After 5 failed sign-ins, that account is locked for 10 minutes for the same address.
- **Role-based access**:
  - Candidates see only their own records.
  - Staff see the candidates they supervise.
  - Managers see everything.
- Strict security headers are set, including a Content Security Policy and a frame-ancestors restriction.
- **No patient names are stored.** Patient fields are limited to patient code, age and diagnosis category. Codes must contain digits, and the form warns users never to enter names.
- A full **audit trail** is kept and can be exported.
- Backups can be downloaded from the admin panel. You should also back up the `data/` folder regularly.

**For production:** run the app behind HTTPS, for example with IIS, Nginx or Caddy as a reverse proxy, and set `COOKIE_SECURE=1`. Keep `data/` out of public folders and back it up nightly.

---

## Hosting online + showing it on Google Sites

Google Sites cannot run Node.js. Instead, host the app on **Render.com**, then add it to your Google Site.

### 1. Put the code on GitHub
1. Sign in at https://github.com and click **New repository**.
2. Name it `andrology-logbook`, choose **Private**, and click **Create**.
3. Click **uploading an existing file**.
4. Drag in **everything inside** the `andrology-logbook` folder (not the `data` folder), then click **Commit changes**.

### 2. Deploy on Render (free)
1. Sign in at https://render.com with your GitHub account.
2. Click **New → Blueprint** and pick the `andrology-logbook` repository. Render reads `render.yaml` and sets everything up.
3. Click **Apply**. A few minutes later you get a link like `https://andrology-logbook.onrender.com`.

> **Free plan limits:** the app sleeps after 15 minutes without visitors, and the first visit afterwards takes about 30–50 seconds. **Data resets whenever it restarts**, so the free plan suits demos only. To keep data permanently, switch to the *Starter* plan with the 1 GB disk shown in `render.yaml` (about US$7/month + $0.25/GB) and set `DATA_DIR=/var/data`.

### 3. Add it to your Google Site
1. Open your site in the Google Sites editor.
2. Add the app in one or both ways:
   - **Button (recommended):** click **Insert → Button**, name it *Electronic Logbook*, and paste your Render link. It opens the app full-screen.
   - **Embedded:** click **Insert → Embed → By URL**, paste the Render link, choose **Whole page**, and resize the box to be large. When the app runs inside the site, an **"Open in new tab"** button appears. Safari and some privacy settings block sign-in inside embedded frames; that button solves it.
3. Click **Publish**.

The app accepts being embedded only by Google domains. To change that, set the `FRAME_ANCESTORS` environment variable.

---

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Database and uploads location |
| `DEMO` | `1` | Set `0` to skip demo data |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | Create an initial manager account |
| `COOKIE_SECURE` | — | Set `1` when served over HTTPS |
| `FRAME_ANCESTORS` | Google domains | Which sites may embed the app |

---

## Project structure

```
server.js              Entry point, startup checks, housekeeping timer
src/db.js              SQLite schema (users, candidates, staff, activity_types, activities,
                       activity_reviews, requirements, attachments, audit_logs, notifications, ...)
src/domain.js          Statuses, activity forms, progress & risk, notifications, audit
src/seed.js            Default categories and requirements, demo data
src/http.js            Router, sessions, CSRF, body / file-upload parsing, static files
src/ui.js              Layout, navigation, icons, UI components
src/charts.js          Server-rendered SVG charts
src/xlsx.js            Dependency-free Excel (.xlsx) writer
src/routes/            common (auth, profile, notifications), activities, candidate,
                       staff, admin, reports
public/                app.css (design system), app.js (small enhancements), favicon
data/                  Created at runtime: logbook.db and uploads/
```

## Ideas for later phases
QR-code lecture attendance, email/WhatsApp notifications through an SMTP or SMS gateway, calendar view, competency-based assessment forms, research milestone tracking and a department announcement board.
