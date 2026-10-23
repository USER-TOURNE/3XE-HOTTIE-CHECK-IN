// Live analytics built from the Clappia -> Google Sheets sync (published CSV).
// The CSV link itself arrives encrypted in payload.js; nothing secret lives here.
window.Analytics = (() => {
  let url = null, root = null, map = null, markerLayer = null, lastRows = null, lastSig = null, lastDay = null, leafletPromise = null;

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }

  // "9/23/2026 4:28:50 AM" -> Date (device local time)
  function parseStamp(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
    if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
    let h = +m[4]; const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
    return new Date(+m[3], +m[1] - 1, +m[2], h, +m[5], +(m[6] || 0));
  }

  function toRecords(rows) {
    const head = rows[0].map(h => h.trim().toLowerCase());
    const idx = (test) => head.findIndex(test);
    const iName = idx(h => h.includes('name'));
    const iCreated = idx(h => h === 'created at' || h.includes('created'));
    const PIN = /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;
    let iPin = idx(h => h.includes('pin') || h.includes('check in at'));
    if (iPin < 0) iPin = head.findIndex((_, i) => rows.slice(1).some(r => PIN.test(r[i] || '')));
    return rows.slice(1).map(r => {
      const name = (r[iName] || '').trim();
      const at = parseStamp(r[iCreated]);
      const pm = (r[iPin] || '').match(PIN);
      return { name, at, lat: pm ? +pm[1] : null, lng: pm ? +pm[2] : null };
    }).filter(x => x.name && x.at) // skip Clappia's blank "System Workflow" rows
      .sort((a, b) => b.at - a.at);
  }

  // ---------- helpers ----------
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ago(d) {
    const s = Math.max(0, (Date.now() - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    const n = Math.floor(s / 86400); return n + (n === 1 ? ' day ago' : ' days ago');
  }

  // ---------- render ----------
  function card(title, body, cls) {
    return `<div class="frame a-card ${cls || ''}"><div class="frame-head"><span>${esc(title)}</span><span class="stamp"></span></div><div class="a-body">${body}</div></div>`;
  }

  function render(recs) {
    const now = new Date(), today = startOfDay(now);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
    const todayRecs = recs.filter(r => r.at >= today);
    const weekRecs = recs.filter(r => r.at >= weekAgo);
    const peopleToday = new Set(todayRecs.map(r => r.name.toLowerCase())).size;
    const last = recs[0];

    const kpis = `
      <div class="kpis">
        <div class="kpi"><div class="kpi-n">${todayRecs.length}</div><div class="kpi-l">Check-ins today</div></div>
        <div class="kpi"><div class="kpi-n">${peopleToday}</div><div class="kpi-l">People in today</div></div>
        <div class="kpi"><div class="kpi-n">${weekRecs.length}</div><div class="kpi-l">Last 7 days</div></div>
        <div class="kpi"><div class="kpi-n">${recs.length}</div><div class="kpi-l">All time</div></div>
      </div>
      <div class="last">${last ? `Last check-in: <b>${esc(last.name)}</b> · ${fmtDay(last.at)} ${fmtTime(last.at)} <span class="muted">(${ago(last.at)})</span>` : 'No check-ins yet.'}</div>`;

    // Today list
    const todayList = todayRecs.length
      ? `<ul class="list">${todayRecs.map(r => `<li><span>${esc(r.name)}</span><span class="muted">${fmtTime(r.at)}</span></li>`).join('')}</ul>`
      : `<div class="a-empty">Nobody has checked in yet today.</div>`;

    // By day, last 14 days
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
    const counts = days.map(d => recs.filter(r => dayKey(r.at) === dayKey(d)).length);
    const max = Math.max(1, ...counts);
    const W = 560, H = 180, pad = 22, bw = (W - pad * 2) / days.length;
    const bars = days.map((d, i) => {
      const h = Math.round((counts[i] / max) * (H - 44));
      const x = pad + i * bw + 3, y = H - 22 - h;
      const isToday = i === days.length - 1;
      return `<g><title>${fmtDay(d)}: ${counts[i]}</title>
        <rect x="${x.toFixed(1)}" y="${y}" width="${(bw - 6).toFixed(1)}" height="${Math.max(h, counts[i] ? 3 : 1)}" rx="3" class="${isToday ? 'bar today' : 'bar'}"/>
        ${counts[i] ? `<text x="${(x + (bw - 6) / 2).toFixed(1)}" y="${y - 5}" class="bar-n">${counts[i]}</text>` : ''}
        ${(i % 2 === 1 || isToday) ? `<text x="${(x + (bw - 6) / 2).toFixed(1)}" y="${H - 6}" class="bar-l">${isToday ? 'Today' : d.getDate()}</text>` : ''}</g>`;
    }).join('');
    const byDay = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Check-ins per day, last 14 days">${bars}</svg>`;

    // Per person (all time, top 10)
    const tally = {};
    recs.forEach(r => { const k = r.name; tally[k] = (tally[k] || 0) + 1; });
    const people = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const pmax = Math.max(1, ...people.map(p => p[1]));
    const perPerson = people.length ? people.map(([n, c]) =>
      `<div class="hbar"><span class="hbar-l">${esc(n)}</span><span class="hbar-t"><span class="hbar-f" style="width:${(c / pmax * 100).toFixed(1)}%"></span></span><span class="hbar-n">${c}</span></div>`).join('')
      : `<div class="a-empty">No data yet.</div>`;

    root.innerHTML =
      card('Summary', kpis, 'wide') +
      card("Who's in today", todayList) +
      card('Check-ins per day (last 14 days)', byDay) +
      card('Where they checked in', '<div id="a-map"></div>', 'wide') +
      card('Check-ins per person (all time)', perPerson, 'wide');

    drawMap(recs);
    document.querySelectorAll('.stamp').forEach(s => s.textContent = 'Updated ' + fmtTime(new Date()));
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = res; s.onerror = rej; document.head.append(s);
    });
    return leafletPromise;
  }

  async function drawMap(recs) {
    const el = document.getElementById('a-map');
    const pts = recs.filter(r => r.lat != null);
    if (!pts.length) { el.outerHTML = '<div class="a-empty">No check-in locations yet.</div>'; return; }
    try { await loadLeaflet(); } catch { el.outerHTML = '<div class="a-empty">The map couldn’t load.</div>'; return; }
    if (map) { map.remove(); map = null; }
    map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    // OpenStreetMap tiles (no key needed), darkened with CSS to fit the theme.
    // OSM requires a referrer, so tiles send one even though the page itself doesn't.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    markerLayer = L.featureGroup().addTo(map);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--hot').trim() || '#ff3ea5';
    pts.forEach((r, i) => L.circleMarker([r.lat, r.lng], {
      radius: i === 0 ? 9 : 7, color: i === 0 ? '#00ffff' : '#fff', weight: 2, fillColor: accent, fillOpacity: i === 0 ? 1 : .75
    }).bindPopup(`<b>${esc(r.name)}</b><br>${fmtDay(r.at)} ${fmtTime(r.at)}`).addTo(markerLayer));
    map.fitBounds(markerLayer.getBounds().pad(0.3), { maxZoom: 16 });
  }

  // ---------- data ----------
  async function load() {
    if (!url) return;
    const sep = url.includes('?') ? '&' : '?';
    try {
      const res = await fetch(url + sep + '_=' + Date.now(), { cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(res.status);
      const rows = parseCSV(await res.text());
      if (rows.length < 1) throw new Error('empty');
      const recs = toRecords(rows);
      const sig = JSON.stringify(recs);
      if (lastRows && sig === lastSig && startOfDay(new Date()).getTime() === lastDay) {
        // Nothing new: keep the map as-is, just refresh the "updated" stamps and "x min ago"
        document.querySelectorAll('#view-analytics .stamp').forEach(s => s.textContent = 'Updated ' + fmtTime(new Date()));
        const lastEl = root.querySelector('.last .muted');
        if (lastEl && recs[0]) lastEl.textContent = '(' + ago(recs[0].at) + ')';
        return;
      }
      lastRows = recs; lastSig = sig; lastDay = startOfDay(new Date()).getTime();
      render(lastRows);
    } catch (e) {
      if (lastRows) return; // keep showing the last good data
      root.innerHTML = `<div class="frame empty wide">Couldn’t load analytics right now. They’ll retry automatically.</div>`;
    }
  }

  return {
    start(csvUrl, el) { url = csvUrl; root = el; root.innerHTML = '<div class="frame empty wide">Loading analytics…</div>'; load(); },
    refresh() { load(); },
    _test: { parseCSV, toRecords, render: (recs, el) => { root = el; render(recs); } }
  };
})();
