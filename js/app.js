// Bootstrap: hydrate state, mount UI, then warm up the exercise DB and Google client.
import * as Store from './store.js';
import * as DB from './exercise-db.js';
import * as G from './google.js';
import { mount } from './ui.js';

Store.init();
mount(document.getElementById('app'), document.getElementById('header'));

// Load illustrations metadata (cached) — re-render once images/alternatives resolve.
DB.loadDb().then(() => Store.refresh());

// Initialise Google client in the background so "Sign in" is ready instantly. If the user
// signed in previously, silently re-acquire a token (no popup) and sync — so a page refresh
// keeps you signed in instead of prompting every time.
G.init()
  .then(async () => {
    // Reuse a stored token first (survives refresh); else try a silent (popup-less) re-auth.
    if (G.restoreToken() || await G.trySilentSignIn()) await Store.pullFromCloud();
  })
  .catch((err) => console.warn('Google init failed:', err));
