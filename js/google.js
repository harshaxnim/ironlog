// Google sign-in (GIS) + Sheets/Drive storage.
// Storage shape in the spreadsheet:
//   - "Structure" sheet: cell A1 holds a JSON blob { days, settings } (the editable tree).
//   - "Entries" sheet:   tabular append-only log, one row per logged entry.
import { CONFIG } from './config.js';

const ENTRY_HEADER = ['id', 'exId', 'date', 'weight', 'unit', 'effort', 'note', 'createdAt', 'weights'];
const SESSION_HEADER = ['id', 'dayId', 'date', 'status', 'done', 'note', 'startedAt', 'endedAt', 'snapshot', 'lastModified'];

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let refreshTimer = null;
let gapiReady = false;
let gisReady = false;
let spreadsheetId = null;
let authResolved = false; // false until the initial token check finishes (drives the spinner)

const listeners = new Set();
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(isSignedIn()); }

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiry;
}

// True until the on-load token check completes — the header shows a spinner meanwhile so it
// never flashes "Sign in" before flipping to "Sign out".
export function authPending() { return !authResolved; }
export function markAuthResolved() { if (!authResolved) { authResolved = true; emit(); } }

// One-shot startup: init the client, reuse a stored token (or try silent), then resolve.
// Returns true if signed in. Always marks auth resolved (clears the spinner) when done.
export async function bootstrapAuth() {
  try {
    await init();
    let signed = restoreToken();
    if (!signed) {
      signed = await Promise.race([
        trySilentSignIn(),
        new Promise((r) => { setTimeout(() => r(false), 4000); }), // don't spin forever
      ]);
    }
    return signed;
  } catch {
    return false;
  } finally {
    markAuthResolved();
  }
}

// --- script loading -------------------------------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function init() {
  await Promise.all([
    loadScript('https://apis.google.com/js/api.js'),
    loadScript('https://accounts.google.com/gsi/client'),
  ]);

  await new Promise((resolve) => gapi.load('client', resolve));
  await gapi.client.init({ discoveryDocs: CONFIG.DISCOVERY_DOCS });
  gapiReady = true;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: () => {}, // set per-request below
  });
  gisReady = true;
}

export function ready() { return gapiReady && gisReady; }

// Request an access token. prompt: '' tries silent renewal after first consent.
export function requestToken({ prompt = 'consent' } = {}) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('Google not initialised'));
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(resp);
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
      gapi.client.setToken({ access_token: accessToken });
      persistToken();
      scheduleRefresh();
      emit();
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function signIn() {
  await requestToken({ prompt: 'consent' });
}

// The implicit (GIS token) flow only ever issues a ~1h access token — there's no refresh
// token to lengthen it (that's a property of this flow, NOT of the OAuth app being in
// "testing"). To keep a session alive we proactively re-request a token a couple of minutes
// before it lapses. This succeeds silently while the Google session + prior consent are
// intact; it can still fail under third-party-cookie blocking (Safari/incognito), in which
// case the user simply lands on "Sign in" again — a durable fix there needs a backend.
function scheduleRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  const lead = 2 * 60 * 1000; // renew 2 min early
  const delay = tokenExpiry - Date.now() - lead;
  if (delay <= 0 || typeof setTimeout !== 'function') return;
  refreshTimer = setTimeout(() => {
    requestToken({ prompt: '' }).catch(() => { /* silent renew failed — user can re-sign-in */ });
  }, delay);
}

// We persist the short-lived access token (and its expiry) locally so a page refresh stays
// signed in for the token's ~1h lifetime — independent of third-party-cookie restrictions
// that can break GIS silent (prompt:'') re-auth.
const LS_TOKEN = 'ironlog.gtoken';
function persistToken() {
  try { localStorage.setItem(LS_TOKEN, JSON.stringify({ access_token: accessToken, expiry: tokenExpiry })); }
  catch { /* ignore */ }
}

