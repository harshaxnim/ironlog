// Thin wrapper over Chart.js (loaded globally via CDN). For each workout day it plots every
// set weight as a point (so the vertical spread shows the day's range) plus a line through
// the top set to show progression. Points are coloured by the day's effort.
import { EFFORTS } from './config.js';

const EFFORT_COLOR = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444', '': '#64748b' };

let current = null;

// Per-set weights for an entry, with back-compat for old single-weight entries.
function setWeights(e) {
  const src = (e.weights && e.weights.length) ? e.weights : (e.weight != null ? [e.weight] : []);
  return src.filter((w) => typeof w === 'number' && !Number.isNaN(w));
}

export function renderWeightChart(canvas, entries, unit) {
  if (typeof Chart === 'undefined') return; // CDN not loaded (offline) — caller shows fallback
  if (current) { current.destroy(); current = null; }

  const days = entries.map((e) => ({ e, ws: setWeights(e) })).filter((d) => d.ws.length);
  if (!days.length) return;
  const labels = days.map((d) => d.e.date);

  // Top-set line (progression).
  const topData = days.map((d) => Math.max(...d.ws));
  // Every individual set as a scatter point (vertical spread = that day's range).
  const points = [];
  days.forEach((d) => d.ws.forEach((w) => points.push({ x: d.e.date, y: w, _eff: d.e.effort })));
  const pointColors = points.map((p) => EFFORT_COLOR[p._eff] ?? EFFORT_COLOR['']);

  current = new Chart(canvas.getContext('2d'), {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: `Top set (${unit})`,
          data: topData,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.10)',
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          order: 2,
        },
        {
          type: 'scatter',
          label: 'Sets',
          data: points,
          backgroundColor: pointColors,
          borderColor: pointColors,
          pointRadius: 4,
          pointHoverRadius: 6,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.type === 'line') return `Top: ${ctx.parsed.y} ${unit}`;
              const eff = EFFORTS.find((x) => x.id === ctx.raw._eff);
              return `${ctx.parsed.y} ${unit}${eff ? ' · ' + eff.label : ''}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'category', grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { color: '#94a3b8' },
             title: { display: true, text: unit, color: '#94a3b8' } },
      },
    },
  });
  return current;
}
