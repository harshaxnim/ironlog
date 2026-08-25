// Single source of truth for app state, with localStorage cache + Google Sheets sync.
import { CONFIG } from './config.js';
import { DEFAULT_DAYS } from './defaults.js';
import * as G from './google.js';

const STRUCTURE_VERSION = 1;

function uid() {
  return (crypto?.randomUUID?.() || ('id-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
}
function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }
// LOCAL calendar date (not UTC). Must match the UI's date logic, or "done" detection —
// which compares an entry's date to the session's date — silently breaks across timezones.
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const state = {
  settings: { unit: CONFIG.DEFAULT_UNIT },
  days: [],        // [{id, name, muscles[], exercises:[{id,name,muscle,db,finisher,reps[],note}]}]
  entries: [],     // [{id, exId, date, weight, unit, effort, note, createdAt}]
  sessions: [],    // [{id, dayId, date, status, done[], note, startedAt, endedAt, lastModified}]
  // Sync bookkeeping. `pristine` = local holds only seeded defaults the user never touched
  // (so remote must win on first sign-in, never the reverse). `structUpdatedAt` timestamps
  // the days/settings blob for newer-wins. `tombstones` record deletions so a pull can't
  // resurrect them: { entries:{id:deletedAtMs}, sessions:{id:deletedAtMs} }.
  meta: { pristine: false, structUpdatedAt: 0, tombstones: { entries: {}, sessions: {} } },
  syncing: false,
  lastError: null,
};

// Any genuine user action makes local no longer pristine (its data may now be ahead of cloud).
function touch() { state.meta.pristine = false; }
// A structural (days/settings) edit also bumps the blob's timestamp for newer-wins merges.
function touchStructure() { state.meta.pristine = false; state.meta.structUpdatedAt = nowMs(); }
function tombstoneEntry(id) { state.meta.tombstones.entries[id] = nowMs(); }
function tombstoneSession(id) { state.meta.tombstones.sessions[id] = nowMs(); }

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of subs) fn(state); }

export function getState() { return state; }

// Re-render without mutating/persisting (e.g. after the exercise DB finishes loading).
export function refresh() { notify(); }

// --- seeding --------------------------------------------------------------
// Top set = the heaviest weight across a set-vector (drives the graph line + back-compat).
export function topSet(weights) {
  const nums = (weights || []).filter((w) => typeof w === 'number' && !Number.isNaN(w));
  return nums.length ? Math.max(...nums) : null;
}

// Builds the default days AND their baseline entries (seeded a day back so today's
// workout doesn't start pre-marked as done).
function buildDefaults() {
  const days = [];
  const entries = [];
  const baseDate = todayISO(new Date(Date.now() - 86400000));
  for (const d of DEFAULT_DAYS) {
    const day = { id: uid(), name: d.name, muscles: d.muscles.slice(), exercises: [] };
    for (const e of d.exercises) {
      const exId = uid();
      day.exercises.push({
        id: exId, name: e.name, muscle: e.muscle, db: e.db || null,
        finisher: !!e.finisher, reps: (e.reps || []).slice(), note: e.note || '',
      });
      if (e.seed && e.seed.length) {
        const weights = e.seed.map((w) => (w == null || w === '' ? null : Number(w)));
        entries.push({
          id: uid(), exId, date: baseDate, weights, weight: topSet(weights),
          unit: state.settings.unit, effort: e.effort || 'medium', note: '', createdAt: nowISO(),
          seed: true, // sample data — dropped (not merged) the first time we sync to a populated cloud
        });
      }
    }
    days.push(day);
  }
  return { days, entries };
}