export function wasSignedIn() {
  try {
    const t = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    return !!(t && t.access_token);
  } catch { return false; }
}

// Reuse a still-valid stored token on load (no Google interaction at all).
export function restoreToken() {
  if (typeof gapi === 'undefined' || !gapi.client) return false;
  try {
    const t = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    if (!t || !t.access_token || !t.expiry || Date.now() >= t.expiry) return false;
    accessToken = t.access_token;
    tokenExpiry = t.expiry;
    gapi.client.setToken({ access_token: accessToken });
    scheduleRefresh();
    emit();
    return true;
  } catch { return false; }
}

// Fallback when no valid stored token: try to get one WITHOUT a popup (existing Google
// session + prior consent). Resolves true if signed in, false if a real sign-in is needed.
export async function trySilentSignIn() {
  if (!wasSignedIn() || !ready()) return false;
  try { await requestToken({ prompt: '' }); return true; }
  catch { return false; }
}

export function signOut() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null; tokenExpiry = 0; spreadsheetId = null;
  try { localStorage.removeItem(LS_TOKEN); } catch { /* ignore */ }
  gapi.client.setToken(null);
  emit();
}

// Re-auth wrapper: if a call fails with 401, get a fresh token silently and retry once.
async function withAuth(fn) {
  try {
    return await fn();
  } catch (err) {
    const code = err?.status || err?.result?.error?.code;
    if (code === 401) {
      await requestToken({ prompt: '' });
      return await fn();
    }
    throw err;
  }
}

