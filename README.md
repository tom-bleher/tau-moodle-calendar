# TAU Moodle Calendar — Apple & Google Sync + Problem Set Tracker

Sync Tel Aviv University (`moodle.tau.ac.il`) deadlines to **Apple Calendar** and **Google Calendar** with live **problem set completion tracking** — without ever entering or storing your TAU password.

## Features

- **Zero TAU Passwords**: Uses Moodle's official iCal export link (`calendar/export_execute.php`) encrypted at rest with AES-256-GCM, plus a 1-click **Bookmarklet** and optional **Chrome/Edge Extension** (`extension/`) that run inside your own authenticated Moodle browser session.
- **Automatic + Manual Problem Set Completion**:
  - Automatically detects submission status from TAU Moodle (`Submitted`, `Graded`, `Draft`, `Not Submitted`) across both Hebrew and English interfaces.
  - Instant 1-click status toggles (`Not Completed` / `In Progress` / `Completed`), personal notes, and custom external problem sets (Gradescope / paper HW).
  - Smart TAU Hebrew & English classifier distinguishes problem sets (`תרגיל בית`, `מטלה`, `בוחן`, `HW`, `Problem Set`) from recitations (`תרגול`) and lectures (`הרצאה`).
- **Clear Status Directly in Your Calendar**:
  - Customizable titles in English or Hebrew, e.g. `✅ [מבוא לאלגוריתמים] תרגיל בית 1 — Completed`, `⬜ [מבני נתונים] תרגיל בית 2 — Not Completed`, `🔴 [אלגברה לינארית] תרגיל בית 3 — Overdue`.
  - Automatically **mutes calendar reminders (`VALARM`)** for problem sets you already completed.
  - Expands 0-minute Moodle due dates into clean visible calendar blocks (configurable 0/15/30/60 min).
- **Apple & Google Calendar First-Class**:
  - **Apple Calendar**: 1-tap `webcal://` subscription with `Asia/Jerusalem` timezone and iCloud sync.
  - **Google Calendar**: Both 1-click URL subscription **and** a generated 15-minute **Color-Coded Google Apps Script** (Green = Completed, Orange = Pending, Yellow = In Progress, Red = Overdue, Blue = Lectures).
- **Bilingual UI**: English & Hebrew (RTL) interface.

## Local Development

```bash
npm install
npx wrangler d1 migrations apply tau-moodle-calendar --local
npm run dev
```

Open the local URL printed by Vite (e.g. `http://localhost:5173`) and click **Try Live TAU Demo** or connect your real TAU Moodle!

## Running Tests & Typecheck

```bash
npm test
npm run build
```

## Deploy to Cloudflare Workers (Free Tier)

1. Create a D1 database and put its `database_id` into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create tau-moodle-calendar
   npx wrangler d1 migrations apply tau-moodle-calendar --remote
   ```
2. Set your encryption secret:
   ```bash
   npx wrangler secret put ENCRYPTION_SECRET
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