// --- local cache ----------------------------------------------------------
function saveLocal() {
  try {
    localStorage.setItem(CONFIG.LS_KEY, JSON.stringify({
      settings: state.settings, days: state.days,
      entries: state.entries, sessions: state.sessions, meta: state.meta,
    }));
  } catch { /* quota — non-fatal */ }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(CONFIG.LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.settings) state.settings = data.settings;
    if (Array.isArray(data.days)) state.days = data.days;
    if (Array.isArray(data.entries)) state.entries = data.entries;
    if (Array.isArray(data.sessions)) state.sessions = data.sessions;
    if (data.meta) {
      // Migrate older caches that predate sync bookkeeping: existing real data is NOT
      // pristine, so it must never be silently replaced by the cloud copy.
      state.meta = {
        pristine: !!data.meta.pristine,
        structUpdatedAt: data.meta.structUpdatedAt || 0,
        tombstones: {
          entries: data.meta.tombstones?.entries || {},
          sessions: data.meta.tombstones?.sessions || {},
        },
      };
    }
    return true;
  } catch { return false; }
}

// First load: hydrate from cache, else seed defaults. (Cloud sync happens on sign-in.)
export function init() {
  const had = loadLocal();
  if (!had || !state.days.length) {
    const seeded = buildDefaults();
    state.days = seeded.days;
    if (!state.entries.length) state.entries = seeded.entries;
    // Freshly seeded data is pristine: a first sign-in must adopt the cloud copy (if any),
    // never push these defaults over real cloud data.
    state.meta = { pristine: true, structUpdatedAt: 0, tombstones: { entries: {}, sessions: {} } };
    saveLocal();
  }
  // Recover any sets stranded without a workout (legacy data) so they show in History.
  if (healOrphanEntries()) saveLocal();
  notify();
}

// --- cloud sync -----------------------------------------------------------
// The Structure cell carries the editable tree PLUS sync bookkeeping (a blob timestamp and
// the tombstone sets) so deletions and "who's newer" survive a round-trip through the sheet.
function structureBlob() {
  return {
    version: STRUCTURE_VERSION,
    settings: state.settings,
    days: state.days,
    updatedAt: state.meta.structUpdatedAt,
    tombstones: state.meta.tombstones,
  };
}

// --- merge primitives (pure — unit-tested against the three sync invariants) ---
const entryTs = (e) => Date.parse(e?.createdAt || '') || 0;       // entries are immutable → createdAt
const sessionTs = (s) => s?.lastModified || Date.parse(s?.endedAt || s?.startedAt || '') || 0;

function mergeTombstones(a, b) {
  const out = { entries: { ...(a?.entries || {}) }, sessions: { ...(a?.sessions || {}) } };
  for (const kind of ['entries', 'sessions']) {
    const src = b?.[kind] || {};
    for (const id in src) out[kind][id] = Math.max(out[kind][id] || 0, src[id] || 0);
  }
  return out;
}

// Do two record lists hold the same records at the same versions? (id + timestamp identity).
function sameSet(a, b, tsOf) {
  if (a.length !== b.length) return false;
  const key = (r) => r.id + '@' + tsOf(r);
  const sa = new Set(a.map(key));
  for (const r of b) if (!sa.has(key(r))) return false;
  return true;
}

// Union two record lists by id (newer timestamp wins on collision), then drop anything
// that's been tombstoned. ids are UUIDs, so a tombstoned id is gone for good.
function mergeById(local, remote, tsOf, tomb) {
  const byId = new Map();
  for (const r of remote || []) if (r && r.id) byId.set(r.id, r);
  for (const r of local || []) {
    if (!r || !r.id) continue;
    const ex = byId.get(r.id);
    if (!ex || tsOf(r) >= tsOf(ex)) byId.set(r.id, r);
  }
  return [...byId.values()].filter((r) => !tomb[r.id]);
}

