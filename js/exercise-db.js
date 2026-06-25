// Wrapper around the free-exercise-db: one fetch (cached), lookups, image URLs, alternatives.
import { CONFIG } from './config.js';

let _all = null;       // array of db exercises
let _byId = null;      // id -> exercise
let _loading = null;   // in-flight promise

const LS_DB = 'ironlog.exdb.v1';

export async function loadDb() {
  if (_all) return _all;
  if (_loading) return _loading;

  _loading = (async () => {
    // Try a cached copy first for instant startup / offline.
    try {
      const cached = localStorage.getItem(LS_DB);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) index(parsed);
      }
    } catch { /* ignore cache errors */ }

    try {
      const res = await fetch(CONFIG.DB_JSON_URL);
      if (res.ok) {
        const data = await res.json();
        index(data);
        try { localStorage.setItem(LS_DB, JSON.stringify(data)); } catch { /* quota */ }
      }
    } catch {
      // Offline and no cache: lookups simply return null; the app still works.
    }
    return _all || [];
  })();

  return _loading;
}

function index(data) {
  _all = data;
  _byId = new Map(data.map((e) => [e.id, e]));
}

export function getById(id) {
  return (id && _byId && _byId.get(id)) || null;
}

// Primary image (start position) for an exercise, or null.
export function imageUrl(dbExercise, which = 0) {
  if (!dbExercise || !dbExercise.images || !dbExercise.images[which]) return null;
  return CONFIG.DB_IMAGE_BASE + dbExercise.images[which];
}

export function imageUrlById(id, which = 0) {
  return imageUrl(getById(id), which);
}

// Alternatives = other exercises sharing a primary muscle. Sorted by overlap then name.
export function findAlternatives(id, { limit = 12 } = {}) {
  const base = getById(id);
  if (!base || !_all) return [];
  const muscles = new Set(base.primaryMuscles || []);
  if (!muscles.size) return [];

  return _all
    .filter((e) => e.id !== base.id && (e.primaryMuscles || []).some((m) => muscles.has(m)))
    .map((e) => ({
      e,
      overlap: (e.primaryMuscles || []).filter((m) => muscles.has(m)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

// Fuzzy name search for the "add exercise" picker.
export function search(query, { limit = 20 } = {}) {
  if (!_all) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return _all
    .map((e) => {
      const name = e.name.toLowerCase();
      let score = 0;
      if (name === q) score += 100;
      if (name.startsWith(q)) score += 40;
      if (name.includes(q)) score += 20;
      for (const t of terms) if (name.includes(t)) score += 5;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

export function allLoaded() {
  return !!_all;
}
