# Baja75 Scoring Management System

**Use it online / install on Android:** https://leshii413.github.io/Baja75-Scoring/ · **Windows:** download `Baja75-Scoring-Windows-v1.1.0.zip` from this repo's Releases (or *Code › Download ZIP* and run `Start Baja75 Scoring.cmd`) · **Live timing:** [`live/`](live/README.md) · **Source code:** [`source/`](source/)

Race scoring and championship management for the **Baja75 Series** (BeamNG.drive / BeamMP). It reads the run logs written
by the **Baja75 Navigation Unit** (formerly Tread XL / TreadXLGPS), scores each race by class with your penalty rules and
the Baja75 points table, and adds finalized races up into class championships.

One React + TypeScript app (Vite), installable as a Progressive Web App on **Windows 11** and **Android**, working
offline, with its data in the browser's IndexedDB. Scores are calculated by plain code: no AI service is used at runtime.

Created by **Leshii413 | Baja75 Series** · https://www.patreon.com/c/Baja75Series · Licensed [CC BY-NC-SA 4.0](LICENSE.md).

> This program is separate from the Navigation Unit mod: it lives in `scorer/`, which the mod's packager never ships.

## Windows 11: run it (no install, no Node)

1. Unzip `Baja75-Scoring-Windows-v1.1.0.zip` anywhere (e.g. `Documents\Baja75 Scoring`).
2. Double-click **`Start Baja75 Scoring.cmd`**. A small window opens (the local web server, this computer only) and the app
   opens in your browser at `http://localhost:7575/`.
3. In **Microsoft Edge**: `…` menu › **Apps** › **Install this site as an app** (or the install icon in the address bar).
   It then has its own window and Start-menu entry, and opens even when the small server window is closed.
4. Keep using the same address (`http://localhost:7575/`): the browser keeps your data per address.

If Windows SmartScreen asks about the `.cmd` file, choose *More info › Run anyway* (it only runs `serve.ps1` from the same
folder; read it first if you like).

## Android

A phone can only install the app from an **https://** address. Put the contents of the `app` folder on any static HTTPS
host, then on the phone open that address in Chrome › **⋮** › **Add to Home screen** › **Install**. Free options:

- **Netlify Drop** (app.netlify.com/drop) or **Cloudflare Pages**: drag the `app` folder in.
- **GitHub Pages**: a public repository (or a paid plan for a private one) with the `app` folder's files.

The built app uses relative paths, so it works from a sub-folder too. A plain `http://192.168.x.x` address on your
network will open but can't be installed or work offline: that's a browser rule, not an app limit.

**Moving data between devices:** Settings / Backup › **Download backup** on one device, **Restore** on the other. The
backup file is the same on Windows and Android. Devices don't sync by themselves.

## Developers

- Node.js **^20.19.0 or ≥ 22.12.0** (what Vite 8 needs). Versions are pinned in `package-lock.json`.
- `npm ci` · `npm run dev` (development server) · `npm test` (scoring engine tests) · `npm run build` (type check + production build into `dist/`) · `npm run preview` (serves `dist/` on http://localhost:4175).
- Browser workflow test (Python + Playwright, Chromium): `npm run build && npm run preview &` then `python3 tests/e2e.py http://localhost:4175/`.
- Release zips: `python3 tools/release.py` → `release/Baja75-Scoring-Windows-v1.1.0.zip` (app + launcher + guide) and `release/Baja75-Scoring-source-v1.1.0.zip`.

| Folder | What |
|---|---|
| `src/domain/` | All scoring logic as pure functions: time parsing, the run-log parser, times JSON and CSV readers, penalties, classes and vehicle mapping, ranking, points, finalize / amend, championship, backup, CSV export. No React. |
| `src/store/` | IndexedDB storage (`idb`), one transaction per change, and the React store. |
| `src/screens/`, `src/ui/` | The screens: Dashboard, Races, race event page, Import Data, Penalties, Classes & Vehicles, Drivers, Overall Score, Settings / Backup. |
| `fixtures/` | Sample run logs, a times file, expected values (see `fixtures/README.md`). |
| `tests/e2e.py` | The browser workflow test. |
| `windows/` | `Start Baja75 Scoring.cmd` + `serve.ps1`, the Windows launcher. |

Libraries: React 19, idb 8, Vite 8, vite-plugin-pwa 2 (Workbox), TypeScript 5.9, Vitest 5.

## What's done, and what isn't (yet)

Done in v1.0.0: import (file picker, drag and drop, paste, several files at once) of the run log, times JSON and the manual
CSV template, with per-file / per-row driver and event assignment, duplicate detection and held revisions; the 14 Baja75
classes and vehicle mapping (template + per event, conflicts); penalty rules 0–9999 s per occurrence (template + per event),
waivers, corrected counts, manual penalties; selected-attempt and best-adjusted-attempt events; FINISHED / DNF / DNS / DSQ;
class ranks and points by adjusted time with shared ties; overall placement and raw-time order (information only); Total
Points; finalize, amendments with revisions; Overall Score by class with include / exclude and draft preview; JSON
backup / restore (merge or replace), CSV exports (results, penalties, championship), print views; offline PWA; phone layouts.

Added in v1.0.1: **overrides** for changing or deleting seasons, results (runs, race events, reverting a finalized event to draft) and drivers: type OVERRIDE, give a reason, then a 5 second wait; every override is recorded in the change history. A **logo** setting (Settings / Backup › Logo). The **license** notice (Settings / Backup › License).

Added in v1.0.2: **Paste results from Discord** (Import Data): results a BeamJoy Revived server posts to Discord import
as they are, one post or many; the server name is kept as a note. **No Data Provided**: values a source doesn't have
(Discord posts have no race number, map or penalty counts; the CSV template accepts the words in any cell) still give a
valid, scored result (penalty counts 0), marked **MANUAL REVIEW** with *Mark as reviewed*; a missing time must be
entered before finalizing. A ChatGPT prompt for converting Discord posts to the CSV template: `CHATGPT_DISCORD_TEMPLATE.md`.

Added in v1.0.3: **Presets**: three presets each of the **Rule Sheet** (points, non-finish points, default event format),
**Penalty Sheet** (penalty rules) and **Class Sheet** (classes and vehicle mappings). Each race event records the Rule and
Penalty Sheet it uses (chosen in Event settings); finalized results record the sheets they were scored with. The
**Dashboard** shows the sheets in use, season stats and every race event's sheets.

Added in v1.1.0: **Live**: live race timing from the BeamMP server (positions every 3 s, race time, penalty counts,
resets) on a route map with each car's last known position, with penalty estimates from a Penalty Sheet; the same live
results as an embed for your website. Server plugin, client bridge mod and the Cloudflare relay are in `live/`
(setup: `live/README.md`).

Not in this version:

- **Live sync between devices.** Each device has its own data; move it with the backup file. A shared server would be needed.
- **Watching the BeamNG folder.** The app reads files you pick, drop or paste; it can't watch a folder by itself.
- **Aggregate multi-stage / lap events.** Each event scores one selected (or best) run per driver and class.
- **A Windows .exe installer or an Android APK.** Installation is the browser's "install app" (PWA).
- **Automatic result imports from the live relay**: live data is shown, but official results are still imported from run logs or Discord posts.