// Consolidate local state with a cloud snapshot. PURE: no I/O, no mutation of inputs.
//   local  = { days, settings, entries, sessions, meta }
//   remote = { structure:{days,settings,updatedAt,tombstones}|null, entries:[], sessions:[] }
// Returns the merged { days, settings, entries, sessions, meta }.
export function consolidate(local, remote) {
  const lmeta = local.meta || { pristine: false, structUpdatedAt: 0, tombstones: {} };
  const rStruct = remote.structure || null;
  const rEntries = remote.entries || [];
  const rSessions = remote.sessions || [];

  const tombstones = mergeTombstones(lmeta.tombstones, rStruct?.tombstones);
  const remoteHasStructure = !!(rStruct && Array.isArray(rStruct.days) && rStruct.days.length);

  let days = local.days;
  let settings = local.settings;
  let structUpdatedAt = lmeta.structUpdatedAt || 0;
  let pristine = lmeta.pristine;
  let entries, sessions;

  if (lmeta.pristine) {
    // Local is just seeded defaults — adopt the cloud copy wholesale wherever it has data.
    if (remoteHasStructure) {
      days = rStruct.days;
      if (rStruct.settings) settings = rStruct.settings;
      structUpdatedAt = rStruct.updatedAt || 0;
      pristine = false; // we now hold real cloud data
    }
    // If we just adopted the cloud's days, our seeded sample entries belong to the now-discarded
    // seed days — drop them so they don't linger as orphans.
    const localKept = remoteHasStructure ? local.entries.filter((e) => !e.seed) : local.entries;
    entries = rEntries.length ? rEntries.filter((e) => !tombstones.entries[e.id]) : localKept;
    sessions = rSessions.length ? rSessions.filter((s) => !tombstones.sessions[s.id]) : local.sessions;
  } else {
    // Both sides may hold real edits — consolidate per record, newer wins, tombstones exclude.
    // Drop never-touched seed samples once the cloud has real entries (don't pollute it).
    const localEntries = rEntries.length ? local.entries.filter((e) => !e.seed) : local.entries;
    entries = mergeById(localEntries, rEntries, entryTs, tombstones.entries);
    sessions = mergeById(local.sessions, rSessions, sessionTs, tombstones.sessions);
    // Days/settings are a single blob: newer timestamp wins (ties favour the local copy).
    const rUpd = rStruct?.updatedAt || 0;
    if (remoteHasStructure && rUpd > structUpdatedAt) {
      days = rStruct.days;
      if (rStruct.settings) settings = rStruct.settings;
      structUpdatedAt = rUpd;
    }
  }

  // What actually diverged from the cloud snapshot — so a pull that changes nothing doesn't
  // trigger a (non-atomic) clear-then-rewrite of the cloud on every app open.
  const remoteTomb = rStruct?.tombstones || { entries: {}, sessions: {} };
  const dirty = {
    entries: !sameSet(entries, rEntries, entryTs),
    sessions: !sameSet(sessions, rSessions, sessionTs),
    structure: !remoteHasStructure
      || structUpdatedAt !== (rStruct?.updatedAt || 0)
      || JSON.stringify(tombstones) !== JSON.stringify(remoteTomb),
  };

  return { days, settings, entries, sessions, meta: { pristine, structUpdatedAt, tombstones }, dirty };
}

