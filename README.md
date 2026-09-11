# 🏋️ Iron Log — Workout Tracker

A clean, mobile-first workout logger. Organise training into **workout days** (named by
muscle groups), add **exercises** under each, and tap an exercise to see a **progress
graph**, log new entries, browse **history**, view an **illustration**, and find
**alternatives** when a machine is taken.

Static site — hostable on GitHub Pages. Data syncs to your own **Google Sheet** via the
Drive/Sheets API (scope `drive.file`: the app only ever touches the one file it creates).

## Features
- **Days → exercises**, exercises grouped & sorted by muscle (finishers last).
- Seeded with 4 default days (Chest & Triceps, Back & Biceps, Legs, Shoulders & Abs).
- Per exercise: **graph on top** (the day's average set over time inside a min–max band,
  points coloured by effort), **add-entry** form beside it (below on mobile), **history**
  (tap a row for every set + its note), **illustration**, and a **🔄 Find alternatives**
  button (same primary muscle).
- Each entry records **weight per set + effort (low/med/high) + note**, dated by the
  workout it was logged in.
- **lbs/kg** switchable (lbs default).
- Works offline (localStorage cache); syncs to Google Sheets when signed in.

## Data source
Exercise illustrations + muscle/equipment metadata: the open
[`free-exercise-db`](https://github.com/yuhonas/free-exercise-db) (public domain), served
via the jsDelivr CDN. One consistent source → consistent imagery.

## Run locally
ES modules need to be served over HTTP (not `file://`):

```bash
cd ironlog
npm start            # → python3 -m http.server 8000
# open http://localhost:8000
```

## Testing
**Automated smoke test** (jsdom — mounts the real modules, drives the UI, checks seeding,
muscle grouping, logging, the graph, persistence and CRUD):
```bash
npm install   # first time only (dev-installs jsdom)
npm test
```

**Manual — core app (no sign-in needed):** runs fully offline on localStorage.
1. `npm start`, open http://localhost:8000.
2. Open a day → tap an exercise → add an entry (weight per set + effort) → watch the graph
   update, history fill in, and the illustration load.
3. Try **🔄 Find alternatives**, add a day, add an exercise via search.

**Manual — mobile:** Chrome DevTools → device toolbar (`⌘⇧M`), test at **iPhone SE / 360px**.
Check: no horizontal scroll, single-column exercise view, tappable controls, header fits.
Or open `http://<your-LAN-ip>:8000` on your phone (same Wi-Fi). See the mobile checklist in
[`DESIGN.md`](./DESIGN.md).

**Manual — Google Sync:** add `http://localhost:8000` to the OAuth client's Authorized
JavaScript origins (Cloud Console) → **Sign in to sync** → confirm a sheet named *Iron Log
Workout Tracker* appears in your Drive and entries land in its `Entries` tab.

## Design system
[`DESIGN.md`](./DESIGN.md) is the source of truth for colors, type, spacing, breakpoints,
components, and the mobile checklist. All visual values are CSS custom properties in
`styles.css` — reference the tokens, don't hard-code.

## Deploy to GitHub Pages
1. Push to GitHub.
2. Settings → Pages → deploy from branch (`main`, root).
3. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add your
   Pages origin (e.g. `https://<user>.github.io`) to the OAuth client's **Authorized
   JavaScript origins**. (`http://localhost:8000` too, for local dev.)

The OAuth client ID lives in `js/config.js`.

## Project structure
```
index.html         shell + Chart.js
styles.css         dark, mobile-first
favicon.ico        16/32/48 fallback for the bare /favicon.ico request
site.webmanifest   name, theme colour and icon set (home-screen install)
icons/             icon.svg (tab) · apple-touch-icon.png (iOS) · 192/512 + maskable PNGs
                   *.svg are the sources; the PNGs are rendered from them
js/
  config.js        client id, scopes, CDN urls, constants
  defaults.js      the 4 seeded days (names only)
  exercise-db.js   free-exercise-db: load/cache, lookup, images, alternatives, search
  google.js        GIS auth + Sheets/Drive storage
  store.js         state, seeding, localStorage cache + cloud sync, CRUD
  chart.js         Chart.js wrapper (average set over time + min–max band)
  ui.js            hash router + views + modals
  app.js           bootstrap
```

See [`TECH-DEBT.md`](./TECH-DEBT.md) for intentional v1 simplifications (notably:
entries are single-value now, designed to extend to sets × reps later).
