'use strict';
// Server-rendered SVG charts (no client libraries needed).
const { raw, esc } = require('./util');

const niceMax = (v) => {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

// Grouped vertical bars. series: [{ name, cls, values }]
function columnChart({ labels, series, height = 240, unit = '' }) {
  const W = 720, H = height, L = 40, R = 12, T = 14, B = 30;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const iw = W - L - R, ih = H - T - B;
  const gw = iw / labels.length;
  const bw = Math.min(18, (gw * 0.7) / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" class="axis" text-anchor="end">${Math.round((max * i) / 4)}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = L + gw * i + gw / 2;
    const total = bw * series.length + 3 * (series.length - 1);
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      const h = (v / max) * ih;
      const x = cx - total / 2 + j * (bw + 3);
      g += `<rect x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" class="${s.cls}"><title>${esc(lab)} · ${esc(s.name)}: ${v}${unit}</title></rect>`;
    });
    g += `<text x="${cx}" y="${H - 9}" class="axis" text-anchor="middle">${esc(lab)}</text>`;
  });
  const legend = series.map((s) => `<span><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('');
  return raw(`<div class="chart"><div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${g}</svg></div>`);
}

// Donut with centre label. parts: [{ label, value, cls }]
function donut(parts, { center = '', sub = '' } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 52, c = 2 * Math.PI * r;
  let off = 0, arcs = '';
  for (const p of parts) {
    const len = (p.value / total) * c;
    if (len > 0) arcs += `<circle r="${r}" cx="70" cy="70" fill="none" stroke-width="18" class="${p.cls}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(p.label)}: ${p.value}</title></circle>`;
    off += len;
  }
  const legend = parts.map((p) => `<li><i class="${p.cls}"></i><span>${esc(p.label)}</span><b>${p.value.toLocaleString('en-US')}</b><em>${Math.round((p.value / total) * 100)}%</em></li>`).join('');
  return raw(`<div class="donut-wrap"><svg viewBox="0 0 140 140" class="donut"><circle r="${r}" cx="70" cy="70" fill="none" stroke-width="18" class="track"/>${arcs}<text x="70" y="68" text-anchor="middle" class="d-num">${esc(center)}</text><text x="70" y="86" text-anchor="middle" class="d-sub">${esc(sub)}</text></svg><ul class="d-legend">${legend}</ul></div>`);
}

// Progress ring
function ring(value, { size = 120, label = '' } = {}) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = 46, c = 2 * Math.PI * r;
  return raw(`<svg viewBox="0 0 110 110" class="ring" width="${size}" height="${size}"><circle cx="55" cy="55" r="${r}" class="ring-track"/><circle cx="55" cy="55" r="${r}" class="ring-val" stroke-dasharray="${((v / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 55 55)"/><text x="55" y="58" text-anchor="middle" class="ring-num">${Math.round(v)}%</text>${label ? `<text x="55" y="74" text-anchor="middle" class="ring-sub">${esc(label)}</text>` : ''}</svg>`);
}

// Paired horizontal bars (e.g., Master vs MD). rows: [{ label, a, b }]
function pairedBars(rows, { aName, bName, aCls = 's1', bCls = 's2' }) {
  const body = rows.map((r) => `<div class="pb-row"><div class="pb-label">${esc(r.label)}</div><div class="pb-bars">
    <div class="pb-bar"><span class="${aCls}" style="width:${Math.min(100, r.a ?? 0).toFixed(1)}%"></span><em>${r.a == null ? '—' : Math.round(r.a) + '%'}</em></div>
    <div class="pb-bar"><span class="${bCls}" style="width:${Math.min(100, r.b ?? 0).toFixed(1)}%"></span><em>${r.b == null ? '—' : Math.round(r.b) + '%'}</em></div></div></div>`).join('');
  return raw(`<div class="paired"><div class="legend"><span><i class="${aCls}"></i>${esc(aName)}</span><span><i class="${bCls}"></i>${esc(bName)}</span></div>${body}</div>`);
}

module.exports = { columnChart, donut, ring, pairedBars };