// Bidirectional consolidation core. ALWAYS reads the cloud and merges (so neither direction
// can blind-overwrite the other side's data); `push` decides whether the merged result is also
// written back up to the cloud.
//   - "Sync down" (push:false) refreshes local from the cloud without touching the cloud.
//   - "Sync up"   (push:true)  consolidates and uploads local changes to the cloud.
async function syncCore({ push }) {
  state.syncing = true; state.lastError = null; notify();
  try {
    // Read the full cloud snapshot, then consolidate locally — never a blind overwrite.
    const [structure, rEntries, rSessions] = await Promise.all([
      G.readStructure(), G.readEntries(), G.readSessions(),
    ]);
    const merged = consolidate(
      { days: state.days, settings: state.settings, entries: state.entries, sessions: state.sessions, meta: state.meta },
      { structure, entries: rEntries, sessions: rSessions },
    );
    state.days = merged.days;
    state.settings = merged.settings;
    state.entries = merged.entries;
    state.sessions = merged.sessions;
    state.meta = merged.meta;
    // Recover sets stranded without a workout once the cloud copy is merged in. This may add
    // sessions and stamp sessionIds onto entries, so both collections then need pushing.
    const healed = healOrphanEntries();
    saveLocal();

    // Push back ONLY what diverged so the cloud converges on the merged truth (incl.
    // tombstones). Skipping unchanged collections avoids a needless clear-then-rewrite —
    // and its data-loss window.
    if (push && G.isSignedIn()) {
      if (merged.dirty.structure) await G.writeStructure(structureBlob());
      if (merged.dirty.entries || healed) await G.rewriteEntries(state.entries);
      if (merged.dirty.sessions || healed) await G.rewriteSessions(state.sessions);
    }
  } catch (err) {
    state.lastError = humanError(err);
  } finally {
    state.syncing = false; notify();
  }
}

// On sign-in/bootstrap we want a full two-way reconciliation (pull + push the merge).
export async function pullFromCloud() { return syncCore({ push: true }); }

// Manual "Sync down": pull the cloud into local and consolidate — does NOT write to the cloud.
export async function syncDown() {
  if (!G.isSignedIn()) { state.lastError = 'Sign in first to sync.'; notify(); return; }
  return syncCore({ push: false });
}

// Manual "Sync up": consolidate, then upload local changes to the cloud (reads first so a stale
// local copy can't wipe cloud-only data).
export async function syncUp() {
  if (!G.isSignedIn()) { state.lastError = 'Sign in first to sync.'; notify(); return; }
  return syncCore({ push: true });
}

// Wipe local data and re-seed the default days + baseline weight entries.
export async function resetToDefaults() {
  const seeded = buildDefaults();
  state.days = seeded.days;
  state.entries = seeded.entries;
  state.sessions = [];
  // An explicit reset is a deliberate user action that must win over the cloud: mark it
  // non-pristine and freshly timestamped so the pushed defaults overwrite remote.
  state.meta = { pristine: false, structUpdatedAt: nowMs(), tombstones: { entries: {}, sessions: {} } };
  saveLocal(); notify();
  if (G.isSignedIn()) {
    state.syncing = true; notify();
    try {
      await G.writeStructure(structureBlob());
      await G.rewriteEntries(state.entries);
      await G.rewriteSessions(state.sessions);
    } catch (err) { state.lastError = humanError(err); }
    finally { state.syncing = false; notify(); }
  }
}


async function pushSessions() {
  saveLocal();
  if (!G.isSignedIn()) return;
  state.syncing = true; notify();
  try { await G.rewriteSessions(state.sessions); }
  catch (err) { state.lastError = humanError(err); }
  finally { state.syncing = false; notify(); }
}

async function pushStructure() {
  touchStructure(); // a structural edit makes local authoritative + bumps the blob timestamp
  saveLocal();
  if (!G.isSignedIn()) return;
  state.syncing = true; notify();
  try { await G.writeStructure(structureBlob()); }
  catch (err) { state.lastError = humanError(err); }
  finally { state.syncing = false; notify(); }
}

function humanError(err) {
  return err?.result?.error?.message || err?.message || 'Sync error';
}

// --- structural mutations -------------------------------------------------
export function addDay(name, muscles = []) {
  const day = { id: uid(), name: name || 'New Day', muscles, exercises: [] };
  state.days.push(day);
  pushStructure(); notify();
  return day;
}
export function renameDay(dayId, name) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  d.name = name; pushStructure(); notify();
}
export function updateDay(dayId, { name, muscles }) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  if (name != null) d.name = name;
  if (Array.isArray(muscles)) d.muscles = muscles;
  pushStructure(); notify();
}
export function setDayMuscles(dayId, muscles) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  d.muscles = muscles; pushStructure(); notify();
}
export function deleteDay(dayId) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  const exIds = new Set(d.exercises.map((e) => e.id));
  state.days = state.days.filter((x) => x.id !== dayId);
  for (const e of state.entries) if (exIds.has(e.exId)) tombstoneEntry(e.id);
  state.entries = state.entries.filter((e) => !exIds.has(e.exId));
  pushStructure(); // also persists the tombstones (they live in the structure blob)
  if (G.isSignedIn()) G.rewriteEntries(state.entries).catch((err) => { state.lastError = humanError(err); notify(); });
  notify();
}

