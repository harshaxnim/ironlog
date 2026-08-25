// Thumb-friendly weight control for the per-set fields on the log page.
//
// Typing an exact number on a phone (tiny native spinner, easy to fat-finger) was the worst
// part of logging. Each set is now a row of: [−] [dropdown] [+]
//   • the dropdown is a real <select>, so phones open their native picker/wheel,
//   • the ladder it lists is built from the plate step for the unit (5 lbs / 2.5 kg) around
//     what you've actually lifted for this exercise, so your working weight is a tap away,
//   • every weight you've ever logged here is merged in (so odd values like 47.5 stay pickable),
//   • "Custom…" swaps in a number input for anything off the ladder — once entered it's added
//     to the list and selected,
//   • ± nudge by one plate step (and the first tap on an empty set adopts the suggested weight).
//
// A hidden input per set (`w0`, `w1`, …) is the single source of truth the form reads, so the
// visible controls can change shape without the submit handler caring.

const MAX_OPTIONS = 60;   // keep the native dropdown scrollable-but-sane
const CUSTOM = '__custom';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const round2 = (n) => Math.round(n * 100) / 100;

// Plate step: what one nudge of ± moves by, and the ladder's spacing.
export function stepFor(unit) { return unit === 'kg' ? 2.5 : 5; }

// 47.5 → "47.5", 100 → "100" (no trailing ".0" noise in the dropdown).
export function fmtNum(n) { return String(round2(Number(n))); }

// The weights offered in the dropdown: a plate ladder centred on what you lift for this
// exercise, plus every weight already logged for it (so nothing you've used goes missing).
export function weightOptions({ current = null, history = [], unit }) {
  const step = stepFor(unit);
  const known = [...new Set(history.filter(isNum).concat(isNum(current) ? [current] : []))]
    .filter((w) => w > 0);
  const anchor = isNum(current) && current > 0 ? current
    : (known.length ? Math.max(...known) : step * 8);
  const hi = Math.max(anchor + step * 6, known.length ? Math.max(...known) + step * 4 : 0, step * 12);
  let lo = step;
  // Too tall a ladder to scroll? Start it just below the working weight instead of at one plate.
  if ((hi - lo) / step + 1 > MAX_OPTIONS) {
    lo = Math.max(step, Math.round((anchor - step * Math.floor(MAX_OPTIONS / 3)) / step) * step);
  }
  const out = [];
  for (let w = lo; w <= hi + 1e-9; w = round2(w + step)) out.push(round2(w));
  for (const w of known) out.push(round2(w));
  return [...new Set(out)].sort((a, b) => a - b);
}

// One set row. `rep` is the rep target for the set (may be null → "Set N").
function setFieldHTML({ i, rep, value, options, unit }) {
  const val = isNum(value) ? round2(value) : null;
  const a11y = `Set ${i + 1}${rep != null ? `, ${fmtNum(rep)} reps` : ''}`;
  return `
    <div class="set-field" data-set="${i}">
      <span class="set-rep">Set ${i + 1}${rep != null ? ` <b>×${fmtNum(rep)}</b>` : ''}</span>
      <div class="num-picker">
        <button type="button" class="step-btn" data-step="-1" aria-label="Decrease ${a11y}" tabindex="-1">−</button>
        <select class="num-select" aria-label="${a11y} weight in ${unit}">
          <option value=""${val == null ? ' selected' : ''}>–</option>
          ${options.map((w) => `<option value="${w}"${w === val ? ' selected' : ''}>${fmtNum(w)}</option>`).join('')}
          <option value="${CUSTOM}">Custom…</option>
        </select>
        <input class="num-custom" type="number" step="any" inputmode="decimal" hidden
               placeholder="${unit}" aria-label="Custom weight for ${a11y}" />
        <button type="button" class="step-btn" data-step="1" aria-label="Increase ${a11y}" tabindex="-1">+</button>
      </div>
      <input type="hidden" name="w${i}" value="${val == null ? '' : val}" />
    </div>`;
}

// The whole per-set block. `values` pre-fills each set, `history` widens the dropdown.
export function setFieldsHTML({ reps, values = [], history = [], unit }) {
  return reps.map((rep, i) => {
    const value = values[i] == null || values[i] === '' ? null : Number(values[i]);
    return setFieldHTML({
      i, rep,
      value,
      options: weightOptions({ current: isNum(value) ? value : null, history, unit }),
      unit,
    });
  }).join('');
}

function ensureOption(sel, v) {
  const opts = [...sel.options];
  if (opts.some((o) => o.value === String(v))) return;
  const opt = sel.ownerDocument.createElement('option');
  opt.value = String(v);
  opt.textContent = fmtNum(v);
  const before = opts.find((o) => o.value !== '' && o.value !== CUSTOM && Number(o.value) > v)
    || opts.find((o) => o.value === CUSTOM) || null;
  sel.insertBefore(opt, before);
}

// Wire up every set row inside `scope`. `onChange` fires after any committed value change
// (used to keep a draft of the half-filled form across re-renders).
export function bindWeightPickers(scope, { unit, onChange } = {}) {
  const step = stepFor(unit);
  const fields = [...scope.querySelectorAll('.set-field')];

  fields.forEach((field, idx) => {
    const sel = field.querySelector('.num-select');
    const custom = field.querySelector('.num-custom');
    const hidden = field.querySelector('input[type=hidden]');
    if (!sel || !custom || !hidden) return;

    const setValue = (v) => {
      if (v == null || !Number.isFinite(v)) { hidden.value = ''; sel.value = ''; }
      else { const n = round2(v); ensureOption(sel, n); sel.value = String(n); hidden.value = String(n); }
      onChange?.();
    };
    const showSelect = () => { custom.hidden = true; sel.hidden = false; };
    const commitCustom = () => {
      const n = custom.value === '' ? NaN : Number(custom.value);
      setValue(Number.isFinite(n) && n >= 0 ? n : (hidden.value === '' ? null : Number(hidden.value)));
      showSelect();
    };
    // What ± should start from when this set is still blank: the nearest set already filled
    // (sets usually repeat), else the heaviest option on the ladder's lower half.
    const suggestion = () => {
      for (let d = 1; d < fields.length; d++) {
        for (const j of [idx - d, idx + d]) {
          const other = fields[j]?.querySelector('input[type=hidden]');
          if (other && other.value !== '') return Number(other.value);
        }
      }
      const nums = [...sel.options].map((o) => Number(o.value)).filter((n) => Number.isFinite(n) && n > 0);
      return nums.length ? nums[Math.floor(nums.length * 0.6)] : step;
    };

    sel.addEventListener('change', () => {
      if (sel.value !== CUSTOM) return setValue(sel.value === '' ? null : Number(sel.value));
      sel.hidden = true;
      custom.hidden = false;
      custom.value = hidden.value;
      custom.focus?.();
    });
    custom.addEventListener('blur', commitCustom);
    custom.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commitCustom(); sel.focus?.(); }
      if (ev.key === 'Escape') { showSelect(); setValue(hidden.value === '' ? null : Number(hidden.value)); }
    });

    field.querySelectorAll('.step-btn').forEach((btn) => btn.addEventListener('click', () => {
      if (!custom.hidden) commitCustom();
      const dir = Number(btn.dataset.step);
      const cur = hidden.value === '' ? null : Number(hidden.value);
      // First tap on an empty set adopts the suggested weight rather than jumping one plate.
      setValue(cur == null ? suggestion() : Math.max(0, round2(cur + dir * step)));
    }));
  });
}
