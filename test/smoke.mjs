// User-story test suite: mounts the real app modules in jsdom and drives the actual UI
// (clicks go through the real delegated handlers / router), asserting each user story.
// Run:  npm test
import { JSDOM } from 'jsdom';

const APP = new URL('../js/', import.meta.url).href;
const dom = new JSDOM(
  `<!DOCTYPE html><body><header id="header"></header><main id="app"></main></body>`,
  { url: 'http://localhost:8000/', pretendToBeVisual: true },
);
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, location: window.location,
  localStorage: window.localStorage, HTMLElement: window.HTMLElement,
  Event: window.Event, MouseEvent: window.MouseEvent, FormData: window.FormData,
  confirm: () => true, prompt: () => 'Renamed', alert: () => {},
});
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) };
}
globalThis.fetch = async () => { throw new Error('no-net'); };
window.Chart = undefined;
// Minimal Google stubs so auth-token restore can be unit-tested without the real client.
globalThis.gapi = { client: { setToken: () => {} } };
globalThis.google = { accounts: { oauth2: { revoke: (_t, cb) => cb && cb() } } };

let failures = 0, storyCount = 0;
const assert = (cond, msg) => { if (!cond) { console.error('    ✗ ' + msg); failures++; } else console.log('    ✓ ' + msg); };
const story = (id, title) => { storyCount++; console.log(`\n${id}: ${title}`); };

const Store = await import(APP + 'store.js');
const UI = await import(APP + 'ui.js');
const DB = await import(APP + 'exercise-db.js');
const G = await import(APP + 'google.js');
await DB.loadDb().catch(() => {});

Store.init();
UI.mount(document.getElementById('app'), document.getElementById('header'));
const app = document.getElementById('app');
const header = document.getElementById('header');

const nav = () => window.dispatchEvent(new window.Event('hashchange'));
const click = (el) => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); nav(); };
const hashId = () => location.hash.split('/').pop();
const goHome = () => { location.hash = '#/'; nav(); };
const setEdit = (on) => { const b = header.querySelector('[data-act="toggle-edit"]'); if ((b.textContent.includes('Done')) !== on) click(b); };

// ---------------------------------------------------------------------------
story('US1', 'First run seeds default days and shows them, signed out');
assert(/Workout Days/.test(app.innerHTML), 'home shows "Workout Days"');
assert(Store.getState().days.length === 4, 'seeds 4 default days');
assert(Store.getState().entries.length > 0, 'seeds baseline weight entries from the user log');
assert(Store.getState().days[0].exercises[0].reps.length > 0, 'default exercises carry a rep scheme');
assert(/Chest &amp; Triceps/.test(app.innerHTML), 'lists "Chest & Triceps"');
assert(/Sign in to sync/.test(header.innerHTML), 'shows sign-in');
assert(header.querySelector('[data-act="toggle-edit"]'), 'has an Edit-mode toggle');

story('US2', 'In use mode, tapping a day card starts today\'s workout');
setEdit(false);
const card = app.querySelector('.day-card[data-act="start-day"]');
assert(!!card, 'cards start a workout in use mode');
click(card);
assert(location.hash.startsWith('#/session/'), 'navigated to a session');
const sid = hashId();
assert(Store.getSession(sid)?.status === 'active', 'an active session was created');
assert(/End Day/.test(app.innerHTML), 'session view shows End Day');

story('US3', 'Tapping the same day again resumes the same session (no duplicate)');
const beforeCount = Store.getState().sessions.length;
goHome();
click(app.querySelector('.day-card[data-act="start-day"]'));
assert(hashId() === sid, 'returns to the same session id');
assert(Store.getState().sessions.length === beforeCount, 'no duplicate session created');

story('US4', 'Tapping an exercise opens a session-scoped log page; back returns to the workout');
const exId = Store.sessionDay(Store.getSession(sid)).exercises[0].id;
click(app.querySelector('.sess-row[data-act="log-ex"]'));
assert(location.hash === `#/session/${sid}/ex/${exId}`, 'log route is scoped to the session');
assert(/Add entry/.test(app.innerHTML), 'log page shows the add-entry form');
click(app.querySelector('[data-act="open-session"]'));
assert(location.hash === `#/session/${sid}`, 'back goes to the workout, NOT an edit page');