export function addExercise(dayId, { name, muscle, db = null, finisher = false, reps = [], note = '' }) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return null;
  // `note` = persistent setup cues (seat height, pin, grip) — distinct from a per-entry note.
  const e = { id: uid(), name, muscle, db, finisher, reps, note };
  d.exercises.push(e);
  pushStructure(); notify();
  return e;
}
// `silent` persists (local + cloud) without re-rendering. Used by the setup-notes field on the
// log page: a blur-save that rebuilt the screen could swallow the very next tap ("Add entry").
export function updateExercise(dayId, exId, patch, { silent = false } = {}) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  const e = d.exercises.find((x) => x.id === exId); if (!e) return;
  Object.assign(e, patch);
  pushStructure();
  if (!silent) notify();
}
export function deleteExercise(dayId, exId) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  d.exercises = d.exercises.filter((x) => x.id !== exId);
  for (const e of state.entries) if (e.exId === exId) tombstoneEntry(e.id);
  state.entries = state.entries.filter((e) => e.exId !== exId);
  pushStructure(); // also persists the tombstones (they live in the structure blob)
  if (G.isSignedIn()) G.rewriteEntries(state.entries).catch((err) => { state.lastError = humanError(err); notify(); });
  notify();
}

export function setUnit(unit) {
  state.settings.unit = unit;
  pushStructure(); notify();
}

// --- entries --------------------------------------------------------------
export async function addEntry(exId, { weights, weight, effort, date, note = '', sessionId = '' }) {
  // Accept a per-set vector; fall back to a single weight for back-compat.
  let arr = Array.isArray(weights)
    ? weights.map((w) => (w === '' || w == null ? null : Number(w)))
    : null;
  if (!arr && weight != null && weight !== '') arr = [Number(weight)];
  arr = arr || [];
  const entry = {
    id: uid(), exId,
    date: date || todayISO(),
    weights: arr,
    weight: topSet(arr), // top set drives the progression line + done/back-compat
    unit: state.settings.unit, effort: effort || '', note,
    createdAt: nowISO(),
    // Every logged set is bound to its workout session, so it can never be orphaned by a
    // date mismatch or a lost session record.
    sessionId: sessionId || '',
  };
  state.entries.push(entry);
  touch(); // a logged entry is real user data — local is no longer pristine
  saveLocal(); notify();
  if (G.isSignedIn()) {
    try { await G.appendEntry(entry); }
    catch (err) { state.lastError = humanError(err); notify(); }
  }
  return entry;
}

export async function deleteEntry(entryId) {
  state.entries = state.entries.filter((e) => e.id !== entryId);
  tombstoneEntry(entryId); // record the delete so a later pull can't resurrect it
  touch();
  saveLocal(); notify();
  if (G.isSignedIn()) {
    state.syncing = true; notify();
    try {
      await G.writeStructure(structureBlob()); // persist the tombstone (lives in the structure blob)
      await G.rewriteEntries(state.entries);
    } catch (err) { state.lastError = humanError(err); }
    finally { state.syncing = false; notify(); }
  }
}

// --- sessions (a started workout day on a date) ---------------------------
// Immutable copy of a day's exercises at the moment a workout starts.
function snapshotDay(day) {
  return {
    name: day.name,
    muscles: day.muscles.slice(),
    exercises: day.exercises.map((e) => ({
      id: e.id, name: e.name, muscle: e.muscle, db: e.db, finisher: !!e.finisher,
      reps: (e.reps || []).slice(),
    })),
  };
}

