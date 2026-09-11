// Thin wrapper over Chart.js (loaded globally via CDN). For each workout day it plots the
// average of that day's sets as the progression line, wrapped in a translucent min–max band
// so the day's spread stays visible. Average points are coloured by the day's effort.
import { EFFORTS, fmtShort } from './config.js';

const EFFORT_COLOR = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444', '': '#64748b' };
const BAND = 'rgba(249,115,22,0.14)';
const BAND_LINE = 'rgba(249,115,22,0.35)';

let current = null;

// Per-set weights for an entry, with back-compat for old single-weight entries.
function setWeights(e) {
  const src = (e.weights && e.weights.length) ? e.weights : (e.weight != null ? [e.weight] : []);
  return src.filter((w) => typeof w === 'number' && !Number.isNaN(w));
}

// Mean of the logged sets, rounded to one decimal (weights are logged in 0.5 steps).
export function average(ws) {
  if (!ws.length) return null;
  return Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 10) / 10;
}

export function renderWeightChart(canvas, entries, unit) {
  if (typeof Chart === 'undefined') return; // CDN not loaded (offline) — caller shows fallback
  if (current) { current.destroy(); current = null; }

  // One point per calendar date: if a date was logged more than once, keep only the latest
  // entry (by createdAt). `entries` arrives oldest→newest, so a later index always wins.
  const latestByDate = new Map();
  for (const e of entries) {
    const prev = latestByDate.get(e.date);
    if (!prev || (e.createdAt || '') >= (prev.createdAt || '')) latestByDate.set(e.date, e);
  }
  const days = [...latestByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ e, ws: setWeights(e) }))
    .filter((d) => d.ws.length);
  if (!days.length) return;

  // Short tick labels keep the axis readable on a phone; the tooltip carries the full date.
  const labels = days.map((d) => fmtShort(d.e.date));
  const avgData = days.map((d) => average(d.ws));
  const maxData = days.map((d) => Math.max(...d.ws));
  const minData = days.map((d) => Math.min(...d.ws));
  const pointColors = days.map((d) => EFFORT_COLOR[d.e.effort] ?? EFFORT_COLOR['']);

  // The band is drawn as max filled down to min ('+1' = the dataset after this one), so the
  // two edge lines must stay adjacent and in that order.
  const edge = {
    type: 'line', borderColor: BAND_LINE, borderWidth: 1, borderDash: [3, 3],
    pointRadius: 0, pointHoverRadius: 0, tension: 0.25, order: 3,
  };

  current = new Chart(canvas.getContext('2d'), {
    data: {
      labels,
      datasets: [
        { ...edge, label: `Heaviest set (${unit})`, data: maxData, fill: '+1', backgroundColor: BAND },
        { ...edge, label: `Lightest set (${unit})`, data: minData, fill: false },
        {
          type: 'line',
          label: `Average set (${unit})`,
          data: avgData,
          borderColor: '#f97316',
          borderWidth: 2,
          tension: 0.25,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // One tooltip per day, hung off the average line: the band's own edge datasets
          // would otherwise repeat the same numbers.
          filter: (ctx) => ctx.datasetIndex === 2,
          callbacks: {
            title: (items) => days[items[0].dataIndex].e.date,
            label: (ctx) => {
              const i = ctx.dataIndex;
              const eff = EFFORTS.find((x) => x.id === days[i].e.effort);
              const sets = days[i].ws;
              const range = minData[i] === maxData[i] ? `${minData[i]}` : `${minData[i]}–${maxData[i]}`;
              return [
                `Avg ${avgData[i]} ${unit}${eff ? ' · ' + eff.label : ''}`,
                `Range ${range} ${unit} · ${sets.length} set${sets.length === 1 ? '' : 's'}`,
              ];
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