story('US5', 'Logging weights auto-marks the exercise done (date matches session date)');
location.hash = `#/session/${sid}/ex/${exId}`; nav();
assert(app.querySelectorAll('.set-field input[name^="w"]').length >= 2, 'log form shows a vector of per-set weight fields');
const dateInput = app.querySelector('input[name="date"]');
assert(dateInput.value === Store.todayISO(), 'log date defaults to LOCAL today (matches session)');
await Store.addEntry(exId, { weights: [100, 100, 100, 100], effort: 'high', date: dateInput.value });
assert(new Set(Store.sessionDoneIds(Store.getSession(sid))).has(exId), 'exercise is now done after logging');
location.hash = `#/session/${sid}`; nav();
assert(/1\/\d+ done/.test(app.innerHTML), 'session progress shows 1 done');
assert(app.querySelector('.check-ind.on'), 'done indicator turned on');

story('US6', 'Each set field pre-fills with the latest entry\'s matching set');
location.hash = `#/session/${sid}/ex/${exId}`; nav();
assert(app.querySelector('input[name="w0"]').getAttribute('value') === '100', 'set 1 pre-filled from last entry');

story('US7', 'Graph + history render once data exists');
assert(/canvas id="chart"/.test(app.innerHTML), 'chart canvas renders');
assert(/badge eff-high/.test(app.innerHTML), 'history shows the effort badge');
assert(/100 · 100 · 100 · 100/.test(app.innerHTML), 'history shows the per-set weight vector');

story('US18', 'A multi-set entry stores every set; top set drives the line/done');
const exC = Store.sessionDay(Store.getSession(sid)).exercises[1];
const m = await Store.addEntry(exC.id, { weights: [40, 45, 50], effort: 'medium', date: Store.todayISO() });
assert(m.weights.length === 3 && m.weights[2] === 50, 'all three set weights stored');
assert(m.weight === 50, 'top set = max of the vector');
assert(Store.topSet([20, '', 25, null]) === 25, 'topSet ignores blanks and takes the max');

story('US8', 'End Day freezes done, marks ended, calendar + history reflect it');
location.hash = `#/session/${sid}`; nav();
click(app.querySelector('[data-act="end-session"]'));
assert(Store.getSession(sid).status === 'ended', 'session ended');
assert(Store.getSession(sid).done.includes(exId), 'done list frozen on end');
goHome();
const today = Store.todayISO();
const cell = app.querySelector(`.cal-cell[data-date="${today}"]`);
assert(cell?.classList.contains('marked') && /dot-ended/.test(cell.innerHTML), 'calendar marks the date as done');
assert(app.querySelector('.hist-item[data-act="open-session"]'), 'history list shows the workout');

story('US9', 'A completed workout can be reopened');
click(app.querySelector('.hist-item[data-act="open-session"]'));
assert(location.hash === `#/session/${sid}`, 'opened the session from history');
click(app.querySelector('[data-act="reopen-session"]'));
assert(Store.getSession(sid).status === 'active', 'session reopened to active');

story('US10', 'Edit mode changes day cards to "manage"; turning it off returns to working out');
goHome();
setEdit(true);
const editCard = app.querySelector('.day-card[data-act="day"]');
assert(!!editCard && /Edit mode/.test(app.innerHTML), 'edit mode: cards manage the day');
click(editCard);
assert(location.hash.startsWith('#/day/'), 'edit mode card opens the day template view');
setEdit(false);
assert(location.hash === '#/', 'turning edit off leaves the edit-only screen');
assert(app.querySelector('.day-card[data-act="start-day"]'), 'cards start workouts again');

story('US11', 'Edit mode: add day, add/edit/delete exercise, delete day');
setEdit(true);
const newDay = Store.addDay('Test Day', ['Chest']);
const newEx = Store.addExercise(newDay.id, { name: 'My Move', muscle: 'Chest' });
assert(Store.findExercise(newEx.id), 'exercise added');
Store.updateExercise(newDay.id, newEx.id, { name: 'My Move 2', finisher: true });
assert(Store.findExercise(newEx.id).exercise.name === 'My Move 2', 'exercise edited');
Store.deleteExercise(newDay.id, newEx.id);
assert(!Store.findExercise(newEx.id), 'exercise deleted');
Store.deleteDay(newDay.id);
assert(!Store.getState().days.some((d) => d.id === newDay.id), 'day deleted');
setEdit(false);

