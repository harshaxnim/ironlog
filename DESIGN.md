# Iron Log — Design System

The single source of truth for how the app looks and behaves. All visual values live as
CSS custom properties in `styles.css` (`:root`). **Don't hard-code colors, radii, or
spacing in components — reference the tokens.** If you need a new value, add a token here
and in `:root` first.

## Principles
1. **Mobile-first.** The primary device is a phone in the gym. Layouts are single-column
   by default and *enhance* to multi-column on wider screens — never the reverse.
2. **Dark, low-glare.** Slate background, one warm accent (orange) for primary actions and
   progress. Used sparingly so it stays meaningful.
3. **Thumb-friendly.** Interactive targets are ≥ 44px tall. Primary action of each screen
   is always reachable near the top.
4. **One source of imagery.** All exercise photos come from free-exercise-db (white-bg
   JPGs) for a consistent look. Thumbnails sit on a white tile so they read on dark.
5. **Quiet chrome, loud data.** Borders and muted text recede; weights, graphs, and effort
   colors stand out.

## Color tokens
| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#0f172a` | App background, header (translucent) |
| `--bg-2` | `#1e293b` | Inputs, modal surface |
| `--bg-3` | `#273449` | Hover fills, chips |
| `--card` | `#1c2840` | Cards, rows, panels |
| `--line` | `#33415c` | All borders / dividers |
| `--text` | `#e2e8f0` | Primary text |
| `--muted` | `#94a3b8` | Secondary text, labels, axes |
| `--accent` | `#f97316` | Primary buttons, graph line, focus ring |
| `--accent-2` | `#fb923c` | Hover accent, links, group titles |

### Effort + semantic colors (fixed meaning — do not reuse for anything else)
| Token | Value | Meaning |
|-------|-------|---------|
| `--green` | `#22c55e` | Effort: **Low** 🟢 |
| `--amber` | `#f59e0b` | Effort: **Medium** 🟡 |
| `--red` | `#ef4444` | Effort: **High** 🔴 / destructive actions |

These three also color the graph data points and the history badges. The mapping is defined
once in `chart.js` (`EFFORT_COLOR`) and `config.js` (`EFFORTS`) — keep them in sync.

## Typography
- Family: system stack (`-apple-system, "Segoe UI", Roboto, …`). No web fonts (speed +
  offline).
- Base: **15px / 1.5**.
- **Inputs are 16px** — deliberately, to stop iOS Safari auto-zooming on focus.
- Scale: `h1` 1.5rem · `h2` 1.2rem · `h3`/group-title 0.82rem uppercase tracked ·
  `.small` 0.82rem · badges/chips 0.76–0.78rem.

## Spacing & shape
- Spacing rhythm (rem): **0.4 / 0.5 / 0.7 / 1.0 / 1.2**. Stick to these steps.
- Radii: cards/panels/modal `--radius` (14px); buttons/inputs/rows 9–12px; chips/badges
  pill (999px).
- Elevation: one shadow token `--shadow` for cards and modal only.

## Breakpoints
Mobile-first; these are the **only** breakpoints — reuse them, don't invent new ones.
| Width | What changes |
|-------|--------------|
| `≤ 480px` | Header condenses: sync shows a dot only (label hidden); tighter gaps. |
| `≤ 560px` | History rows reflow to 3 columns; note wraps full-width. |
| `≤ 720px` | Exercise detail goes single-column (graph stacks above the add-entry form). |
Cards/results use intrinsic `auto-fill` grids, so they reflow fluidly without breakpoints.

## Navigation model (avoids ambiguous "back")
Two clearly separated intents — **working out** (default) and **editing templates** (an
explicit Edit-mode toggle in the header). Clicks are never overloaded, and every route has
exactly one parent, so "back" is unambiguous.

| Route | Screen | Back goes to |
|-------|--------|--------------|
| `#/` | Home (day cards + calendar/history) | — |
| `#/session/:sid` | A workout (started day) | Home |
| `#/session/:sid/ex/:exId` | Log an exercise **inside** that workout | that session |
| `#/day/:dayId` | Manage a day template (Edit mode only) | Home |

- **Use mode (default):** tap a day card → start/resume today's workout. Inside it, tap an
  exercise → its log page; back → the workout. No edit affordances in the way.
- **Edit mode (toggle on):** day cards become "manage" → the day template view, where you
  add/edit/delete exercises (tap an exercise → edit modal) and the day. Turning Edit off
  from a `#/day` screen returns home.
- The exercise log page lives **only** under a session, so logging never strands you on an
  edit screen. "Done" is derived from logging on the session's date (never manual), so the
  log date and session date are both **local** calendar dates (see Mobile/a11y notes).

## Components
- **Header** (`.header`) — sticky, translucent blur, safe-area aware. Brand (home link) +
  sync status + unit toggle + sign-in.
- **Buttons** — `.primary` (accent, main action), `.ghost` (outline), `.danger`, `.link`
  (text back-nav), `.icon-btn` (delete ✕), `.small-btn` (in dense rows). One primary per
  screen region.
- **Chips** (`.chip`) — muscle-group tags. **Badges** (`.badge.eff-*`) — effort.
- **Cards** (`.day-card`) — auto-fill grid, lift + accent border on hover.
- **Exercise row** (`.ex-row`) — white thumbnail + name + last value + chevron.
- **Panels** (`.panel`, `.chart-wrap`, `.add-wrap`) — titled content blocks.
- **Segmented control** (`.seg`) — effort + unit pickers (radio-backed, keyboard
  accessible). Selected option borders in its semantic color.
- **Number picker** (`.num-picker`) — how weights are entered, one row per set:
  `−` · a real `<select>` ladder · `+`. A native select means phones open their own
  wheel/list instead of asking for typed digits; `±` nudges one plate step (5 lbs / 2.5 kg);
  **Custom…** swaps the select for a number input for anything off the ladder (once entered
  it joins the list). A hidden `wN` input per set is what the form actually reads, so the
  visible controls can change without touching submit logic. Ladder = plate steps around
  your working weight for that exercise ∪ every weight ever logged for it.
- **Notes** — two kinds, deliberately separate: a **setup note** on the exercise
  (`textarea`, saved to the day template — seat height, pin, grip; previewed as a
  one-line `.ex-note` on exercise rows) and a **per-entry note** on each logged set
  (how it felt), shown in the history row.
- **Modal** (`.overlay`/`.modal`) — centered, max 460px, scrolls; backdrop click closes.
- **Illustration** (`.illus`) — start/end figures on white tiles + numbered instructions.

## Mobile checklist (every new screen must pass)
- [ ] `viewport` meta with `viewport-fit=cover` (set once in `index.html`).
- [ ] Single-column at 360px wide with **no horizontal scroll**.
- [ ] All tap targets ≥ 44px; primary action visible without scrolling.
- [ ] Inputs 16px (no focus zoom). Native `type=number/date` keyboards used.
- [ ] Long text truncates or wraps — never overflows its container.
- [ ] Safe-area insets respected top (header) and bottom (page padding).

## Accessibility
- Color is never the *only* signal: effort also carries an emoji + text label.
- Segmented controls are real `<label>`+`radio` (focusable, arrow-key/screen-reader
  friendly). Images have `alt`. Focus ring uses `--accent`.
