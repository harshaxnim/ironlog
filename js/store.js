// Single source of truth for app state, with localStorage cache + Google Sheets sync.
import { CONFIG } from './config.js';
import { DEFAULT_DAYS } from './defaults.js';
import * as G from './google.js';

const STRUCTURE_VERSION = 1;

function uid() {
  return (crypto?.randomUUID?.() || ('id-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
}
function nowISO() { return new Date().toISOString(); }
// LOCAL calendar date (not UTC). Must match the UI's date logic, or "done" detection —
// which compares an entry's date to the session's date — silently breaks across timezones.
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const state = {
  settings: { unit: CONFIG.DEFAULT_UNIT },
  days: [],        // [{id, name, muscles[], exercises:[{id,name,muscle,db,finisher}]}]
  entries: [],     // [{id, exId, date, weight, unit, effort, note, createdAt}]
  sessions: [],    // [{id, dayId, date, status, done[], note, startedAt, endedAt}]
  syncing: false,
  lastError: null,
};

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
        finisher: !!e.finisher, reps: (e.reps || []).slice(),
      });
      if (e.seed && e.seed.length) {
        const weights = e.seed.map((w) => (w == null || w === '' ? null : Number(w)));
        entries.push({
          id: uid(), exId, date: baseDate, weights, weight: topSet(weights),
          unit: state.settings.unit, effort: e.effort || 'medium', note: '', createdAt: nowISO(),
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
      entries: state.entries, sessions: state.sessions,
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
    saveLocal();
  }
  notify();
}

// --- cloud sync -----------------------------------------------------------
function structureBlob() {
  return { version: STRUCTURE_VERSION, settings: state.settings, days: state.days };
}

export async function pullFromCloud() {
  state.syncing = true; state.lastError = null; notify();
  try {
    const remote = await G.readStructure();
    if (remote && Array.isArray(remote.days) && remote.days.length) {
      state.days = remote.days;
      if (remote.settings) state.settings = remote.settings;
    } else {
      // Cloud is empty — push whatever we have locally (seeded defaults) as the baseline.
      await G.writeStructure(structureBlob());
    }

    const remoteEntries = await G.readEntries();
    if (remoteEntries.length) {
      state.entries = remoteEntries;
    } else if (state.entries.length) {
      await G.rewriteEntries(state.entries); // push offline-logged entries up
    }

    const remoteSessions = await G.readSessions();
    if (remoteSessions.length) {
      state.sessions = remoteSessions;
    } else if (state.sessions.length) {
      await G.rewriteSessions(state.sessions);
    }
    saveLocal();
  } catch (err) {
    state.lastError = humanError(err);
  } finally {
    state.syncing = false; notify();
  }
}

// Wipe local data and re-seed the default days + baseline weight entries.
export async function resetToDefaults() {
  const seeded = buildDefaults();
  state.days = seeded.days;
  state.entries = seeded.entries;
  state.sessions = [];
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

// Manual "pull from Google Sheet" — overwrites local with the cloud copy.
export async function syncFromCloud() {
  if (!G.isSignedIn()) { state.lastError = 'Sign in first to sync from Google Sheets.'; notify(); return; }
  await pullFromCloud();
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
  state.entries = state.entries.filter((e) => !exIds.has(e.exId));
  pushStructure();
  if (G.isSignedIn()) G.rewriteEntries(state.entries).catch(() => {});
  notify();
}

export function addExercise(dayId, { name, muscle, db = null, finisher = false, reps = [] }) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return null;
  const e = { id: uid(), name, muscle, db, finisher, reps };
  d.exercises.push(e);
  pushStructure(); notify();
  return e;
}
export function updateExercise(dayId, exId, patch) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  const e = d.exercises.find((x) => x.id === exId); if (!e) return;
  Object.assign(e, patch);
  pushStructure(); notify();
}
export function deleteExercise(dayId, exId) {
  const d = state.days.find((x) => x.id === dayId); if (!d) return;
  d.exercises = d.exercises.filter((x) => x.id !== exId);
  state.entries = state.entries.filter((e) => e.exId !== exId);
  pushStructure();
  if (G.isSignedIn()) G.rewriteEntries(state.entries).catch(() => {});
  notify();
}

export function setUnit(unit) {
  state.settings.unit = unit;
  pushStructure(); notify();
}

// --- entries --------------------------------------------------------------
export async function addEntry(exId, { weights, weight, effort, date, note = '' }) {
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
  };
  state.entries.push(entry);
  saveLocal(); notify();
  if (G.isSignedIn()) {
    try { await G.appendEntry(entry); }
    catch (err) { state.lastError = humanError(err); notify(); }
  }
  return entry;
}

export async function deleteEntry(entryId) {
  state.entries = state.entries.filter((e) => e.id !== entryId);
  saveLocal(); notify();
  if (G.isSignedIn()) {
    try { await G.rewriteEntries(state.entries); }
    catch (err) { state.lastError = humanError(err); notify(); }
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

// Start a day. Resumes an existing active session for the same day+date if present.
export function startSession(dayId, date) {
  date = date || todayISO();
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return null;
  let s = state.sessions.find((x) => x.dayId === dayId && x.date === date && x.status !== 'ended');
  if (!s) {
    s = { id: uid(), dayId, date, status: 'active', done: [], note: '',
          startedAt: nowISO(), endedAt: '', snapshot: snapshotDay(day) };
    state.sessions.push(s);
    saveLocal(); notify(); // kept local until the day is ended
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
    .filter((e) => state.entries.some((en) => en.exId === e.id && en.date === session.date))
    .map((e) => e.id);
}

export function setSessionNote(sessionId, note) {
  const s = getSession(sessionId); if (!s) return;
  s.note = note; saveLocal(); notify();
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
  saveLocal(); notify();
}

// End the day → freeze the derived done-list, mark ended, and PUSH to the Google Sheet.
export async function endSession(sessionId) {
  const s = getSession(sessionId); if (!s) return;
  s.done = sessionDoneIds(s); // snapshot what was logged while the day was active
  s.status = 'ended'; s.endedAt = nowISO();
  await pushSessions();
}

export function reopenSession(sessionId) {
  const s = getSession(sessionId); if (!s) return;
  s.status = 'active'; s.endedAt = '';
  saveLocal(); notify();
}

export async function deleteSession(sessionId) {
  state.sessions = state.sessions.filter((s) => s.id !== sessionId);
  await pushSessions();
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
