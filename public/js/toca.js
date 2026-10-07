/* Toca Toca: mapa de calor de visitas (datos anonimizados en data/tocatoca.json). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const CE = window.CE, map = CE.map, esc = CE.esc;
  const fmt = (n) => n.toLocaleString('es-MX');
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1).replace(/\.0$/, '') + ' %' : '—');

  const T = { data: null, loading: null, on: false, mode: 'heat', metric: 'visitas', heat: null, poly: null,
    filt: {}, from: '', to: '', cols: {}, perMz: new Map(), max: 1, hi: null };

  // Qué se cuenta en cada métrica: [campo, etiquetas que cuentan] (null = todas las visitas)
  const METRICS = [
    ['visitas', 'Visitas (puertas tocadas)', null],
    ['abrio', 'Abrieron la puerta', ['¿Abrió la puerta?', ['Sí Abrió']]],
    ['contesto', 'Contestaron la encuesta', ['¿Contestó encuesta?', ['Sí']]],
    ['simp', 'Simpatizantes', ['Clasificación', ['Simpatizante']]],
    ['indec', 'Indecisos', ['Clasificación', ['Indeciso']]],
    ['contr', 'Contrarios', ['Clasificación', ['Contrario']]],
    ['pan', 'Prefieren PAN', ['PAN', ['Sí']]],
    ['morena', 'Prefieren MORENA', ['MORENA', ['Sí']]],
    ['mc', 'Prefieren MC', ['MC', ['Sí']]],
    ['malaop', 'Opinión negativa del alcalde', ['Opinión del alcalde', ['Mala', 'Muy Mala']]],
    ['buenaop', 'Opinión positiva del alcalde', ['Opinión del alcalde', ['Buena', 'Muy Buena']]],
    ['negocio', 'Negocios', ['¿Abrió la puerta?', ['Negocio']]],
    ['vacia', 'Deshabitadas / sola', ['¿Abrió la puerta?', ['Deshabitada/Sola']]],
  ];
  const FILTERS = ['Encuestador', 'Colonia', '¿Abrió la puerta?', 'Clasificación', '¿Contestó encuesta?', 'Votó 2024', 'Votó PAN',
    'PAN', 'MORENA', 'MC', 'Opinión del alcalde', 'Personas que pueden votar'];
  const FILTER_LABEL = { Encuestador: 'Encuestador', Colonia: 'Colonia', 'PAN': 'Prefiere PAN', MORENA: 'Prefiere MORENA', MC: 'Prefiere MC',
    'Personas que pueden votar': 'Personas que pueden votar' };

  function setState(kind, html) {
    const el = $('#toca-state');
    el.hidden = !html; el.className = 'note-box' + (kind === 'err' ? ' err' : ''); el.innerHTML = html || '';
  }

  /* ---------- Carga ---------- */
  function load() {
    if (T.data) return Promise.resolve();
    if (T.loading) return T.loading;
    setState('load', '<span class="spinner"></span>Cargando visitas…');
    T.loading = fetch('data/tocatoca.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(async (d) => {
        d.campos.forEach((c, i) => { T.cols[c] = i; });
        await CE.load('manzanas');
        T.data = d;                      // solo se publica cuando todo está listo
        buildUI(); setState();
      })
      .catch((e) => { T.loading = null; setState('err', `No se pudieron cargar los datos de Toca Toca (${esc(e.message)}). <button class="btn" id="toca-retry" style="height:30px;margin-top:6px">Reintentar</button>`);
        const b = $('#toca-retry'); if (b) b.onclick = () => { if (T.on) activate(); }; throw e; });
    return T.loading;
  }

  function buildUI() {
    const d = T.data;
    $('#toca-metric').innerHTML = METRICS.map((m) => `<option value="${m[0]}">${esc(m[1])}</option>`).join('');
    const f = $('#f-from'), t = $('#f-to');
    f.min = t.min = d.dias[0]; f.max = t.max = d.dias[d.dias.length - 1];
    $('#toca-selects').innerHTML = FILTERS.map((c) => {
      const labs = d.etiquetas[c];
      return `<label class="field"><span>${esc(FILTER_LABEL[c] || c)}</span><select data-f="${esc(c)}"><option value="">Todos</option>` +
        labs.map((l, i) => ({ l, i })).sort((a, b) => String(a.l).localeCompare(String(b.l), 'es', { numeric: true })).map((o) => `<option value="${o.i}">${esc(o.l)}</option>`).join('') + '</select></label>';
    }).join('');
    $('#toca-date').textContent = `Datos al ${d.dias[d.dias.length - 1]}.`;
  }

  /* ---------- Cálculo ---------- */
  function compute() {
    const d = T.data, C = T.cols;
    const metric = METRICS.find((m) => m[0] === T.metric);
    let want = null, mi = -1;
    if (metric[2]) { const [col, labs] = metric[2]; mi = C[col]; want = new Set(labs.map((l) => d.etiquetas[col].indexOf(l)).filter((i) => i >= 0)); }
    const fromI = T.from ? d.dias.findIndex((x) => x >= T.from) : 0;
    let toI = T.to ? d.dias.length - 1 : d.dias.length - 1;
    if (T.to) { toI = -1; d.dias.forEach((x, i) => { if (x <= T.to) toI = i; }); }
    const fs = Object.entries(T.filt).filter(([, v]) => v !== '' && v !== undefined).map(([c, v]) => [C[c], +v]);
    const per = new Map(), perCol = new Map();
    const k = { n: 0, abrio: 0, contesto: 0 };
    const abI = d.etiquetas['¿Abrió la puerta?'].indexOf('Sí Abrió'), coI = d.etiquetas['¿Contestó encuesta?'].indexOf('Sí');
    const bad = (fromI < 0) || toI < 0 || fromI > toI;
    if (!bad) for (const r of d.registros) {
      const day = r[1]; if (day < fromI || day > toI) continue;
      let ok = true; for (const [i, v] of fs) if (r[i] !== v) { ok = false; break; } if (!ok) continue;
      k.n++; if (r[C['¿Abrió la puerta?']] === abI) k.abrio++; if (r[C['¿Contestó encuesta?']] === coI) k.contesto++;
      if (want && !want.has(r[mi])) continue;
      per.set(r[0], (per.get(r[0]) || 0) + 1);
      const c = r[C['Colonia']]; perCol.set(c, (perCol.get(c) || 0) + 1);
    }
    T.perMz = per; T.perCol = perCol; T.kpi = k;
    const vals = [...per.values()].sort((a, b) => a - b);
    T.max = vals.length ? vals[vals.length - 1] : 1;
    T.hi = vals.length ? vals[Math.max(0, Math.floor(vals.length * 0.95) - 1)] || T.max : 1;
    T.metricLabel = metric[1];
  }

  /* ---------- Dibujo ---------- */
  const RAMP = ['#3b2b6b', '#a3257f', '#ff4d4d', '#ff9f1a', '#ffe14d'];
  const colorFor = (v) => { const t = Math.min(1, Math.sqrt(v / Math.max(1, T.hi))); return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]; };
  const heatRadius = () => Math.max(14, Math.min(70, 24 * Math.pow(1.3, map.getZoom() - 13)));

  function draw() {
    if (T.heat) { map.removeLayer(T.heat); T.heat = null; }
    if (T.poly) { map.removeLayer(T.poly); T.poly = null; }
    if (!T.on || !T.data) { $('#toca-legend').hidden = true; return; }
    const d = T.data;
    if (T.mode === 'heat') {
      const pts = [];
      T.perMz.forEach((v, i) => { const m = d.manzanas[i]; pts.push([m[2], m[1], Math.min(1, v / Math.max(1, T.hi))]); });
      T.heat = L.heatLayer(pts, { radius: heatRadius(), blur: 22, minOpacity: 0.25, max: 1,
        gradient: { 0.15: '#3b2b6b', 0.4: '#a3257f', 0.6: '#ff4d4d', 0.8: '#ff9f1a', 1: '#ffe14d' } }).addTo(map);
    } else {
      const feats = [], valOf = new Map();
      T.perMz.forEach((v, i) => { const f = CE.S.byIdx.manzanas[d.manzanas[i][0]]; if (f) { feats.push(f); valOf.set(f.properties._i, v); } });
      T.poly = L.geoJSON({ type: 'FeatureCollection', features: feats }, { pane: 'toca',
        style: (f) => ({ color: '#0b1118', weight: 0.8, fillColor: colorFor(valOf.get(f.properties._i)), fillOpacity: 0.85 }),
        onEachFeature: (f, lyr) => {
          lyr.bindTooltip(`Sección ${f.properties.SECCION} · Manzana ${f.properties.MANZANA}<br><b>${fmt(valOf.get(f.properties._i))}</b> · ${esc(T.metricLabel)}`, { sticky: true });
          lyr.on('click', () => CE.select('manzanas', f.properties._i, { fit: false }));
        } }).addTo(map);
    }
    const lg = $('#toca-legend');
    lg.hidden = false;
    lg.innerHTML = `<b>${esc(T.metricLabel)}</b><div class="ramp"></div><div class="rl"><span>menos</span><span>más (≈${fmt(T.hi)} por manzana)</span></div>`;
  }

  function renderPanel() {
    const k = T.kpi;
    $('#toca-kpis').innerHTML =
      `<div class="kpi"><span>Visitas</span><b>${fmt(k.n)}</b></div>` +
      `<div class="kpi"><span>Manzanas</span><b>${fmt(T.perMz.size)}</b></div>` +
      `<div class="kpi"><span>Abrieron</span><b>${fmt(k.abrio)}<i>${pct(k.abrio, k.n)}</i></b></div>` +
      `<div class="kpi"><span>Contestaron</span><b>${fmt(k.contesto)}<i>${pct(k.contesto, k.n)}</i></b></div>`;
    $('#rank-metric').textContent = T.metricLabel.toLowerCase();
    const top = [...T.perMz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const mx = top.length ? top[0][1] : 1;
    $('#rank-mz').innerHTML = top.length ? top.map(([i, v]) => {
      const f = CE.S.byIdx.manzanas[T.data.manzanas[i][0]]; const p = f ? f.properties : { SECCION: '?', MANZANA: '?' };
      return `<li style="--w:${100 * v / mx}%" data-mz="${T.data.manzanas[i][0]}"><span>Secc. ${esc(p.SECCION)} · Mz ${esc(p.MANZANA)}</span><span>${fmt(v)}</span></li>`;
    }).join('') : '<li style="cursor:default"><span>Sin resultados con estos filtros</span><span></span></li>';
    const tc = [...T.perCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), mc = tc.length ? tc[0][1] : 1;
    $('#rank-col').innerHTML = tc.length ? tc.map(([c, v]) => `<li style="--w:${100 * v / mc}%;cursor:default"><span>${esc(T.data.etiquetas['Colonia'][c])}</span><span>${fmt(v)}</span></li>`).join('')
      : '<li style="cursor:default"><span>Sin resultados</span><span></span></li>';
    const fl = Object.values(T.filt).some((v) => v !== '') || T.from || T.to;
    $('#toca-badge').hidden = !(T.on);
    $('#toca-reset').style.visibility = fl ? 'visible' : 'hidden';
  }

  function refresh() { if (!T.data) return; compute(); renderPanel(); draw(); }

  /* ---------- Activación ---------- */
  async function activate() {
    try { await load(); } catch (e) { $('#toca-on').checked = false; T.on = false; return; }
    T.on = true; refresh();
    if (T.perMz.size) {
      const b = L.latLngBounds([...T.perMz.keys()].map((i) => [T.data.manzanas[i][2], T.data.manzanas[i][1]]));
      if (!window.__tocaFitted) { map.fitBounds(b, { padding: [40, 40], maxZoom: 15 }); window.__tocaFitted = true; }
    }
  }
  function deactivate() { T.on = false; draw(); $('#toca-badge').hidden = true; }

  /* ---------- Eventos ---------- */
  map.createPane('toca').style.zIndex = 415;
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    $('#tab-capas').hidden = b.dataset.tab !== 'capas'; $('#tab-toca').hidden = b.dataset.tab !== 'toca';
    if (b.dataset.tab === 'toca') load().catch(() => {});
  }));
  $('#toca-on').addEventListener('change', (e) => (e.target.checked ? activate() : deactivate()));
  document.querySelectorAll('#toca-mode button').forEach((b) => b.addEventListener('click', () => {
    T.mode = b.dataset.mode; document.querySelectorAll('#toca-mode button').forEach((x) => x.classList.toggle('on', x === b)); draw();
  }));
  $('#toca-metric').addEventListener('change', (e) => { T.metric = e.target.value; refresh(); });
  $('#toca-selects').addEventListener('change', (e) => { const c = e.target.dataset.f; if (c) { T.filt[c] = e.target.value; refresh(); } });
  $('#f-from').addEventListener('change', (e) => { T.from = e.target.value; refresh(); });
  $('#f-to').addEventListener('change', (e) => { T.to = e.target.value; refresh(); });
  $('#toca-reset').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    T.filt = {}; T.from = T.to = ''; $('#f-from').value = $('#f-to').value = '';
    document.querySelectorAll('#toca-selects select').forEach((s) => (s.value = '')); refresh();
  });
  $('#rank-mz').addEventListener('click', (e) => { const li = e.target.closest('[data-mz]'); if (li) { CE.select('manzanas', +li.dataset.mz); CE.closeDrawers(); } });
  map.on('zoomend', () => { if (T.heat) T.heat.setOptions({ radius: heatRadius() }); });
})();
