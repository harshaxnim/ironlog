// App-wide configuration.
export const CONFIG = {
  // Google OAuth (extracted from the previous prototype).
  CLIENT_ID: '1087706410341-pm465l6is9nglqdrgp7ikfvnf3pf43pg.apps.googleusercontent.com',
  // drive.file = we can only see/create files this app made. Minimal, safe scope.
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  DISCOVERY_DOCS: [
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    'https://sheets.googleapis.com/$discovery/rest?version=v4',
  ],

  // The spreadsheet we look up / create by name (drive.file lets us find our own file by name).
  SPREADSHEET_NAME: 'Iron Log Workout Tracker',
  STRUCTURE_SHEET: 'Structure', // single JSON cell with days/exercises/settings
  ENTRIES_SHEET: 'Entries',     // tabular append-only log
  SESSIONS_SHEET: 'Sessions',   // one row per started workout day (date + checked exercises)

  // Exercise illustrations + metadata: free-exercise-db, served over jsDelivr CDN (no key).
  DB_JSON_URL: 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json',
  DB_IMAGE_BASE: 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/',

  DEFAULT_UNIT: 'lbs', // switchable in settings
  LS_KEY: 'ironlog.cache.v1',
};

// Compact date for axis ticks and list rows: "Sep 8", or "Sep 8, 2025" in another year.
export function fmtShort(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const opts = { month: 'short', day: 'numeric' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export const EFFORTS = [
  { id: 'low', label: 'Low', emoji: '🟢' },
  { id: 'medium', label: 'Medium', emoji: '🟡' },
  { id: 'high', label: 'High', emoji: '🔴' },
];