// Recover sets that have no workout to live under (logged before sets were bound to a session,
// or stranded by an old sync bug). For each group of such sets we (re)create an ended session
// and bind the sets to it, so every set is associated with a session and shows in History.
// Idempotent: once a covering session exists, nothing is reconstructed for it again.
function healOrphanEntries() {
  const sessionsById = new Map(state.sessions.map((s) => [s.id, s]));
  const covered = new Set(state.sessions.map((s) => s.dayId + '|' + s.date));
  const tombSessions = state.meta.tombstones.sessions || {};

  const groups = new Map(); // key -> { id, day, date, exIds:Set, entries:[], min, max }
  const add = (key, id, day, e) => {
    let g = groups.get(key);
    if (!g) { g = { id, day, date: e.date, exIds: new Set(), entries: [], min: e.createdAt || '', max: e.createdAt || '' }; groups.set(key, g); }
    g.exIds.add(e.exId); g.entries.push(e);
    if ((e.date || '') < (g.date || '')) g.date = e.date; // session date = earliest set's date
    if ((e.createdAt || '') < g.min) g.min = e.createdAt || '';
    if ((e.createdAt || '') > g.max) g.max = e.createdAt || '';
  };

  for (const e of state.entries) {
    if (e.seed) continue;                       // sample data is not a real workout
    const found = findExercise(e.exId);
    if (!found) continue;                        // its exercise no longer exists — can't anchor it
    const day = found.day;
    if (e.sessionId) {
      if (sessionsById.has(e.sessionId)) continue;   // session is present — not orphaned
      if (tombSessions[e.sessionId]) continue;        // session was deliberately deleted
      add('sid:' + e.sessionId, e.sessionId, day, e); // rebuild the lost session under its own id
    } else {
      const dayKey = day.id + '|' + e.date;
      if (covered.has(dayKey)) continue;              // a session already covers this day+date
      const reconId = 'recon-' + day.id + '-' + e.date; // deterministic → no cross-device dupes
      if (tombSessions[reconId]) continue;            // a prior reconstruction was deleted
      add('recon:' + dayKey, reconId, day, e);
    }
  }
  if (!groups.size) return false;

  for (const g of groups.values()) {
    const s = {
      id: g.id, dayId: g.day.id, date: g.date, status: 'ended',
      done: [...g.exIds], note: '',
      startedAt: g.min || nowISO(), endedAt: g.max || nowISO(),
      snapshot: snapshotDay(g.day), lastModified: nowMs(), reconstructed: true,
    };
    state.sessions.push(s);
    for (const e of g.entries) e.sessionId = s.id; // bind the orphaned sets to it
  }
  touch();
  return true;
}

// Start a day. Resumes an existing active session for the same day+date if present.
export function startSession(dayId, date) {
  date = date || todayISO();
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return null;
  let s = state.sessions.find((x) => x.dayId === dayId && x.date === date && x.status !== 'ended');
  if (!s) {
    s = { id: uid(), dayId, date, status: 'active', done: [], note: '',
          startedAt: nowISO(), endedAt: '', snapshot: snapshotDay(day), lastModified: nowMs() };
    state.sessions.push(s);
    touch();
    // Persist to the cloud IMMEDIATELY, not just on "End Day". Entries push the moment they're
    // logged, so if the session only lived locally a sync/reinstall would strand those entries
    // with no workout to show them under. pushSessions saves locally first, then syncs.
    pushSessions();
    notify();
  }
  return s;
}

export function getSession(id) { return state.sessions.find((s) => s.id === id); }

// The exercise list to show for a session: its frozen snapshot, falling back to the
// live day template for sessions created before snapshots existed.
export function sessionDay(session) {
  if (session?.snapshot && Array.isArray(session.snapshot.exercises)) return session.snapshot;
  return state.days.find((d) => d.id === session?.dayId) || null;
}

