// View layer: hash router + rendering for the three screens and modals.
import { EFFORTS } from './config.js';
import * as Store from './store.js';
import * as DB from './exercise-db.js';
import * as G from './google.js';
import { renderWeightChart } from './chart.js';

let root, headerEl;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- routing --------------------------------------------------------------
// Routes are context-scoped so "back" is never ambiguous:
//   #/                      home
//   #/day/:id               manage a day template (Edit mode). back → home
//   #/session/:id           a workout. back → home
//   #/session/:sid/ex/:eid  log an exercise inside a workout. back → that session
function route() {
  const h = location.hash.replace(/^#/, '');
  let m;
  if ((m = h.match(/^\/session\/([^/]+)\/ex\/(.+)$/))) {
    return { name: 'log', sid: decodeURIComponent(m[1]), exId: decodeURIComponent(m[2]) };
  }
  if ((m = h.match(/^\/session\/(.+)$/))) return { name: 'session', id: decodeURIComponent(m[1]) };
  if ((m = h.match(/^\/day\/(.+)$/))) return { name: 'day', id: decodeURIComponent(m[1]) };
  return { name: 'home' };
}
function go(hash) { location.hash = hash; }

// Edit mode separates "working out" from "editing templates" so clicks aren't overloaded.
let editMode = (() => { try { return localStorage.getItem('ironlog.editMode') === '1'; } catch { return false; } })();
function setEditMode(on) {
  editMode = on;
  try { localStorage.setItem('ironlog.editMode', on ? '1' : '0'); } catch { /* ignore */ }
  if (!on && route().name === 'day') return go('#/'); // leave the edit-only screen when turning edit off
  render();
}

// Calendar view-state (which month is shown on the home page). Local UI state only.
let calCursor = startOfMonth(new Date());
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function mount(rootEl, header) {
  root = rootEl; headerEl = header;
  window.addEventListener('hashchange', render);
  Store.subscribe(render);
  G.onAuthChange(render);
  render();
}

// --- header ---------------------------------------------------------------
function renderHeader() {
  const s = Store.getState();
  const signed = G.isSignedIn();
  const sync = s.syncing
    ? '<span class="sync"><span class="dot">●</span><span class="sync-label">syncing…</span></span>'
    : signed
      ? '<span class="sync ok"><span class="dot">●</span><span class="sync-label">synced</span></span>'
      : '';
  headerEl.innerHTML = `
    <div class="brand" data-act="home">🏋️ <span>Iron Log</span></div>
    <div class="head-right">
      ${sync}
      <button class="ghost edit-toggle${editMode ? ' on' : ''}" data-act="toggle-edit" title="Toggle edit mode">${editMode ? '✓ Done' : '✎ Edit'}</button>
      <button class="ghost icon-only" data-act="settings" title="Settings" aria-label="Settings">⚙</button>
      ${G.authPending()
        ? '<span class="auth-spinner" title="Checking sign-in…" aria-label="Checking sign-in"></span>'
        : `<button class="primary" data-act="${signed ? 'signout' : 'signin'}">${signed ? 'Sign out' : 'Sign in to sync'}</button>`}
    </div>`;
  if (s.lastError) {
    headerEl.insertAdjacentHTML('afterend',
      `<div class="banner err">⚠️ ${esc(s.lastError)}</div>`);
  }
}

// --- render dispatch ------------------------------------------------------
function render() {
  renderHeader();
  // clear any stray banner duplicates
  document.querySelectorAll('.banner.err').forEach((n, i) => { if (i > 0) n.remove(); });
  const r = route();
  if (r.name === 'home') return renderHome();
  if (r.name === 'day') return renderDay(r.id);
  if (r.name === 'session') return renderSession(r.id);
  if (r.name === 'log') return renderExerciseLog(r.sid, r.exId);
  renderHome();
}

// --- home: list of days ---------------------------------------------------
function renderHome() {
  const s = Store.getState();
  const signed = G.isSignedIn();
  const today = isoDate(new Date());
  root.innerHTML = `
    <div class="view">
      <div class="row-between">
        <h1>Workout Days</h1>
        ${editMode ? '<button class="ghost" data-act="add-day">+ Add Day</button>' : ''}
      </div>
      <p class="muted small" style="margin-top:-.4rem">${editMode
        ? '✎ Edit mode — tap a day to manage its exercises. Turn off Edit to work out.'
        : "Tap a day to start today's workout."}</p>
      ${s.days.length ? '' : `<p class="muted">No days yet. ${editMode ? 'Add one to get started.' : 'Turn on ✎ Edit to add one.'}</p>`}
      <div class="cards">
        ${s.days.map((d) => `
          <div class="card day-card${editMode ? ' editing' : ''}" data-act="${editMode ? 'day' : 'start-day'}" data-day="${d.id}" data-date="${today}" title="${editMode ? 'Manage ' + esc(d.name) : 'Start ' + esc(d.name)}">
            <div class="card-title">${esc(d.name)}</div>
            <div class="chips">${d.muscles.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div>
            <div class="muted small">${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}${editMode ? ' · tap to manage' : ''}</div>
          </div>`).join('')}
      </div>

      <div class="row-between" style="margin-top:1.8rem">
        <h2>History</h2>
        ${signed ? `<div class="sync-btns">
          <button class="ghost" data-act="sync-down" title="Pull the Google Sheet into this device (merges, nothing is overwritten)">⬇ Sync down</button>
          <button class="ghost" data-act="sync-up" title="Upload this device's data to the Google Sheet (merges, nothing is overwritten)">⬆ Sync up</button>
        </div>` : ''}
      </div>
      <div class="cal-history">
        <div class="cal-col">
          ${calendarHTML()}
          <div class="cal-legend">
            <span><i class="dot-ended"></i> Done</span>
            <span><i class="dot-active"></i> Active</span>
          </div>
        </div>
        <div class="hist-col">
          ${sessionHistoryHTML()}
        </div>
      </div>
    </div>`;
}

// Right-hand column: the history of started/completed workout days, newest first.
function sessionHistoryHTML() {
  const s = Store.getState();
  const sessions = s.sessions.slice()
    .sort((a, b) => (b.date + b.startedAt).localeCompare(a.date + a.startedAt));
  if (!sessions.length) {
    return '<p class="muted small">No workouts yet. Tap a day above to start one, or tap a date on the calendar.</p>';
  }
  const dayName = (se) => Store.sessionDay(se)?.name || 'Deleted day';
  const total = (se) => Store.sessionDay(se)?.exercises.length || 0;
  return `<div class="hist-list">${sessions.map((se) => `
    <div class="hist-item" data-act="open-session" data-session="${se.id}">
      <div class="grow">
        <div class="hist-item-name">${esc(dayName(se))}</div>
        <div class="muted small">${esc(fmtDate(se.date))}</div>
      </div>
      <div class="hist-item-right">
        <span class="badge ${se.status === 'ended' ? 'eff-low' : 'eff-medium'}">${se.status === 'ended' ? '✓ Done' : '• Active'}</span>
        <div class="muted small">${se.done.length}/${total(se)}</div>
      </div>
    </div>`).join('')}</div>`;
}

function calendarHTML() {
  const year = calCursor.getFullYear(), month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = first.getDay(); // 0=Sun
  const statusByDate = Store.sessionStatusByDate();
  const today = isoDate(new Date());

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const status = statusByDate.get(date);
    const dot = status === 'ended' ? '<i class="dot-ended"></i>'
      : status === 'active' ? '<i class="dot-active"></i>' : '';
    cells.push(`
      <button class="cal-cell${date === today ? ' today' : ''}${status ? ' marked' : ''}" data-act="cal-date" data-date="${date}">
        <span class="cal-num">${day}</span>${dot}
      </button>`);
  }

  return `
    <div class="calendar">
      <div class="cal-head">
        <button class="icon-btn" data-act="cal-prev" title="Previous month">‹</button>
        <div class="cal-title">${MONTHS[month]} ${year}</div>
        <button class="icon-btn" data-act="cal-next" title="Next month">›</button>
      </div>
      <div class="cal-grid cal-dow">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="cal-dow-cell">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;
}

// --- day: grouped exercises ----------------------------------------------
function renderDay(dayId) {
  const s = Store.getState();
  const day = s.days.find((d) => d.id === dayId);
  if (!day) return go('#/');
  const groups = Store.groupedExercises(day);

  root.innerHTML = `
    <div class="view">
      <button class="link" data-act="home">← All days</button>
      <div class="banner edit-note">✎ Editing “${esc(day.name)}” — tap an exercise to edit it.</div>
      <div class="row-between">
        <div>
          <h1 class="editable" data-act="edit-day" data-day="${day.id}" title="Edit day">${esc(day.name)}</h1>
          <div class="chips">${day.muscles.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div>
        </div>
        <div class="stack-btns">
          <button class="primary" data-act="add-ex" data-day="${day.id}">+ Add Exercise</button>
          <button class="ghost" data-act="edit-day" data-day="${day.id}">Edit day</button>
          <button class="danger ghost" data-act="del-day" data-day="${day.id}">Delete day</button>
        </div>
      </div>
      ${groups.map((g) => `
        <div class="group">
          <h3 class="group-title">${esc(g.muscle)}</h3>
          <div class="ex-list">
            ${g.items.map((e) => exRow(e, day.id)).join('')}
          </div>
        </div>`).join('') || '<p class="muted">No exercises yet.</p>'}
    </div>`;
}

function exRow(e, dayId) {
  const img = e.db ? DB.imageUrlById(e.db, 0) : null;
  const entries = Store.entriesFor(e.id);
  const last = entries[entries.length - 1];
  const sub = last && last.weight != null
    ? `Last: ${esc(last.weight)} ${esc(last.unit)}`
    : 'No entries yet';
  return `
    <div class="ex-row" data-act="edit-ex" data-ex="${e.id}" data-day="${dayId}" title="Edit ${esc(e.name)}">
      <div class="thumb">${img ? `<img loading="lazy" src="${img}" alt="">` : '🏋️'}</div>
      <div class="ex-meta">
        <div class="ex-name">${esc(e.name)}</div>
        <div class="muted small">${sub}</div>
      </div>
      <div class="chev">✎</div>
    </div>`;
}

// --- exercise log page (inside a workout): graph + add + history + image ---
function renderExerciseLog(sid, exId) {
  const sess = Store.getSession(sid);
  if (!sess) return go('#/');
  const day = Store.sessionDay(sess);
  const exercise = day?.exercises.find((e) => e.id === exId);
  if (!exercise) return go('#/session/' + sid);
  const s = Store.getState();
  const entries = Store.entriesFor(exId);
  // One weight field per set (rep scheme decides how many; default 4). Pre-fill each from
  // the matching set of the latest entry so you can pick up where you left off.
  const reps = (exercise.reps && exercise.reps.length) ? exercise.reps : [null, null, null, null];
  const lastEntry = entries[entries.length - 1];
  const lastWeights = lastEntry ? (lastEntry.weights && lastEntry.weights.length ? lastEntry.weights : [lastEntry.weight]) : [];
  const done = new Set(Store.sessionDoneIds(sess)).has(exId);
  const db = exercise.db ? DB.getById(exercise.db) : null;
  const img0 = db ? DB.imageUrl(db, 0) : null;
  const img1 = db ? DB.imageUrl(db, 1) : null;

  root.innerHTML = `
    <div class="view">
      <button class="link" data-act="open-session" data-session="${sid}">← Back to ${esc(day.name)}</button>
      <div class="row-between">
        <div>
          <h1>${esc(exercise.name)} ${done ? '<span class="badge eff-low">✓ Done</span>' : ''}</h1>
          <div class="chips"><span class="chip">${esc(exercise.muscle || '')}</span></div>
        </div>
        <div class="stack-btns">
          <button class="ghost" data-act="alts-session" data-session="${sid}" data-ex="${exId}">🔄 Can't do this? Alternatives</button>
        </div>
      </div>

      <div class="ex-grid">
        <div class="chart-wrap">
          <div class="panel-title">Progress (top-set weight, ${esc(s.settings.unit)})</div>
          ${entries.some((e) => e.weight != null)
            ? '<div class="chart-box"><canvas id="chart"></canvas></div>'
            : '<div class="empty-chart">No data yet — add your first entry →</div>'}
        </div>

        <div class="add-wrap">
          <div class="panel-title">Add entry</div>
          <form id="entry-form" class="entry-form">
            <label>Weight per set (${esc(s.settings.unit)})
              <div class="set-fields">
                ${reps.map((r, i) => `
                  <div class="set-field">
                    <span class="set-rep">${r != null ? '×' + esc(r) : 'Set ' + (i + 1)}</span>
                    <input name="w${i}" type="number" step="0.5" inputmode="decimal" placeholder="–"
                      value="${lastWeights[i] != null ? esc(lastWeights[i]) : ''}" />
                  </div>`).join('')}
              </div>
            </label>
            <label>Effort
              <div class="seg" role="group">
                ${EFFORTS.map((ef, i) => `
                  <input type="radio" id="eff-${ef.id}" name="effort" value="${ef.id}" ${i === 1 ? 'checked' : ''}/>
                  <label for="eff-${ef.id}" class="seg-opt eff-${ef.id}">${ef.emoji} ${ef.label}</label>`).join('')}
              </div>
            </label>
            <label>Date
              <input name="date" type="date" value="${isoDate(new Date())}" />
            </label>
            <label>Note (optional)
              <input name="note" type="text" placeholder="reps, how it felt…" />
            </label>
            <button class="primary" type="submit">Add entry</button>
          </form>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">History</div>
        ${entries.length ? `
          <div class="history">
            ${entries.slice().reverse().map((e) => historyRow(e)).join('')}
          </div>` : '<p class="muted">No entries yet.</p>'}
      </div>

      <div class="panel">
        <div class="panel-title">Illustration</div>
        ${img0 ? `
          <div class="illus">
            <figure><img loading="lazy" src="${img0}" alt="${esc(exercise.name)} start"><figcaption>Start</figcaption></figure>
            ${img1 ? `<figure><img loading="lazy" src="${img1}" alt="${esc(exercise.name)} end"><figcaption>End</figcaption></figure>` : ''}
          </div>
          ${db?.instructions?.length ? `<ol class="instructions">${db.instructions.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>` : ''}
        ` : '<p class="muted">No illustration linked. Use “Find alternatives” to pick a matching exercise.</p>'}
      </div>
    </div>`;

  if (entries.some((e) => e.weight != null)) {
    const canvas = document.getElementById('chart');
    if (canvas) renderWeightChart(canvas, entries, s.settings.unit);
  }

  const form = document.getElementById('entry-form');
  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const weights = reps.map((_, i) => fd.get('w' + i));
    if (!weights.some((w) => w !== '' && w != null)) { form.querySelector('input[name=w0]')?.focus(); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Adding…';
    await Store.addEntry(exId, {
      weights, effort: fd.get('effort'), date: fd.get('date'), note: fd.get('note'),
      sessionId: sid, // bind the set to this workout session
    });
    // render() re-runs via subscription; form resets implicitly on re-render.
  });
}

function historyRow(e) {
  const eff = EFFORTS.find((x) => x.id === e.effort);
  const ws = (e.weights && e.weights.length) ? e.weights : (e.weight != null ? [e.weight] : []);
  const wStr = ws.length
    ? ws.map((w) => (w == null ? '–' : esc(w))).join(' · ') + ` <span class="muted">${esc(e.unit)}</span>`
    : '—';
  return `
    <div class="hist-row">
      <div class="hist-date">${esc(e.date)}</div>
      <div class="hist-weight">${wStr}</div>
      <div>${eff ? `<span class="badge eff-${eff.id}">${eff.emoji} ${eff.label}</span>` : ''}</div>
      <div class="hist-note muted">${esc(e.note || '')}</div>
      <button class="icon-btn" data-act="del-entry" data-entry="${e.id}" title="Delete">✕</button>
    </div>`;
}

// --- session: a started workout day, check off exercises ------------------
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function renderSession(sessionId) {
  const sess = Store.getSession(sessionId);
  if (!sess) return go('#/');
  const day = Store.sessionDay(sess);
  if (!day) {
    root.innerHTML = `<div class="view"><button class="link" data-act="home">← Home</button>
      <p class="muted">This workout's day was deleted.</p>
      <button class="danger ghost" data-act="del-session" data-session="${sess.id}">Delete this workout</button></div>`;
    return;
  }
  const groups = Store.groupedExercises(day);
  const total = day.exercises.length;
  const doneIds = new Set(Store.sessionDoneIds(sess));
  const doneCount = day.exercises.filter((e) => doneIds.has(e.id)).length;
  const ended = sess.status === 'ended';

  root.innerHTML = `
    <div class="view">
      <button class="link" data-act="home">← Calendar</button>
      <div class="row-between">
        <div>
          <h1>${esc(day.name)}</h1>
          <div class="muted">${esc(fmtDate(sess.date))} ${ended ? '· <span class="badge eff-low">✓ Completed</span>' : '· in progress'}</div>
        </div>
        <div class="stack-btns">
          ${ended
            ? `<button class="ghost" data-act="reopen-session" data-session="${sess.id}">Reopen</button>`
            : `<button class="primary" data-act="end-session" data-session="${sess.id}">✓ End Day & Sync</button>`}
          <button class="danger ghost" data-act="del-session" data-session="${sess.id}">Delete</button>
        </div>
      </div>

      <div class="progress">
        <div class="progress-bar"><span style="width:${total ? Math.round(doneCount / total * 100) : 0}%"></span></div>
        <div class="muted small">${doneCount}/${total} done</div>
      </div>
      <p class="muted small" style="margin:-.4rem 0 1rem">Log a weight on an exercise to mark it done.</p>

      ${groups.map((g) => `
        <div class="group">
          <h3 class="group-title">${esc(g.muscle)}</h3>
          <div class="ex-list">
            ${g.items.map((e) => sessRow(e, doneIds, sess.id)).join('')}
          </div>
        </div>`).join('')}

      <div class="panel">
        <div class="panel-title">Workout note</div>
        <input id="sess-note" type="text" value="${esc(sess.note || '')}" placeholder="how the session went…" />
      </div>
    </div>`;

  const note = document.getElementById('sess-note');
  note?.addEventListener('change', () => Store.setSessionNote(sess.id, note.value));
}

function sessRow(e, doneIds, sid) {
  const img = e.db ? DB.imageUrlById(e.db, 0) : null;
  const entries = Store.entriesFor(e.id);
  const last = entries[entries.length - 1];
  const sub = last && last.weight != null ? `Last: ${esc(last.weight)} ${esc(last.unit)}` : 'No entries yet';
  const done = doneIds.has(e.id);
  return `
    <div class="ex-row sess-row${done ? ' done' : ''}" data-act="log-ex" data-session="${sid}" data-ex="${e.id}">
      <div class="check-ind${done ? ' on' : ''}" title="${done ? 'Logged — done' : 'Log a weight to mark done'}">${done ? '✓' : ''}</div>
      <div class="thumb">${img ? `<img loading="lazy" src="${img}" alt="">` : '🏋️'}</div>
      <div class="ex-meta">
        <div class="ex-name">${esc(e.name)}</div>
        <div class="muted small">${sub} · <span class="link-inline">Log ›</span></div>
      </div>
      <div class="chev">›</div>
    </div>`;
}

// --- modals ---------------------------------------------------------------
function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  return overlay;
}
function closeModal() { document.querySelector('.overlay')?.remove(); }

function addDayModal() {
  const o = openModal(`
    <h2>Add Workout Day</h2>
    <form id="day-form">
      <label>Name<input name="name" placeholder="e.g. Chest & Triceps" required /></label>
      <label>Muscle groups (comma separated)
        <input name="muscles" placeholder="e.g. Chest, Triceps" /></label>
      <div class="modal-btns">
        <button type="button" class="ghost" data-act="close">Cancel</button>
        <button type="submit" class="primary">Add</button>
      </div>
    </form>`);
  o.querySelector('#day-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const muscles = String(fd.get('muscles') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const day = Store.addDay(String(fd.get('name')).trim(), muscles);
    closeModal(); go('#/day/' + day.id);
  });
}

function dateModal(date) {
  const s = Store.getState();
  const sessions = Store.sessionsForDate(date);
  openModal(`
    <h2>${esc(fmtDate(date))}</h2>
    ${sessions.length ? `
      <div class="panel-title">Workouts this day</div>
      <div class="results">
        ${sessions.map((se) => `
          <div class="result" data-act="open-session" data-session="${se.id}">
            <div class="grow"><div>${esc(Store.sessionDay(se)?.name || 'Deleted day')}</div>
              <div class="muted small">${se.status === 'ended' ? '✓ Completed' : 'In progress'} · ${se.done.length} done</div></div>
            <span class="chev">›</span>
          </div>`).join('')}
      </div>` : ''}
    <div class="panel-title" style="margin-top:1rem">Start a workout</div>
    <div class="results">
      ${s.days.map((d) => `
        <div class="result" data-act="start-day" data-day="${d.id}" data-date="${date}">
          <div class="grow"><div>${esc(d.name)}</div>
            <div class="muted small">${d.muscles.join(' · ')}</div></div>
          <span class="chev">+</span>
        </div>`).join('') || '<p class="muted small">No workout days yet — add one first.</p>'}
    </div>
    <div class="modal-btns"><button class="ghost" data-act="close">Close</button></div>`);
}

function editDayModal(dayId) {
  const day = Store.getState().days.find((d) => d.id === dayId);
  if (!day) return;
  const o = openModal(`
    <h2>Edit Day</h2>
    <form id="edit-day-form">
      <label>Name<input name="name" value="${esc(day.name)}" required /></label>
      <label>Muscle groups (comma separated)
        <input name="muscles" value="${esc(day.muscles.join(', '))}" placeholder="e.g. Chest, Triceps" /></label>
      <p class="muted small">Groups set the order exercises are listed in. Renaming a group
        doesn't retag existing exercises — edit those individually.</p>
      <div class="modal-btns">
        <button type="button" class="ghost" data-act="close">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`);
  o.querySelector('#edit-day-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const muscles = String(fd.get('muscles') || '').split(',').map((s) => s.trim()).filter(Boolean);
    Store.updateDay(dayId, { name: String(fd.get('name')).trim(), muscles });
    closeModal();
  });
}

function editExerciseModal(dayId, exId) {
  const found = Store.findExercise(exId);
  if (!found) return;
  const { day, exercise } = found;
  // Offer the day's muscle groups plus the exercise's current one, de-duplicated.
  const muscleOpts = [...new Set([...(day.muscles || []), exercise.muscle, 'Other'].filter(Boolean))];
  const linked = exercise.db ? DB.getById(exercise.db) : null;
  const o = openModal(`
    <h2>Edit Exercise</h2>
    <form id="edit-ex-form">
      <label>Name<input name="name" value="${esc(exercise.name)}" required /></label>
      <label>Muscle group
        <select name="muscle">${muscleOpts.map((m) =>
          `<option ${m === exercise.muscle ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      </label>
      <label>Reps per set (comma separated — sets how many weight fields show)
        <input name="reps" value="${esc((exercise.reps || []).join(', '))}" placeholder="e.g. 15, 12, 10, 8" /></label>
      <label class="check"><input type="checkbox" name="finisher" ${exercise.finisher ? 'checked' : ''}/> Finisher (sorts to bottom of the day)</label>
      <p class="muted small">Illustration: ${linked ? `${esc(linked.name)}.` : 'none linked.'} Use Swap to change the movement/illustration.</p>
      <button type="button" class="ghost" data-act="alts" data-day="${dayId}" data-ex="${exId}" style="width:100%">🔄 Swap / find alternatives</button>
      <div class="modal-btns">
        <button type="button" class="danger ghost" data-act="del-ex" data-day="${dayId}" data-ex="${exId}">Delete</button>
        <span style="flex:1"></span>
        <button type="button" class="ghost" data-act="close">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`);
  o.querySelector('#edit-ex-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Store.updateExercise(dayId, exId, {
      name: String(fd.get('name')).trim(),
      muscle: String(fd.get('muscle')),
      reps: parseReps(fd.get('reps')),
      finisher: !!fd.get('finisher'),
    });
    closeModal();
  });
}

function addExerciseModal(dayId) {
  const day = Store.getState().days.find((d) => d.id === dayId);
  const muscleOpts = (day?.muscles || []).concat(['Other']);
  const o = openModal(`
    <h2>Add Exercise</h2>
    <p class="muted small">Search the exercise library (adds a matching illustration), or enter a custom name.</p>
    <input id="ex-search" placeholder="Search e.g. 'incline press'…" autocomplete="off" />
    <div id="ex-results" class="results"></div>
    <details class="custom">
      <summary>Add custom exercise</summary>
      <form id="custom-ex">
        <label>Name<input name="name" required placeholder="Exercise name" /></label>
        <label>Muscle
          <select name="muscle">${muscleOpts.map((m) => `<option>${esc(m)}</option>`).join('')}</select>
        </label>
        <label>Reps per set (comma separated)
          <input name="reps" placeholder="e.g. 12, 10, 8, 8" /></label>
        <label class="check"><input type="checkbox" name="finisher" /> Finisher (sorts to bottom)</label>
        <div class="modal-btns">
          <button type="button" class="ghost" data-act="close">Cancel</button>
          <button type="submit" class="primary">Add</button>
        </div>
      </form>
    </details>`);

  const input = o.querySelector('#ex-search');
  const results = o.querySelector('#ex-results');
  const renderResults = () => {
    const hits = DB.search(input.value);
    results.innerHTML = hits.length ? hits.map((e) => {
      const img = DB.imageUrl(e, 0);
      return `<div class="result" data-db="${esc(e.id)}" data-name="${esc(e.name)}" data-muscle="${esc(e.primaryMuscles?.[0] || '')}">
        <div class="thumb sm">${img ? `<img loading="lazy" src="${img}" alt="">` : '🏋️'}</div>
        <div><div>${esc(e.name)}</div><div class="muted small">${esc((e.primaryMuscles || []).join(', '))} · ${esc(e.equipment || '')}</div></div>
      </div>`;
    }).join('') : (input.value ? '<p class="muted small">No matches. Try the custom option below.</p>' : '');
  };
  input.addEventListener('input', renderResults);
  results.addEventListener('click', (e) => {
    const row = e.target.closest('.result'); if (!row) return;
    const muscle = (day?.muscles?.includes(cap(row.dataset.muscle)) ? cap(row.dataset.muscle) : (day?.muscles?.[0] || cap(row.dataset.muscle)));
    Store.addExercise(dayId, { name: row.dataset.name, muscle, db: row.dataset.db });
    closeModal();
  });
  o.querySelector('#custom-ex').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Store.addExercise(dayId, {
      name: String(fd.get('name')).trim(),
      muscle: String(fd.get('muscle')),
      reps: parseReps(fd.get('reps')),
      finisher: !!fd.get('finisher'),
    });
    closeModal();
  });
}

