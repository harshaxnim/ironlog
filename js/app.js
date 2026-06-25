// Bootstrap: hydrate state, mount UI, then warm up the exercise DB and Google client.
import * as Store from './store.js';
import * as DB from './exercise-db.js';
import * as G from './google.js';
import { mount } from './ui.js';

Store.init();
mount(document.getElementById('app'), document.getElementById('header'));

// Load illustrations metadata (cached) — re-render once images/alternatives resolve.
DB.loadDb().then(() => Store.refresh());

// Initialise Google + resolve sign-in once (reuse a stored token, else silent re-auth). The
// header shows a spinner until this resolves, so it never flashes "Sign in" → "Sign out".
G.bootstrapAuth()
  .then((signedIn) => { if (signedIn) Store.pullFromCloud(); })
  .catch((err) => console.warn('Google init failed:', err));