// "Done" is derived, not manual: an exercise counts as done in a session once a weight
// has been logged for it on the session's date. Ended sessions keep a frozen `done` list.
export function sessionDoneIds(session) {
  if (!session) return [];
  if (session.status === 'ended') return session.done || [];
  const day = sessionDay(session);
  if (!day) return [];
  return day.exercises
    .filter((e) => state.entries.some((en) => en.exId === e.id &&
      // Prefer the explicit session link; fall back to date match for pre-association entries.
      (en.sessionId ? en.sessionId === session.id : en.date === session.date)))
    .map((e) => e.id);
}

export function setSessionNote(sessionId, note) {
  const s = getSession(sessionId); if (!s) return;
  s.note = note; s.lastModified = nowMs(); touch(); pushSessions(); notify();
}

// "Machine taken" — swap an exercise to a different movement for THIS workout only.
// Updates the session's snapshot (keeps the same slot id so logging/done still line up).
export function swapSessionExercise(sessionId, exId, { name, db }) {
  const s = getSession(sessionId);
  if (!s || !s.snapshot) return;
  const e = s.snapshot.exercises.find((x) => x.id === exId);
  if (!e) return;
  if (name != null) e.name = name;
  if (db !== undefined) e.db = db;
  s.lastModified = nowMs(); touch(); pushSessions(); notify();
}

// End the day → freeze the derived done-list, mark ended, and PUSH to the Google Sheet.
export async function endSession(sessionId) {
  const s = getSession(sessionId); if (!s) return;
  s.done = sessionDoneIds(s); // snapshot what was logged while the day was active
  s.status = 'ended'; s.endedAt = nowISO(); s.lastModified = nowMs();
  touch();
  await pushSessions();
}

export function reopenSession(sessionId) {
  const s = getSession(sessionId); if (!s) return;
  s.status = 'active'; s.endedAt = ''; s.lastModified = nowMs();
  touch(); saveLocal(); notify();
}

export async function deleteSession(sessionId) {
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  tombstoneSession(sessionId); // record the delete so a later pull can't resurrect it
  touch();
  await pushSessions();
  if (G.isSignedIn()) {
    try { await G.writeStructure(structureBlob()); } // persist the tombstone
    catch (err) { state.lastError = humanError(err); notify(); }
  }
}

export function sessionsForDate(date) {
  return state.sessions.filter((s) => s.date === date);
}

// Map of date -> 'ended' | 'active' for calendar marks (ended wins if both exist).
export function sessionStatusByDate() {
  const m = new Map();
  for (const s of state.sessions) {
    if (s.status === 'ended' || !m.has(s.date)) m.set(s.date, s.status);
  }
  return m;
}

// Entries for one exercise, sorted oldest -> newest (graph + history order).
export function entriesFor(exId) {
  return state.entries
    .filter((e) => e.exId === exId)
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
}

export function findExercise(exId) {
  for (const d of state.days) {
    const e = d.exercises.find((x) => x.id === exId);
    if (e) return { day: d, exercise: e };
  }
  return null;
}

// Exercises of a day grouped by muscle, finishers last. Returns [{muscle, items[]}].
export function groupedExercises(day) {
  const order = [];
  const groups = new Map();
  const add = (key, e) => {
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(e);
  };
  for (const e of day.exercises) if (!e.finisher) add(e.muscle || 'Other', e);
  const finishers = day.exercises.filter((e) => e.finisher);
  // Honour the day's declared muscle order first.
  order.sort((a, b) => {
    const ia = day.muscles.indexOf(a), ib = day.muscles.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const result = order.map((m) => ({ muscle: m, items: groups.get(m) }));
  if (finishers.length) result.push({ muscle: 'Finishers', items: finishers });
  return result;
}