// --- spreadsheet bootstrap ------------------------------------------------
let ensureInFlight = null;
export async function ensureSpreadsheet() {
  if (spreadsheetId) return spreadsheetId;
  // Memoise the in-flight lookup/creation: concurrent callers (e.g. the parallel reads in
  // pullFromCloud, or a delete firing structure+entries writes at once) must NOT each race to
  // create their own duplicate spreadsheet.
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = withAuth(async () => {
    // drive.file scope: list only returns files THIS app created.
    const q = `name='${CONFIG.SPREADSHEET_NAME.replace(/'/g, "\\'")}'` +
      ` and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const res = await gapi.client.drive.files.list({
      q, fields: 'files(id,name)', pageSize: 10,
    });
    const found = res.result.files && res.result.files[0];
    if (found) {
      spreadsheetId = found.id;
      await ensureTabs(); // legacy sheets may predate the Sessions tab
      return spreadsheetId;
    }

    // Create a fresh spreadsheet with all our tabs.
    const created = await gapi.client.sheets.spreadsheets.create({
      resource: {
        properties: { title: CONFIG.SPREADSHEET_NAME },
        sheets: [
          { properties: { title: CONFIG.STRUCTURE_SHEET } },
          { properties: { title: CONFIG.ENTRIES_SHEET } },
          { properties: { title: CONFIG.SESSIONS_SHEET } },
        ],
      },
    });
    spreadsheetId = created.result.spreadsheetId;
    await writeRange(CONFIG.ENTRIES_SHEET, [ENTRY_HEADER]);
    await writeRange(CONFIG.SESSIONS_SHEET, [SESSION_HEADER]);
    return spreadsheetId;
  });
  // Clear the latch on failure so a later call can retry (and free it on success too).
  try { return await ensureInFlight; }
  finally { ensureInFlight = null; }
}

function writeRange(sheet, values) {
  return gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId, range: `${sheet}!A1`, valueInputOption: 'RAW', resource: { values },
  });
}

// Make sure every required tab exists (adds missing ones + their header row).
async function ensureTabs() {
  const meta = await gapi.client.sheets.spreadsheets.get({
    spreadsheetId, fields: 'sheets.properties.title',
  });
  const have = new Set((meta.result.sheets || []).map((s) => s.properties.title));
  const headers = {
    [CONFIG.STRUCTURE_SHEET]: null,
    [CONFIG.ENTRIES_SHEET]: ENTRY_HEADER,
    [CONFIG.SESSIONS_SHEET]: SESSION_HEADER,
  };
  const missing = Object.keys(headers).filter((t) => !have.has(t));
  if (!missing.length) return;
  await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
  });
  for (const title of missing) if (headers[title]) await writeRange(title, [headers[title]]);
}

export function getSpreadsheetId() { return spreadsheetId; }
export function spreadsheetUrl() {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
}

// --- structure (days/exercises/settings) ----------------------------------
export async function readStructure() {
  await ensureSpreadsheet();
  return withAuth(async () => {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId, range: `${CONFIG.STRUCTURE_SHEET}!A1`,
    });
    const raw = res.result.values?.[0]?.[0];
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  });
}

export async function writeStructure(obj) {
  await ensureSpreadsheet();
  return withAuth(() => gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId, range: `${CONFIG.STRUCTURE_SHEET}!A1`,
    valueInputOption: 'RAW', resource: { values: [[JSON.stringify(obj)]] },
  }));
}

// --- entries --------------------------------------------------------------
export async function readEntries() {
  await ensureSpreadsheet();
  return withAuth(async () => {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId, range: `${CONFIG.ENTRIES_SHEET}!A2:I`,
    });
    const rows = res.result.values || [];
    return rows.filter((r) => r[0]).map((r) => ({
      id: r[0], exId: r[1], date: r[2],
      weight: r[3] === '' || r[3] == null ? null : Number(r[3]),
      unit: r[4] || CONFIG.DEFAULT_UNIT, effort: r[5] || '', note: r[6] || '',
      createdAt: r[7] || '',
      weights: safeJSON(r[8], r[3] != null && r[3] !== '' ? [Number(r[3])] : []),
    }));
  });
}

function entryRow(e) {
  return ENTRY_HEADER.map((k) => (k === 'weights' ? JSON.stringify(e.weights || []) : (e[k] ?? '')));
}

export async function appendEntry(entry) {
  await ensureSpreadsheet();
  return withAuth(() => gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId, range: `${CONFIG.ENTRIES_SHEET}!A:I`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values: [entryRow(entry)] },
  }));
}

// Rewrite the whole entries table (used for edit/delete — data set is small).
export async function rewriteEntries(entries) {
  await ensureSpreadsheet();
  const values = [ENTRY_HEADER, ...entries.map(entryRow)];
  return withAuth(async () => {
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId, range: `${CONFIG.ENTRIES_SHEET}!A:I`,
    });
    await writeRange(CONFIG.ENTRIES_SHEET, values);
  });
}

// --- sessions -------------------------------------------------------------
export async function readSessions() {
  await ensureSpreadsheet();
  return withAuth(async () => {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId, range: `${CONFIG.SESSIONS_SHEET}!A2:J`,
    });
    const rows = res.result.values || [];
    return rows.filter((r) => r[0]).map((r) => ({
      id: r[0], dayId: r[1], date: r[2], status: r[3] || 'ended',
      done: safeJSON(r[4], []), note: r[5] || '',
      startedAt: r[6] || '', endedAt: r[7] || '',
      snapshot: safeJSON(r[8], null),
      // Older sheets predate this column → fall back to a parsable timestamp (or 0).
      lastModified: r[9] != null && r[9] !== '' ? Number(r[9]) : 0,
    }));
  });
}

export async function rewriteSessions(sessions) {
  await ensureSpreadsheet();
  const values = [SESSION_HEADER, ...sessions.map((s) => [
    s.id, s.dayId, s.date, s.status || 'ended',
    JSON.stringify(s.done || []), s.note || '', s.startedAt || '', s.endedAt || '',
    JSON.stringify(s.snapshot || null), s.lastModified || 0,
  ])];
  return withAuth(async () => {
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId, range: `${CONFIG.SESSIONS_SHEET}!A:J`,
    });
    await writeRange(CONFIG.SESSIONS_SHEET, values);
  });
}
