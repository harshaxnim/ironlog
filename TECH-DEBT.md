# Tech debt & extensibility notes

Deliberate simplifications in v1, with the path to extend each. The data model was
designed so these are additive, not rewrites.

## 1. Entries are a single value, not sets × reps
**Now:** each logged entry is one number (`weight`) + `effort` + `date` + `note`.
You log the top-set weight per session; the graph plots that.

**Why:** requested explicitly — "let's just do weights for now, make it extensible."

**To extend to sets × reps:** the `Entries` sheet / `entry` object already has spare
shape. Add a `sets` field holding `[{reps, weight}, ...]` (JSON in a new column).
- `store.addEntry` takes a `sets` array; keep `weight` as the derived top-set so the
  current graph/history keep working with zero changes.
- `chart.js` can gain selectable metrics (top-set / est. 1RM via Epley `w*(1+reps/30)` /
  volume `Σ w*reps`) — the graph code is already isolated in one module.
- Old single-value entries stay valid (no `sets` → treat `weight` as a 1-set entry).

## 2. Entry edit/delete rewrites the whole Entries sheet
`rewriteEntries()` clears + rewrites all rows on delete. Fine for hundreds of entries;
if the log grows huge, switch to row-addressed updates (track each entry's row index,
or use the Sheets `batchUpdate` deleteDimension by matching `id`).

## 3. No reordering UI
Exercises sort by muscle group (day order) then finishers. There's no drag-to-reorder.
Add an `order` field per exercise and a drag handle; `groupedExercises` already centralises
sort logic.

## 4. Unit conversion is not retroactive
Switching lbs/kg only affects *new* entries; existing entries keep their logged unit
(shown per-row). Intentional — avoids lossy round-tripping. A display-time converter
could normalise the graph if desired.

## 5. Session history is immutable via a snapshot
Each session stores a `snapshot` of the day (name, muscles, exercise list) captured when the
workout is **started**, so editing/deleting the day template later doesn't rewrite past
workouts. `Store.sessionDay(session)` returns the snapshot, falling back to the live day for
sessions created before snapshots existed. Snapshots reference exercise `id`s, so logged
`done` checks and weight entries still line up. Trade-off: a snapshot is a point-in-time copy
— renaming an exercise won't retro-update old sessions (intended).

## 6. Conflict handling is last-write-wins
Cloud is treated as source of truth on sign-in; local edits while signed in push up
immediately. No multi-device merge. Fine for single-user. If needed, add per-record
`updatedAt` and merge on pull.

## 7. Alternatives & illustrations depend on a free CDN
Images + metadata come from `free-exercise-db` via jsDelivr. The full DB is cached in
`localStorage` after first load (offline-friendly). User-added custom exercises (not from
the library) have no image and no auto-alternatives until linked via search.

## 8. Auth token is in-memory; silent re-auth on reload
Access tokens aren't persisted (more secure). Instead, after the first sign-in we set a
local `ironlog.gauth` flag and, on each load, call `trySilentSignIn()` (`prompt: ''`) to
re-acquire a token without a popup using the existing Google session. A real prompt only
reappears if that silent attempt fails (no Google session, consent revoked, or — in
Testing-mode OAuth — the ~7-day expiry). Publishing the consent screen to production removes
the weekly expiry.