// "15, 12, 10, 8" → [15,12,10,8]; blank → [] (form falls back to 4 generic fields).
function parseReps(str) {
  return String(str || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

function altsModal(dayId, exId) {
  const found = Store.findExercise(exId);
  if (!found) return;
  const { exercise } = found;
  if (!exercise.db || !DB.getById(exercise.db)) {
    return openModal(`<h2>Alternatives</h2><p class="muted">This exercise isn't linked to the library yet, so I can't suggest same-muscle alternatives. Add it via search to enable this.</p><div class="modal-btns"><button class="primary" data-act="close">OK</button></div>`);
  }
  const alts = DB.findAlternatives(exercise.db, { limit: 12 });
  openModal(`
    <h2>Alternatives <span class="muted small">· same primary muscle</span></h2>
    <p class="muted small">Machine taken? Swap this exercise, or add an alternative to the day.</p>
    <div class="results alt-results">
      ${alts.map((e) => {
        const img = DB.imageUrl(e, 0);
        return `<div class="result alt" data-db="${esc(e.id)}" data-name="${esc(e.name)}">
          <div class="thumb sm">${img ? `<img loading="lazy" src="${img}" alt="">` : '🏋️'}</div>
          <div class="grow"><div>${esc(e.name)}</div><div class="muted small">${esc((e.primaryMuscles || []).join(', '))} · ${esc(e.equipment || '')}</div></div>
          <div class="alt-btns">
            <button class="ghost small-btn" data-alt-add data-db="${esc(e.id)}" data-name="${esc(e.name)}">+ Add to day</button>
            <button class="primary small-btn" data-alt-swap data-db="${esc(e.id)}" data-name="${esc(e.name)}">Swap</button>
          </div>
        </div>`;
      }).join('') || '<p class="muted">No alternatives found.</p>'}
    </div>
    <div class="modal-btns"><button class="ghost" data-act="close">Close</button></div>`);

  document.querySelector('.alt-results').addEventListener('click', (e) => {
    const add = e.target.closest('[data-alt-add]');
    const swap = e.target.closest('[data-alt-swap]');
    if (add) {
      Store.addExercise(dayId, { name: add.dataset.name, muscle: exercise.muscle, db: add.dataset.db });
      closeModal();
    } else if (swap) {
      Store.updateExercise(dayId, exId, { name: swap.dataset.name, db: swap.dataset.db });
      closeModal();
    }
  });
}

// Alternatives during a workout: swap the movement for THIS session only (machine taken).
function altsSessionModal(sid, exId) {
  const sess = Store.getSession(sid); if (!sess) return;
  const day = Store.sessionDay(sess);
  const exercise = day?.exercises.find((e) => e.id === exId);
  if (!exercise) return;
  if (!exercise.db || !DB.getById(exercise.db)) {
    return openModal(`<h2>Alternatives</h2><p class="muted">This exercise isn't linked to the library, so I can't suggest same-muscle alternatives.</p><div class="modal-btns"><button class="primary" data-act="close">OK</button></div>`);
  }
  const alts = DB.findAlternatives(exercise.db, { limit: 12 });
  openModal(`
    <h2>Alternatives <span class="muted small">· same primary muscle</span></h2>
    <p class="muted small">Machine taken? Swap <b>${esc(exercise.name)}</b> for today's workout only.</p>
    <div class="results alt-results">
      ${alts.map((e) => {
        const img = DB.imageUrl(e, 0);
        return `<div class="result alt">
          <div class="thumb sm">${img ? `<img loading="lazy" src="${img}" alt="">` : '🏋️'}</div>
          <div class="grow"><div>${esc(e.name)}</div><div class="muted small">${esc((e.primaryMuscles || []).join(', '))} · ${esc(e.equipment || '')}</div></div>
          <button class="primary small-btn" data-alt-swap data-db="${esc(e.id)}" data-name="${esc(e.name)}">Use</button>
        </div>`;
      }).join('') || '<p class="muted">No alternatives found.</p>'}
    </div>
    <div class="modal-btns"><button class="ghost" data-act="close">Close</button></div>`);

  document.querySelector('.alt-results').addEventListener('click', (e) => {
    const swap = e.target.closest('[data-alt-swap]'); if (!swap) return;
    Store.swapSessionExercise(sid, exId, { name: swap.dataset.name, db: swap.dataset.db });
    closeModal();
  });
}

function settingsModal() {
  const s = Store.getState();
  const url = G.spreadsheetUrl();
  const o = openModal(`
    <h2>Settings</h2>
    <label>Units
      <div class="seg">
        <input type="radio" id="u-lbs" name="unit" value="lbs" ${s.settings.unit === 'lbs' ? 'checked' : ''}/>
        <label for="u-lbs" class="seg-opt">lbs</label>
        <input type="radio" id="u-kg" name="unit" value="kg" ${s.settings.unit === 'kg' ? 'checked' : ''}/>
        <label for="u-kg" class="seg-opt">kg</label>
      </div>
    </label>
    <p class="muted small">New entries are tagged with the current unit; existing entries keep the unit they were logged in.</p>
    ${url ? `<p class="small"><a href="${url}" target="_blank" rel="noopener">Open Google Sheet ↗</a></p>` : '<p class="muted small">Sign in to sync to Google Sheets.</p>'}
    ${G.isSignedIn() ? `<div class="sync-btns" style="width:100%">
      <button class="ghost" data-act="sync-down" style="flex:1">⬇ Sync down</button>
      <button class="ghost" data-act="sync-up" style="flex:1">⬆ Sync up</button>
    </div>` : ''}
    <hr style="border:none;border-top:1px solid var(--line);margin:1rem 0" />
    <button class="danger ghost" data-act="reset-defaults" style="width:100%">↺ Reset to default workouts</button>
    <p class="muted small">Replaces your days &amp; logs with the built-in defaults (seeded with starting weights). Can't be undone.</p>
    <div class="modal-btns"><button class="primary" data-act="close">Done</button></div>`);
  o.querySelectorAll('input[name=unit]').forEach((r) =>
    r.addEventListener('change', () => Store.setUnit(r.value)));
}

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// --- global click handling (event delegation) -----------------------------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act], [data-day], [data-ex]');
  if (!t) return;
  const act = t.dataset.act;

  switch (act) {
    case 'home': return go('#/');
    case 'day': return go('#/day/' + t.dataset.day);
    case 'close': return closeModal();
    case 'settings': return settingsModal();
    case 'toggle-edit': return setEditMode(!editMode);
    case 'add-day': return addDayModal();
    case 'add-ex': return addExerciseModal(t.dataset.day);

    // calendar + sessions
    case 'start-today': return dateModal(isoDate(new Date()));
    case 'cal-date': return dateModal(t.dataset.date);
    case 'cal-prev': calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); return render();
    case 'cal-next': calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); return render();
    // Both directions consolidate by timestamp/tombstone — neither blind-overwrites.
    case 'sync-down': await Store.syncDown(); return; // cloud → this device
    case 'sync-up': await Store.syncUp(); return;     // this device → cloud
    case 'reset-defaults':
      if (confirm('Reset to the default workouts? This replaces all your days and logs and cannot be undone.')) {
        closeModal(); await Store.resetToDefaults(); go('#/');
      }
      return;
    case 'start-day': {
      const sess = Store.startSession(t.dataset.day, t.dataset.date);
      closeModal(); return go('#/session/' + sess.id);
    }
    case 'open-session': closeModal(); return go('#/session/' + t.dataset.session);
    case 'log-ex': return go('#/session/' + t.dataset.session + '/ex/' + t.dataset.ex);
    case 'end-session': return Store.endSession(t.dataset.session);
    case 'reopen-session': return Store.reopenSession(t.dataset.session);
    case 'del-session':
      if (confirm('Delete this workout?')) { await Store.deleteSession(t.dataset.session); go('#/'); }
      return;
    case 'edit-day': return editDayModal(t.dataset.day);
    case 'edit-ex': return editExerciseModal(t.dataset.day, t.dataset.ex);
    case 'alts': return altsModal(t.dataset.day, t.dataset.ex);
    case 'alts-session': return altsSessionModal(t.dataset.session, t.dataset.ex);
    case 'signin':
      try { await G.signIn(); await Store.pullFromCloud(); } catch { /* user cancelled */ }
      return;
    case 'signout': return G.signOut();
    case 'del-day':
      if (confirm('Delete this day and all its exercises/entries?')) {
        Store.deleteDay(t.dataset.day); go('#/');
      }
      return;
    case 'del-ex':
      if (confirm('Delete this exercise and its history?')) {
        const day = t.dataset.day; closeModal(); Store.deleteExercise(day, t.dataset.ex); go('#/day/' + day);
      }
      return;
    case 'del-entry':
      if (confirm('Delete this entry?')) Store.deleteEntry(t.dataset.entry);
      return;
  }
});