story('US12', 'Editing a day template does NOT change past sessions (snapshot immutability)');
const sess = Store.getSession(sid);
const snapLen = Store.sessionDay(sess).exercises.length;
const liveDay = Store.getState().days.find((d) => d.id === sess.dayId);
const victim = liveDay.exercises[0].id;
Store.deleteExercise(sess.dayId, victim);
assert(Store.getState().days.find((d) => d.id === sess.dayId).exercises.length === snapLen - 1, 'live day shrank');
assert(Store.sessionDay(sess).exercises.length === snapLen, 'session snapshot unchanged');
assert(Store.sessionDay(sess).exercises.some((e) => e.id === victim), 'snapshot still has the deleted exercise');

story('US13', 'Alternatives during a workout swap for THIS session only; template untouched');
const exB = Store.sessionDay(sess).exercises[1];
const tmplName = Store.findExercise(exB.id)?.exercise.name;
Store.swapSessionExercise(sid, exB.id, { name: 'Substitute Move', db: null });
assert(Store.sessionDay(sess).exercises.find((e) => e.id === exB.id).name === 'Substitute Move', 'session exercise swapped');
assert(Store.findExercise(exB.id)?.exercise.name === tmplName, 'template exercise unchanged by the swap');

story('US14', 'Units live in Settings and apply to new entries');
assert(!/data-act="settings"[^>]*>\s*(lbs|kg)/.test(header.innerHTML), 'unit is not a header button');
Store.setUnit('kg');
const e2 = await Store.addEntry(exId, { weight: 60, effort: 'low', date: Store.todayISO() });
assert(e2.unit === 'kg', 'new entry tagged with the chosen unit');
Store.setUnit('lbs');

story('US15', 'Calendar month navigation works');
goHome();
const title0 = app.querySelector('.cal-title').textContent;
click(app.querySelector('[data-act="cal-prev"]'));
const title1 = app.querySelector('.cal-title').textContent;
assert(title0 !== title1, 'previous month changes the calendar title');
click(app.querySelector('[data-act="cal-next"]'));
assert(app.querySelector('.cal-title').textContent === title0, 'next month returns to the original');

story('US16', 'A workout can be deleted from its session view');
location.hash = `#/session/${sid}`; nav();
click(app.querySelector('[data-act="del-session"]'));
assert(!Store.getSession(sid), 'session deleted');
assert(location.hash === '#/', 'returned home after delete');

story('US17', 'Persistence: state survives in localStorage');
const cache = JSON.parse(localStorage.getItem('ironlog.cache.v1'));
assert(Array.isArray(cache.days) && Array.isArray(cache.entries) && Array.isArray(cache.sessions), 'days/entries/sessions cached');

story('US19', 'Reset to defaults re-seeds days + baseline entries and clears sessions');
await Store.resetToDefaults();
assert(Store.getState().days.length === 4, 'days reset to the 4 defaults');
assert(Store.getState().sessions.length === 0, 'sessions cleared');
assert(Store.getState().entries.length > 0 && Store.getState().entries[0].weights.length > 0, 're-seeded baseline weight vectors');

story('US20', 'Staying signed in: a valid stored token is restored on load (no prompt)');
localStorage.setItem('ironlog.gtoken', JSON.stringify({ access_token: 'tok', expiry: Date.now() + 3600000 }));
assert(G.wasSignedIn() === true, 'remembers a prior sign-in');
assert(G.restoreToken() === true && G.isSignedIn() === true, 'restores a still-valid token without interaction');
localStorage.setItem('ironlog.gtoken', JSON.stringify({ access_token: 'tok', expiry: Date.now() - 1000 }));
G.signOut();
assert(G.restoreToken() === false && !G.isSignedIn(), 'expired/cleared token does not restore');

console.log(`\n${storyCount} user stories — ${failures ? failures + ' CHECK(S) FAILED ❌' : 'all checks passed ✅'}`);
process.exit(failures ? 1 : 0);
