// Model report — loads report.json, lets the reader pick model A and model B, scores every block in the browser and draws
// the charts as SVG. Scoring rules (also printed in the footer):
//   spec      max context: longest = 1, other = ratio · KV pool: min(1, pool / (3 × max context)) · seats: min(1, seats / 8)
//   gauntlet  thinking / code / peak tok/s over the pasture + fish runs: faster = 1, other = ratio
//   quality   per page: clean 1 · error fixed in one place with ≤3 chars or one missing HTML tag, then clean 0.5 · anything else 0
//   speed     per concurrency, per column (prose / code / structured / mixed): faster = 1, other = ratio;
//             a column only one side can run scores 1 vs 0 (unsupported); untested columns are not scored for either side
'use strict';

const COLS = [
  { key: 'prose', label: 'prose', color: 'var(--c-prose)' },
  { key: 'code', label: 'code', color: 'var(--c-code)' },
  { key: 'structured', label: 'structured', color: 'var(--c-structured)' },
  { key: 'mixed', label: 'mixed', color: 'var(--c-mixed)' },
];
const GAUNTLET = [
  { key: 'thinking_tps', label: 'thinking', color: 'var(--c-prose)' },
  { key: 'code_tps', label: 'code', color: 'var(--c-code)' },
  { key: 'peak_tps', label: 'peak', color: 'var(--c-peak)' },
  { key: 'avg_tps', label: 'average', color: 'var(--c-mixed)', info: true },   // shown, not scored
];
const SEAT_TARGET = 8;
const KV_TARGET_X = 3;
const PAGE_POINTS = { clean: 1, fixed: 0.5, anomaly: 0.5, broken: 0 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const int = (n) => Number(n).toLocaleString('en-US');
const pts = (n) => fmt(n, 2);

// faster/larger side gets 1, the other its ratio; equal → both 1
function ratio(a, b) {
  if (a == null || b == null) return [null, null];
  const m = Math.max(a, b);
  if (m <= 0) return [0, 0];
  return [a / m, b / m];
}

/* ---------- scoring ---------- */

function scoreSpec(A, B) {
  const [ctxA, ctxB] = ratio(A.spec.max_context, B.spec.max_context);
  const kv = (m) => Math.min(1, m.spec.kv_pool / (KV_TARGET_X * m.spec.max_context));
  const seats = (m) => Math.min(1, m.spec.seats / SEAT_TARGET);
  return [
    { key: 'max_context', label: 'max context per request', a: ctxA, b: ctxB, max: 1,
      va: `${int(A.spec.max_context)}`, vb: `${int(B.spec.max_context)}`, unit: 'tokens' },
    { key: 'kv_pool', label: `KV pool (target ${KV_TARGET_X} × max context)`, a: kv(A), b: kv(B), max: 1,
      va: int(A.spec.kv_pool), vb: int(B.spec.kv_pool), unit: 'tokens', da: A.spec.kv_dtype, db: B.spec.kv_dtype },
    { key: 'seats', label: `concurrent requests (target ${SEAT_TARGET})`, a: seats(A), b: seats(B), max: 1,
      va: String(A.spec.seats), vb: String(B.spec.seats), unit: 'seats' },
  ];
}

function scoreGauntlet(A, B) {
  return GAUNTLET.map((g) => {
    const va = A.gauntlet?.[g.key], vb = B.gauntlet?.[g.key];
    const [a, b] = ratio(va, vb);
    return { ...g, va, vb, a, b };
  });
}

function scoreQuality(A, B) {
  const out = [];
  for (const test of ['pasture', 'fish']) {
    const n = Math.max(A.quality?.[test]?.length || 0, B.quality?.[test]?.length || 0);
    for (let i = 0; i < n; i++) {
      const pa = A.quality?.[test]?.[i], pb = B.quality?.[test]?.[i];
      out.push({ test, run: i + 1, pa, pb,
        a: pa ? PAGE_POINTS[pa.verdict] ?? 0 : 0, b: pb ? PAGE_POINTS[pb.verdict] ?? 0 : 0 });
    }
  }
  return out;
}

const cellOf = (m, c, col) => m.speed?.[c]?.[col] || null;

function scoreSpeedRow(A, B, c) {
  const cols = COLS.map((col) => {
    const ca = cellOf(A, c, col.key), cb = cellOf(B, c, col.key);
    const ma = ca?.status === 'measured', mb = cb?.status === 'measured';
    const ua = ca?.status === 'unsupported', ub = cb?.status === 'unsupported';
    let a = null, b = null, scored = false;
    if (ma && mb) { [a, b] = ratio(ca.tps, cb.tps); scored = true; }
    else if (ma && ub) { a = 1; b = 0; scored = true; }
    else if (mb && ua) { a = 0; b = 1; scored = true; }
    return { ...col, ca, cb, a, b, scored };
  });
  const scored = cols.filter((x) => x.scored);
  return {
    c, cols, max: scored.length,
    a: scored.reduce((s, x) => s + x.a, 0), b: scored.reduce((s, x) => s + x.b, 0),
    hasA: !!A.speed?.[c], hasB: !!B.speed?.[c],
  };
}

function concurrencies(A, B) {
  const s = new Set([...Object.keys(A.speed || {}), ...Object.keys(B.speed || {})]);
  return [...s].map(Number).sort((x, y) => x - y).map(String);
}

/* ---------- drawing ---------- */

// one side's bar chart; bars share ymax with the other side so heights compare across the divider
function barChart(bars, ymax) {
  const W = 420, H = 190, top = 26, bottom = 30, gap = 18;
  const bw = (W - gap * (bars.length + 1)) / bars.length;
  const h = H - top - bottom;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(bars.map((b) => `${b.label} ${b.text}`).join(', '))}">`;
  s += `<line class="axis" x1="0" x2="${W}" y1="${top + h}" y2="${top + h}"/>`;
  bars.forEach((b, i) => {
    const x = gap + i * (bw + gap);
    const v = b.value ?? 0;
    const bh = ymax > 0 ? Math.max(b.value == null ? 0 : 2, (v / ymax) * h) : 0;
    const y = top + h - bh;
    const op = b.state === 'lose' ? 'var(--lose)' : b.state === 'off' ? '0.28' : '1';
    if (b.value == null) {
      s += `<rect x="${x}" y="${top + h - 26}" width="${bw}" height="26" rx="5" fill="none" stroke="var(--border-strong)" stroke-dasharray="4 3"/>`;
      s += `<text x="${x + bw / 2}" y="${top + h - 9}" text-anchor="middle" font-size="11">${esc(b.text)}</text>`;
    } else {
      s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="${b.color}" opacity="${op}"/>`;
      s += `<text class="val" x="${x + bw / 2}" y="${y - 7}" text-anchor="middle" font-size="13" opacity="${b.state === 'off' ? 0.55 : 1}">${esc(b.text)}</text>`;
      if (b.state === 'lose' && b.delta != null && bh > 30) {
        const pw = Math.min(bw - 10, 12 + b.delta.length * 7.6);
        s += `<rect class="delta-pill" x="${x + (bw - pw) / 2}" y="${y + 7}" width="${pw}" height="20" rx="10"/>`;
        s += `<text class="delta" x="${x + bw / 2}" y="${y + 21.5}" text-anchor="middle" font-size="12">${esc(b.delta)}</text>`;
      }
    }
    s += `<text x="${x + bw / 2}" y="${H - 9}" text-anchor="middle" font-size="12">${esc(b.label)}</text>`;
  });
  return s + '</svg>';
}

const state = (mine, other, scored = true) => (!scored || mine == null ? 'off' : mine >= other ? 'win' : 'lose');

function ptsBox(mine, other, max, side, scored = true) {
  if (!scored || mine == null) return `<div class="pts off ${side}"><span class="n">—</span><span class="of">not scored</span></div>`;
  const cls = Math.abs(mine - other) < 1e-9 ? '' : mine > other ? 'win' : 'lose';
  return `<div class="pts ${cls} ${side}"><span class="n">${pts(mine)}</span><span class="of">of ${max}</span></div>`;
}

function vrow(label, visA, ptsA, visB, ptsB) {
  return `<div class="vrow"><div class="label">${label}</div>
    <div class="vis a">${visA}</div>${ptsA}<div class="divider"></div>${ptsB}<div class="vis b">${visB}</div></div>`;
}

function section(title, rule, a, b, max, body) {
  return `<section><div class="sec-head"><h2>${esc(title)}</h2>
    <span class="score">${pts(a)} vs ${pts(b)} · of ${max}</span></div>${body}</section>`;
}

/* ---------- blocks ---------- */

function specBlock(A, B, rows) {
  const why = (m, k) => m.spec.notes?.[k] ? `<div class="note">${esc(m.spec.notes[k])}</div>` : '';
  const body = rows.map((r) => vrow(`<b>${esc(r.label)}</b>`,
    `<div class="value">${r.va} <small>${r.unit}${r.da ? ` · ${esc(r.da)}` : ''}</small></div>${why(A, r.key)}`, ptsBox(r.a, r.b, 1, 'a'),
    `<div class="value">${r.vb} <small>${r.unit}${r.db ? ` · ${esc(r.db)}` : ''}</small></div>${why(B, r.key)}`, ptsBox(r.b, r.a, 1, 'b'))).join('');
  return { a: sum(rows, 'a'), b: sum(rows, 'b'), max: rows.length, html: body };
}

function gauntletBlock(A, B, rows) {
  const ymax = Math.max(...rows.flatMap((r) => [r.va || 0, r.vb || 0]));
  const side = (m, key, other) => barChart(rows.map((r) => ({
    label: r.label, color: r.color, value: r[key], text: fmt(r[key]),
    state: state(r[key === 'va' ? 'a' : 'b'], r[key === 'va' ? 'b' : 'a']),
    delta: pct(r[key], r[key === 'va' ? 'vb' : 'va']) })), ymax);
  const scored = rows.filter((r) => !r.info);
  const a = sum(scored, 'a'), b = sum(scored, 'b');
  const runs = (m) => `<div class="note">${m.gauntlet?.runs ?? 0} thinking-on runs (pasture + fish), tok/s</div>` +
    (m.gauntlet?.avg_thinking_tokens ? `<div class="note">average per run: <b>${int(m.gauntlet.avg_thinking_tokens)}</b> tokens thinking + <b>${int(m.gauntlet.avg_code_tokens)}</b> tokens of code = <b>${int(m.gauntlet.avg_thinking_tokens + m.gauntlet.avg_code_tokens)}</b> tokens generated per request</div>` : '');
  const legend = `<div class="legend">${GAUNTLET.map((g) => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('')}</div>`;
  return { a, b, max: 3, html: legend + vrow('<b>thinking · code · peak · average</b>',
    side(A, 'va') + runs(A), ptsBox(a, b, 3, 'a'), side(B, 'vb') + runs(B), ptsBox(b, a, 3, 'b')) };
}

function pageVis(m, test, run, p) {
  if (!p) return '<div class="note">no run</div>';
  const src = `runs/${encodeURIComponent(m.id)}/${test}/r${run}.html`;
  const tag = { clean: 'clean', fixed: 'JS error fixed · −0.5', anomaly: 'one visual anomaly · −0.5', broken: 'broken' }[p.verdict] || p.verdict;
  const fix = p.fix ? `<div class="fix">${p.fix.chars}-char fix: <code>${esc(p.fix.what)}</code>${p.orig ? ` · <a href="runs/${encodeURIComponent(m.id)}/${test}/r${run}.orig.html" target="_blank" rel="noopener">original</a>` : ''}</div>` : '';
  return `<div class="frame" data-frame><iframe loading="lazy" src="${src}" title="${esc(m.name)} ${test} run ${run}" sandbox="allow-scripts"></iframe>
      <a class="open" href="${src}" target="_blank" rel="noopener">open ↗</a></div>
    <span class="tag ${esc(p.verdict)}">${esc(tag)}</span>${p.tokens ? `<div class="note">${int(p.tokens.thinking)} tokens thinking · ${int(p.tokens.code)} tokens of code</div>` : ''}${p.note && p.verdict !== 'broken' ? `<div class="note">${esc(p.note)}</div>` : ''}${fix}`;
}

function qualityBlock(A, B, rows) {
  const html = rows.map((r) => vrow(`<a class="plink" href="prompts/${r.test}.txt" data-prompt="${r.test}" title="Show the ${r.test} prompt"><b>${r.test}</b></a> · run ${r.run}`,
    pageVis(A, r.test, r.run, r.pa), ptsBox(r.a, r.b, 1, 'a'),
    pageVis(B, r.test, r.run, r.pb), ptsBox(r.b, r.a, 1, 'b'))).join('');
  return { a: sum(rows, 'a'), b: sum(rows, 'b'), max: rows.length, html };
}

function speedSide(m, row, side, ymax, notes) {
  if (!(side === 'a' ? row.hasA : row.hasB)) {
    const why = notes || 'not measured';
    return barChart(row.cols.map((x) => ({ label: x.label, color: x.color, value: null, text: '—' })), ymax) + `<div class="note why">${esc(why)}</div>`;
  }
  const bars = row.cols.map((x) => {
    const cell = side === 'a' ? x.ca : x.cb;
    if (!cell || cell.status !== 'measured') {
      const t = cell?.status === 'unsupported' ? 'n/a' : cell?.status === 'pending' ? 'pending' : '—';
      return { label: x.label, color: x.color, value: null, text: t };
    }
    const mine = side === 'a' ? x.a : x.b, other = side === 'a' ? x.b : x.a;
    const theirs = side === 'a' ? x.cb : x.ca;
    return { label: x.label, color: x.color, value: cell.tps, text: fmt(cell.tps), state: state(mine, other, x.scored),
      delta: theirs?.status === 'measured' ? pct(cell.tps, theirs.tps) : null };
  });
  const seen = new Set();
  const cellNotes = row.cols.map((x) => (side === 'a' ? x.ca : x.cb)).filter((cell) => cell && cell.note && !seen.has(cell.note) && seen.add(cell.note))
    .map((cell) => `<div class="note why">${esc(cell.note)}</div>`).join('');
  return barChart(bars, ymax) + (notes ? `<div class="note">${esc(notes)}</div>` : '') + cellNotes;
}

function speedBlock(A, B) {
  const rows = concurrencies(A, B).map((c) => scoreSpeedRow(A, B, c));
  const legend = `<div class="legend">${COLS.map((g) => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('')}</div>`;
  const html = rows.map((row) => {
    const ymax = Math.max(1, ...row.cols.flatMap((x) => [x.ca?.tps || 0, x.cb?.tps || 0]));
    const scored = row.max > 0;
    return vrow(`<b>${row.c} concurrent request${row.c === '1' ? '' : 's'}</b> · tok/s, all streams together`,
      speedSide(A, row, 'a', ymax, A.speed_notes?.[row.c]), ptsBox(row.a, row.b, row.max, 'a', scored),
      speedSide(B, row, 'b', ymax, B.speed_notes?.[row.c]), ptsBox(row.b, row.a, row.max, 'b', scored));
  }).join('');
  return { a: rows.reduce((s, r) => s + r.a, 0), b: rows.reduce((s, r) => s + r.b, 0), max: rows.reduce((s, r) => s + r.max, 0), html: legend + html };
}

const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
// how far a value is from the other side's, in %: "−11 %"
const pct = (mine, theirs) => (mine == null || !theirs ? null : `${mine >= theirs ? '+' : '−'}${Math.abs(Math.round((mine / theirs - 1) * 100))} %`);
const logo = (m, side) => (m.logo ? `<img class="logo ${side}" src="${esc(m.logo)}" alt="${esc(m.name)}" width="96" height="96">` : `<span class="logo ${side}"></span>`);

/* ---------- page ---------- */

function render(report, ia, ib) {
  const A = report.models[ia], B = report.models[ib];
  const spec = specBlock(A, B, scoreSpec(A, B));
  const gaunt = gauntletBlock(A, B, scoreGauntlet(A, B));
  const qual = qualityBlock(A, B, scoreQuality(A, B));
  const speed = speedBlock(A, B);
  const blocks = [['spec', spec], ['gauntlet speed', gaunt], ['quality', qual], ['throughput', speed]];
  const ta = blocks.reduce((s, [, b]) => s + b.a, 0), tb = blocks.reduce((s, [, b]) => s + b.b, 0), tmax = blocks.reduce((s, [, b]) => s + b.max, 0);
  const links = (m, side) => {
    const l = [m.hf && `<a class="hf" href="${esc(m.hf)}" target="_blank" rel="noopener"><img src="assets/logos/hf.svg" alt="" width="22" height="22"><span class="t">Model ↗</span></a>`,
      m.link && `<a href="${esc(m.link)}" target="_blank" rel="noopener"><span class="ico" aria-hidden="true">📜</span><span class="t">Recipe ↗</span></a>`].filter(Boolean);
    return `<div class="links ${side}">${l.join('')}</div>`;
  };
  const fam = (m) => m.model.split(' ')[0];  // menu grouped by model (Qwen3.8-Flash-Next, GLM-5.3-Flash), report.json order inside
  const opt = (sel) => [...new Set(report.models.map(fam))].map((f) => `<optgroup label="${esc(f)}">${report.models.map((m, i) => fam(m) !== f ? '' :
    `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(m.name)} — ${esc(m.model)}</option>`).join('')}</optgroup>`).join('');
  const big = (mine, other) => `big ${Math.abs(mine - other) < 1e-9 ? '' : mine > other ? 'win' : 'lose'}`;

  document.getElementById('app').innerHTML = `
    <div class="hero">
      <p class="kicker">${esc(report.box)} · ${esc(report.date)}</p>
      <h1>${esc(report.title)}</h1>
      <p class="sub">Every number below was measured on the same hardware, each stack as it ships.</p>
      <div class="pickers"><select id="pa" aria-label="Model A">${opt(ia)}</select><span class="vs">vs</span><select id="pb" aria-label="Model B">${opt(ib)}</select></div>
    </div>
    <div class="total">
      ${logo(A, 'a')}<div class="side a"><span class="name">${esc(A.name)}</span><span class="meta">${esc(A.model)} · ${esc(A.stack)}</span></div>
      <div class="mid"><div class="scoreline"><span class="${big(ta, tb)}">${pts(ta)}</span><span class="vs">vs</span><span class="${big(tb, ta)}">${pts(tb)}</span><span class="pc ${big(ta, tb)}">${(100 * ta / tmax).toFixed(1)} %</span><span></span><span class="pc ${big(tb, ta)}">${(100 * tb / tmax).toFixed(1)} %</span></div>of ${tmax} points</div>
      <div class="side b"><span class="name">${esc(B.name)}</span><span class="meta">${esc(B.model)} · ${esc(B.stack)}</span></div>${logo(B, 'b')}
      ${links(A, 'a')}${links(B, 'b')}
    </div>
    <div class="names" aria-hidden="true"><span class="a">${esc(A.name)}</span><span></span><span class="divider"></span><span></span><span class="b">${esc(B.name)}</span></div>
    <div class="subtotals"><div class="st-head"><span class="a">${esc(A.name)}</span><span></span><span class="b">${esc(B.name)}</span></div>${blocks.map(([k, b]) => { const w = Math.abs(b.a - b.b) < 1e-9 ? ['', ''] : b.a > b.b ? ['win', 'lose'] : ['lose', 'win'];
      const mark = (c) => (c === 'lose' ? '<i class="mark no" aria-label="behind">✗</i>' : '<i class="mark yes" aria-label="ahead or level">✓</i>');
      return `<div class="st-row">${mark(w[0])}<span class="a ${w[0]}">${pts(b.a)}</span><span class="k">${k}<small>of ${b.max}</small></span><span class="b ${w[1]}">${pts(b.b)}</span>${mark(w[1])}</div>`; }).join('')}</div>
    ${section('Spec sheet', 'max context · KV pool vs 3 × context · seats vs 8', spec.a, spec.b, spec.max, spec.html)}
    ${section('Gauntlet speed', 'tok/s while thinking and while writing the code, the best 10 s window, and the average over the whole run', gaunt.a, gaunt.b, gaunt.max, gaunt.html)}
    ${section('Visual quality', 'what renders: clean 1 · small JS fix then clean 0.5 · broken 0', qual.a, qual.b, qual.max, qual.html)}
    ${section('Throughput', 'faster = 1, slower = its ratio, per column; untested columns not scored', speed.a, speed.b, speed.max, speed.html)}`;

  const pick = () => {
    const a = +document.getElementById('pa').value, b = +document.getElementById('pb').value;
    const u = new URL(location.href); u.searchParams.set('a', report.models[a].id); u.searchParams.set('b', report.models[b].id);
    history.replaceState(null, '', u);
    render(report, a, b);
  };
  const app = document.getElementById('app');   // side names for the per-block tags on phones (CSS content: var(--name-a))
  app.style.setProperty('--name-a', JSON.stringify(A.name)); app.style.setProperty('--name-b', JSON.stringify(B.name));
  document.getElementById('pa').onchange = pick;
  document.getElementById('pb').onchange = pick;
  fitFrames();
}

// pages are full-viewport scenes: render each at 1280×720 and scale to the card
function fitFrames() {
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const f = e.target.querySelector('iframe');
      if (f) f.style.transform = `scale(${e.contentRect.width / 1280})`;
    }
  });
  document.querySelectorAll('[data-frame]').forEach((el) => ro.observe(el));
}

function rulesFooter() {
  document.getElementById('rules').innerHTML = `
    <h3>How the score works</h3>
    <ul>
      <li><b>Spec</b> — max context: longest = 1, the other its ratio · KV pool: pool ÷ (${KV_TARGET_X} × max context), capped at 1 · seats: seats ÷ ${SEAT_TARGET}, capped at 1.</li>
      <li><b>Gauntlet speed</b> — the <a href="prompts/pasture.txt" data-prompt="pasture">pasture</a> and <a href="prompts/fish.txt" data-prompt="fish">fish</a> runs (thinking on): average tok/s while thinking, while writing the code, and the best 10-second window. Faster = 1, the other its ratio.</li>
      <li><b>Visual quality</b> — judged on what renders. Clean scene = 1. An error fixable in one place with at most 3 characters or one missing HTML tag (never by commenting code out) is fixed, then the scene is judged, minus 0.5. A visual anomaly confined to one element = 0.5. Anything bigger, hallucinated code, an empty scene or wrong anatomy across the scene = 0.</li>
      <li><b>Throughput</b> — per concurrency and per prompt type: faster = 1, the other its ratio. A column only one side can run scores 1 vs 0; untested columns score for neither side. Each stack runs exactly as it ships.</li>
    </ul>
    <p>Both sides of every row come from the same machine. Temperature 1.0, top-p 0.95.</p>
`;
}

// the gauntlet prompts in a dialog: exact text + settings + copy, so anyone can reproduce a run
async function showPrompt(name) {
  const dlg = document.getElementById('promptDlg');
  const txt = await fetch(`prompts/${name}.txt?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text()).catch(() => 'Could not load the prompt.');
  dlg.querySelector('h3').textContent = `${name[0].toUpperCase()}${name.slice(1)} prompt`;
  dlg.querySelector('pre').textContent = txt;
  const file = dlg.querySelector('.dlg-file');
  file.href = `prompts/${name}.txt`; file.textContent = `Open ${name}.txt`;
  const btn = dlg.querySelector('.copy');
  btn.textContent = 'Copy prompt';
  btn.onclick = () => navigator.clipboard?.writeText(txt).then(() => { btn.textContent = 'Copied ✓'; }).catch(() => { btn.textContent = 'Select and copy'; });
  dlg.showModal();
}

// any [data-prompt] link (footer rules, quality row labels) opens the prompt dialog
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-prompt]');
  if (a) { e.preventDefault(); showPrompt(a.dataset.prompt); }
});

function themeToggle() {
  document.getElementById('theme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('mbx-theme', next); } catch (e) {}
  };
}

// report.json over http; a local copy opened from disk (file://, where fetch is blocked) falls back to report.js
fetch(`report.json?t=${Date.now()}`, { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(`report.json: HTTP ${r.status}`); return r.json(); })
  .catch((e) => { if (window.REPORT) return window.REPORT; throw e; })
  .then((report) => {
    const q = new URL(location.href).searchParams;
    const idx = (id, d) => { const i = report.models.findIndex((m) => m.id === id); return i >= 0 ? i : d; };
    rulesFooter(); themeToggle();
    render(report, idx(q.get('a'), 0), idx(q.get('b'), Math.min(1, report.models.length - 1)));
  })
  .catch((e) => { document.getElementById('app').innerHTML = `<p class="sub" style="padding:3rem 0;text-align:center">Could not load the report: ${esc(e.message)}</p>`; });

/* ---------- recording: Ctrl+Shift+S = constant-speed auto-scroll (Esc stops, [ ] = slower/faster, ?speed=px/s) ---------- */
(() => {
  let speed = Number(new URLSearchParams(location.search).get('speed')) || 70;
  let raf = 0, last = 0, y = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; document.documentElement.classList.remove('autoscroll'); };
  const step = (t) => {
    const dt = last ? Math.min(t - last, 50) / 1000 : 0; last = t;
    y += speed * dt;
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, Math.min(y, max));
    if (y >= max) return stop();
    raf = requestAnimationFrame(step);
  };
  const start = () => { y = window.scrollY; last = 0; document.documentElement.classList.add('autoscroll'); raf = requestAnimationFrame(step); };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); raf ? stop() : start(); }
    else if (raf && e.key === 'Escape') stop();
    else if (raf && e.key === '[') speed = Math.max(10, speed - 10);
    else if (raf && e.key === ']') speed += 10;
  });
})();
