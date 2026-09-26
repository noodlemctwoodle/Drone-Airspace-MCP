/**
 * Leaflet map used both as a standalone page (`/map?lat=&lon=`) and as the MCP
 * App view (`ui://uk-drone-airspace/map`). Same HTML; the app variant receives
 * its view descriptor from the host over postMessage and fetches the data from
 * the hosted API, while the page reads the query string.
 *
 * A custom layers panel offers Map / Satellite base layers and a checkbox per
 * overlay, grouped into Airspace, On the ground and Weather. Weather splits into
 * the conditions badge (Open-Meteo flyability for the coming hour), animated wind
 * streamlines over the visible map from `/api/wind`, and RainViewer rain-radar
 * tiles. Choices are
 * remembered in localStorage; `?basemap=satellite` opens the page in satellite.
 */
export const MAP_CSP = {
  resourceDomains: [
    'https://unpkg.com',
    'https://tile.openstreetmap.org',
    'https://a.tile.openstreetmap.org',
    'https://b.tile.openstreetmap.org',
    'https://c.tile.openstreetmap.org',
    'https://server.arcgisonline.com',
    'https://tilecache.rainviewer.com',
  ],
  connectDomains: ['https://api.rainviewer.com'],
};

/** Base layers offered by the layer switcher. Esri World Imagery is the satellite view. */
export const BASEMAPS = {
  map: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
} as const;

/**
 * RainViewer publishes an index of recent radar frames; tiles hang off `host + path`.
 * The free tier serves tile zooms 0 to 7 only, so the map asks for 512 px tiles at
 * one zoom level down and lets Leaflet scale them: coarse (about 600 m per pixel)
 * but enough to see rain approaching.
 */
export const RADAR = {
  index: 'https://api.rainviewer.com/public/weather-maps.json',
  tileSuffix: '/512/{z}/{x}/{y}/2/1_1.png',
  maxNativeZoom: 7,
  /** Beyond this map zoom a radar pixel is a 30 px block, so the layer is hidden and the badge says so. */
  maxZoom: 13,
  attribution: 'Rain radar © RainViewer',
} as const;

/** Sections of the layers panel, in display order. */
export const SECTIONS = [
  ['airspace', 'Airspace'],
  ['ground', 'On the ground'],
  ['weather', 'Weather'],
] as const;

/**
 * Toggleable overlays. `shape` picks the swatch: area (filled square), line,
 * parking (P sign), icon (a ground hazard marker), pin (route dash and location
 * pin), badge (text panel), flow (streamlines), radar. A `locked` overlay is always drawn and cannot be
 * switched off: prohibited and restricted airspace and aerodrome FRZs must never
 * be hidden.
 */
export const OVERLAYS = [
  { key: 'prohibited', label: 'Prohibited / restricted', colour: '#c62828', section: 'airspace', shape: 'area', locked: true },
  { key: 'frz', label: 'Aerodrome FRZ', colour: '#ef6c00', section: 'airspace', shape: 'area', locked: true },
  { key: 'prison', label: 'Prison (no-fly)', colour: '#6d4c41', section: 'airspace', shape: 'area', locked: true },
  { key: 'danger', label: 'Danger area', colour: '#f9a825', section: 'airspace', shape: 'area' },
  { key: 'other', label: 'Other airspace', colour: '#757575', section: 'airspace', shape: 'area' },
  { key: 'notam', label: 'NOTAM (temporary)', colour: '#6a1b9a', section: 'airspace', shape: 'area' },
  { key: 'prow', label: 'Public right of way', colour: '#2e7d32', section: 'ground', shape: 'line' },
  { key: 'land', label: 'Landowner rules', colour: '#00838f', section: 'ground', shape: 'area' },
  { key: 'access', label: 'Open access land', colour: '#7cb342', section: 'ground', shape: 'area' },
  { key: 'designation', label: 'Nature designations', colour: '#9e9d24', section: 'ground', shape: 'area' },
  { key: 'parking', label: 'Parking / layby', colour: '#1a56c4', section: 'ground', shape: 'parking' },
  { key: 'power', label: 'Power lines and pylons', colour: '#e65100', section: 'ground', shape: 'icon', icon: 'pylon' },
  { key: 'transport', label: 'Railways and major roads', colour: '#5d4037', section: 'ground', shape: 'icon', icon: 'railway' },
  { key: 'aviation', label: 'Helipads and military', colour: '#6a1b9a', section: 'ground', shape: 'icon', icon: 'helipad' },
  { key: 'sites', label: 'Schools and parks', colour: '#c6a700', section: 'ground', shape: 'icon', icon: 'school' },
  { key: 'route', label: 'Route and location', colour: '#2a81cb', section: 'ground', shape: 'pin' },
  { key: 'spots', label: 'Take-off spots', colour: '#2a81cb', section: 'ground', shape: 'spot' },
  { key: 'conditions', label: 'Conditions now', colour: '#4fc3f7', section: 'weather', shape: 'badge' },
  { key: 'wind', label: 'Wind flow', colour: '#4fc3f7', section: 'weather', shape: 'flow' },
  { key: 'radar', label: 'Rain radar', colour: '#4fc3f7', section: 'weather', shape: 'radar' },
] as const;

export function mapHtml(opts: { mode: 'page' | 'app'; apiBase: string | null }): string {
  const apiBase = JSON.stringify(opts.apiBase ?? '');
  const mode = JSON.stringify(opts.mode);
  const basemaps = JSON.stringify(BASEMAPS);
  const radar = JSON.stringify(RADAR);
  const overlays = JSON.stringify(OVERLAYS);
  const sections = JSON.stringify(SECTIONS);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK Drone Airspace map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  :root {
    color-scheme: light dark;
    --panel: rgba(255,255,255,.9); --ink: #16202a; --muted: #5f6b77; --line: rgba(16,24,32,.09);
    --accent: #1565c0; --good: #2e7d32; --caution: #ef6c00; --poor: #c62828;
    --shadow: 0 6px 20px rgba(16,24,32,.16), 0 0 0 1px rgba(16,24,32,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root { --panel: rgba(24,28,34,.9); --ink: #eef1f4; --muted: #9aa5b1; --line: rgba(255,255,255,.1); --shadow: 0 6px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
  }
  html, body { margin: 0; height: 100%; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--ink); background: #ddd; -webkit-font-smoothing: antialiased; }
  #map { position: absolute; inset: 0; }
  .card { background: var(--panel); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  h2, h3 { margin: 0; font-weight: 600; }

  /* Info card: place, counts, conditions */
  #info { position: absolute; top: 10px; right: 10px; z-index: 1000; width: 292px; max-width: calc(100vw - 20px); }
  #info .place { display: flex; align-items: center; gap: 8px; padding: 10px 12px 4px 14px; font-size: 14px; font-weight: 600; line-height: 1.3; cursor: pointer; user-select: none; }
  #info .place #place { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #info .place .chev { flex: none; width: 14px; height: 14px; color: var(--muted); transition: transform .15s; }
  #info .pill.mini { display: none; }
  #info.closed { width: auto; max-width: 292px; }
  #info.closed .place { padding-bottom: 10px; }
  #info.closed .place .chev { transform: rotate(-90deg); }
  #info.closed .pill.mini.on { display: inline-block; }
  #info.closed .chips, #info.closed #weather { display: none; }
  #info .chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 14px 11px; }
  .chip { font-size: 11.5px; line-height: 1; padding: 5px 8px; border-radius: 999px; background: rgba(128,140,152,.16); color: var(--ink); white-space: nowrap; }
  .chip b { font-weight: 600; }
  .chip.zero { color: var(--muted); }
  .drone-row { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; }
  .drone-row .lbl { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); flex: none; }
  .drone-row select { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; color: var(--ink); background: rgba(128,140,152,.16); border: 0; border-radius: 7px; padding: 5px 8px; }
  .drone-summary { display: none; padding: 0 14px 10px; font-size: 12px; color: var(--muted); line-height: 1.35; }
  .drone-summary.on { display: flex; gap: 8px; align-items: flex-start; }
  .drone-summary svg { flex: none; width: 22px; height: 22px; color: var(--ink); margin-top: -1px; }
  .drone-summary b { color: var(--ink); font-weight: 600; }
  #info.closed .drone-row, #info.closed .drone-summary { display: none; }
  .drone-pin { width: 44px; height: 52px; }
  .drone-pin svg { width: 44px; height: 52px; overflow: visible; filter: drop-shadow(0 2px 2px rgba(0,0,0,.4)); }
  #weather { display: none; border-top: 1px solid var(--line); padding: 10px 14px 12px; }
  #weather.on { display: block; }
  .wx-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .pill { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 4px 8px; border-radius: 999px; color: #fff; background: var(--muted); }
  .pill.good { background: var(--good); } .pill.caution { background: var(--caution); } .pill.poor { background: var(--poor); }
  .wx-when { color: var(--muted); font-size: 12.5px; }
  .wx-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 6px; }
  .wx-grid small { display: block; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
  .wx-grid b { display: block; font-size: 16px; font-weight: 600; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .wx-grid b i { font-size: 11px; font-style: normal; font-weight: 500; color: var(--muted); margin-left: 1px; }
  .wx-grid span { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--muted); }
  .wx-grid .dir { width: 10px; height: 10px; display: inline-block; }
  .wx-foot { margin-top: 9px; font-size: 11.5px; color: var(--muted); line-height: 1.35; }
  .wx-foot .why { color: var(--caution); }
  .wx-foot .why.poor { color: var(--poor); }

  /* Sources: collapsed credit line that expands to the full attribution */
  #sources { position: absolute; right: 10px; bottom: 10px; z-index: 1000; max-width: min(380px, calc(100vw - 20px)); font-size: 11.5px; }
  #sources button { all: unset; display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 11px; color: var(--muted); white-space: nowrap; }
  #sources button .chev { width: 11px; height: 11px; transition: transform .15s; }
  #sources.open button .chev { transform: rotate(180deg); }
  #sources ul { display: none; list-style: none; margin: 0; padding: 0 12px 8px; color: var(--ink); }
  #sources.open ul { display: block; }
  #sources li { padding: 5px 0; border-top: 1px solid var(--line); line-height: 1.35; }

  /* Layers panel */
  .layers { width: 256px; max-height: calc(100vh - 30px); overflow: auto; font-size: 13px; margin: 0 0 10px 10px !important; }
  .layers h2 { padding: 9px 12px 9px 14px; font-size: 13.5px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; }
  .layers h2 .chev { width: 14px; height: 14px; transition: transform .15s; color: var(--muted); }
  .layers.closed h2 .chev { transform: rotate(-90deg); }
  .layers.closed .body { display: none; }
  .layers .body { padding: 0 8px 10px; }
  .layers h3 { display: flex; align-items: center; gap: 8px; margin: 8px 6px 4px; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
  .layers h3::after { content: ''; flex: 1; border-top: 1px solid var(--line); }
  .layers .seg { display: flex; margin: 2px 6px 4px; padding: 3px; background: rgba(128,140,152,.16); border-radius: 9px; }
  .layers .seg label { flex: 1; cursor: pointer; }
  .layers .seg input { display: none; }
  .layers .seg span { display: block; text-align: center; padding: 4px 0; border-radius: 6px; color: var(--muted); font-weight: 500; }
  .layers .seg input:checked + span { background: var(--panel); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.18); }
  .layers .row { display: flex; align-items: center; gap: 9px; padding: 4px 6px; border-radius: 7px; cursor: pointer; }
  .layers .row:hover { background: rgba(128,140,152,.14); }
  .layers .row input { margin: 0; width: 15px; height: 15px; accent-color: var(--accent); flex: none; }
  .layers .row .lbl { flex: 1; }
  .layers .row.locked { cursor: default; }
  .layers .row.locked:hover { background: none; }
  .layers .row .lock { flex: none; width: 15px; height: 15px; color: var(--muted); }
  .layers .row .lock svg { width: 15px; height: 15px; display: block; }
  .layers .row .count { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .layers .row.off .sw, .layers .row.off .count { opacity: .35; }
  .layers .row.off .lbl { color: var(--muted); }
  .sw { flex: none; width: 20px; height: 14px; position: relative; }
  .sw-area { background: var(--c); border: 1.5px solid var(--c); border-radius: 4px; background-clip: padding-box; opacity: .8; }
  .sw-line, .sw-route { height: 0; border-top: 3px solid var(--c); margin: 6px 0; border-radius: 2px; }
  .sw-route { border-top-style: dashed; }
  .sw-pin { display: flex; align-items: center; justify-content: center; height: 16px; }
  .sw-pin svg { width: 12px; height: 16px; }
  .pin { width: 26px; height: 36px; }
  .pin svg { width: 26px; height: 36px; overflow: visible; filter: drop-shadow(0 2px 2px rgba(0,0,0,.4)); }
  .sw-dot { width: 12px; height: 12px; margin: 1px 4px; border-radius: 50%; background: var(--c); border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
  .sw-icon { display: flex; align-items: center; justify-content: center; height: 16px; }
  .sw-icon svg { width: 17px; height: 17px; }
  .hz { width: 22px; height: 22px; }
  .hz svg { width: 22px; height: 22px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
  .sw-parking { box-sizing: border-box; width: 18px; height: 18px; margin: 0 1px; border-radius: 4px; background: var(--c); color: #fff; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.2); display: flex; align-items: center; justify-content: center; font: 700 11px/1 -apple-system, system-ui, sans-serif; }
  .sw-parking::after { content: 'P'; }
  .p-sign { width: 24px; height: 24px; }
  .p-sign svg { width: 24px; height: 24px; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
  .sw-spot { width: 16px; height: 16px; margin: -1px 2px; border-radius: 50%; background: var(--c); color: #fff; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.2); font: 700 10px/13px -apple-system, system-ui, sans-serif; text-align: center; }
  .sw-spot::after { content: '1'; }
  .spot { width: 26px; height: 26px; }
  .spot div { width: 26px; height: 26px; border-radius: 50%; background: #2a81cb; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.45); font: 700 13px/22px -apple-system, system-ui, sans-serif; text-align: center; }
  .sw-badge { border: 1.5px solid var(--c); border-radius: 3px; }
  .sw-badge::after { content: ''; position: absolute; left: 4px; right: 4px; top: 4px; border-top: 2px solid var(--c); box-shadow: 0 4px 0 var(--c); }
  .sw-flow::before, .sw-flow::after { content: ''; position: absolute; left: 0; right: 0; height: 0; border-top: 2px solid var(--c); border-radius: 2px; }
  .sw-flow::before { top: 3px; right: 5px; } .sw-flow::after { top: 9px; left: 5px; }
  .sw-radar { border-radius: 4px; background: repeating-linear-gradient(135deg, var(--c) 0 3px, transparent 3px 6px); opacity: .75; }

  /* Leaflet chrome to match */
  .leaflet-bar { border: 0; border-radius: 10px; box-shadow: var(--shadow); overflow: hidden; }
  .leaflet-bar a, .leaflet-bar a:hover { background: var(--panel); color: var(--ink); border-bottom: 1px solid var(--line); width: 30px; height: 30px; line-height: 30px; }
  .leaflet-bar a:last-child { border-bottom: 0; }
  .leaflet-popup-content-wrapper, .leaflet-tooltip { background: var(--panel); color: var(--ink); border-radius: 10px; box-shadow: var(--shadow); border: 0; }
  .leaflet-popup-tip { background: var(--panel); }
  .leaflet-popup-content { font-size: 13px; margin: 10px 14px; line-height: 1.4; }
  .leaflet-tooltip { font-size: 12px; padding: 4px 8px; }
  .leaflet-tooltip-top::before { border-top-color: var(--panel); }
  .wind-canvas { position: absolute; left: 0; top: 0; pointer-events: none; }
  .leaflet-zoom-anim .wind-canvas { visibility: hidden; }
</style>
</head>
<body>
<div id="map"></div>
<div id="info" class="card">
  <div class="place" id="info-head"><span id="place">Loading…</span><span class="pill mini" id="info-pill"></span><svg class="chev" viewBox="0 0 16 16"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
  <div class="chips" id="chips"></div>
  <div class="drone-row" id="drone-row"><span class="lbl">Your drone</span><select id="drone-select" aria-label="Your drone"><option value="">None</option></select></div>
  <div class="drone-summary" id="drone-summary"></div>
  <div id="weather"></div>
</div>
<div id="sources" class="card">
  <button type="button" id="sources-btn"><span id="sources-label">Sources</span><svg class="chev" viewBox="0 0 16 16"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
  <ul id="sources-list"></ul>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var API_BASE = ${apiBase};
  var MODE = ${mode};
  var BASEMAPS = ${basemaps};
  var RADAR = ${radar};
  var OVERLAYS = ${overlays};
  var SECTIONS = ${sections};
  var placeEl = document.getElementById('place'), chipsEl = document.getElementById('chips'), weatherBox = document.getElementById('weather');
  var sourcesEl = document.getElementById('sources'), sourcesLabel = document.getElementById('sources-label'), sourcesList = document.getElementById('sources-list');
  var loaded = false, dataSources = [];
  function setStatus(text) { placeEl.textContent = text; }
  document.getElementById('sources-btn').onclick = function () { sourcesEl.classList.toggle('open'); };
  var infoEl = document.getElementById('info'), infoPill = document.getElementById('info-pill');
  if (!recall('infoOpen', true)) infoEl.classList.add('closed');
  document.getElementById('info-head').onclick = function () { infoEl.classList.toggle('closed'); remember('infoOpen', !infoEl.classList.contains('closed')); };
  L.DomEvent.disableClickPropagation(document.getElementById('info'));
  L.DomEvent.disableClickPropagation(sourcesEl);
  L.DomEvent.disableScrollPropagation(document.getElementById('info'));
  function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function recall(key, fallback) { try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([54.5, -3], 6);
  // Radar tiles live above every base map (tile pane is 200, overlays 400) so switching Map / Satellite never covers them.
  map.createPane('radar').style.zIndex = '250';

  // Base layers. Satellite is imagery plus a place-name overlay so it stays readable.
  var streetMap = L.tileLayer(BASEMAPS.map.url, { maxZoom: 19, attribution: BASEMAPS.map.attribution });
  var satellite = L.layerGroup([
    L.tileLayer(BASEMAPS.satellite.url, { maxZoom: 19, maxNativeZoom: 18, attribution: BASEMAPS.satellite.attribution }),
    L.tileLayer(BASEMAPS.satellite.labels, { maxZoom: 19, maxNativeZoom: 18, opacity: 0.9 })
  ]);
  var wanted = (MODE === 'page' && new URLSearchParams(location.search).get('basemap')) || recall('basemap', 'map');
  (wanted === 'satellite' ? satellite : streetMap).addTo(map);
  // Credits: the active base map's short credit stays visible; everything else sits behind the Sources toggle.
  function updateSources() {
    var sat = map.hasLayer(satellite);
    sourcesLabel.textContent = sat ? '© Esri' : '© OpenStreetMap';
    var items = [sat ? BASEMAPS.satellite.attribution : 'Map tiles ' + BASEMAPS.map.attribution].concat(dataSources);
    if (map.hasLayer(groups.radar)) items.push(RADAR.attribution);
    items.push('Built with Leaflet');
    sourcesList.innerHTML = items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  }

  // One layer group per overlay so each can be switched off; hidden ones are remembered.
  var groups = {}, hidden = recall('hiddenOverlays', []), pinSwatch = null;
  OVERLAYS.forEach(function (o) {
    groups[o.key] = L.layerGroup();
    if (o.locked || hidden.indexOf(o.key) < 0) groups[o.key].addTo(map);
  });
  function setOverlay(key, on) {
    if (OVERLAYS.some(function (o) { return o.key === key && o.locked; }) && !on) return;
    if (on) { groups[key].addTo(map); hidden = hidden.filter(function (k) { return k !== key; }); }
    else { map.removeLayer(groups[key]); if (hidden.indexOf(key) < 0) hidden.push(key); }
    remember('hiddenOverlays', hidden);
    if (key === 'conditions' || key === 'wind' || key === 'radar') showWeather();
    if (key === 'radar') updateSources();
  }

  // Layers panel: base map switch plus a checkbox per overlay, grouped by section.
  // Ground hazards: a white tile with a glyph per kind, in the colour of its group (like a road sign).
  var HAZARD_GROUP = { power_line: 'power', minor_power_line: 'power', pylon: 'power', substation: 'power', power_generator: 'power',
    railway: 'transport', motorway: 'transport', trunk_road: 'transport', helipad: 'aviation', tower: 'aviation', military: 'aviation',
    school: 'sites', kindergarten: 'sites', hospital: 'sites', fire_station: 'sites', fuel_station: 'sites', park: 'sites', cemetery: 'sites' };
  var HAZARD_LABEL = { railway: 'Railway', motorway: 'Motorway', trunk_road: 'Trunk road', power_line: 'Power line', minor_power_line: 'Minor power line', pylon: 'Pylon', substation: 'Substation', power_generator: 'Power generator',
    helipad: 'Helipad', tower: 'Mast or tower', military: 'Military land', school: 'School', kindergarten: 'Nursery', hospital: 'Hospital', fire_station: 'Fire station', fuel_station: 'Fuel station', park: 'Park', cemetery: 'Cemetery' };
  var GLYPH = {
    pylon: ['M8 21L12 3l4 18M9.3 15h5.4M10.4 9.5h3.2M5 7.5h14', 0],
    substation: ['M13 2L5 13h6l-1 9 9-12h-6z', 1],
    power_generator: ['M12 21V10m0 0V3m0 7l6 3.5M12 10l-6 3.5', 0],
    power_line: ['M4 6h16M4 18h16M12 6v12', 0],
    minor_power_line: ['M4 12h16', 0],
    railway: ['M7 4h10v12H7zM8 8h8M9 16l-2 4m8-4l2 4M10 12.5h.5M13.5 12.5h.5', 0],
    motorway: ['M8 3l-4 18M16 3l4 18M12 3v4m0 4v4m0 4v2', 0],
    trunk_road: ['M8 3l-4 18M16 3l4 18M12 3v4m0 4v4m0 4v2', 0],
    helipad: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8.5 7v10m7-10v10m-7-5h7', 0],
    tower: ['M12 21V4m-5 3a7 7 0 0 1 10 0M9 10a4 4 0 0 1 6 0', 0],
    military: ['M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z', 0],
    school: ['M3 9l9-4 9 4-9 4zM7 11.5V17c0 2 10 2 10 0v-5.5', 0],
    kindergarten: ['M12 4a3 3 0 1 0 .1 0M6 21v-5a6 6 0 0 1 12 0v5', 0],
    hospital: ['M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', 1],
    fire_station: ['M12 2c0 5-5 7-5 12a5 5 0 0 0 10 0c0-3-2-4-3-6 0 3-2 3-2-6z', 1],
    fuel_station: ['M5 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17M5 21h9M7 6h5v4H7zM14 10h2v7a1.5 1.5 0 0 0 3 0V9l-2-2', 0],
    park: ['M12 22v-7M12 2L6 12h3l-4 5h14l-4-5h3z', 0],
    cemetery: ['M7 21V8a5 5 0 0 1 10 0v13zM12 10v6M9.5 12.5h5', 0]
  };
  function hazardSvg(kind, colour) {
    var g = GLYPH[kind] || GLYPH.military;
    return '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="4" fill="#fff" stroke="' + colour + '" stroke-width="2"/>' +
      '<path d="' + g[0] + '" ' + (g[1] ? 'fill="#333" stroke="none"' : 'fill="none" stroke="#333" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') + '/></svg>';
  }
  var hazardIcons = {};
  function hazardIcon(kind) {
    if (!hazardIcons[kind]) hazardIcons[kind] = L.divIcon({ className: 'hz', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12], html: hazardSvg(kind, COLOUR[HAZARD_GROUP[kind] || 'sites']) });
    return hazardIcons[kind];
  }
  function hazardLineStyle(kind, colour) {
    if (kind === 'minor_power_line') return { color: colour, weight: 1.5, opacity: 0.8, dashArray: '3 5' };
    if (kind === 'power_line') return { color: colour, weight: 2, opacity: 0.9, dashArray: '6 4' };
    if (kind === 'railway') return { color: colour, weight: 3, opacity: 0.85, dashArray: '8 5' };
    return { color: colour, weight: 3, opacity: 0.7 };
  }
  var LayersPanel = L.Control.extend({
    onAdd: function () {
      var el = L.DomUtil.create('div', 'layers card' + (recall('layersOpen', window.innerWidth > 600) ? '' : ' closed'));
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      var h = L.DomUtil.create('h2', '', el);
      h.innerHTML = 'Layers <svg class="chev" viewBox="0 0 16 16"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      h.onclick = function () { el.classList.toggle('closed'); remember('layersOpen', !el.classList.contains('closed')); };
      var body = L.DomUtil.create('div', 'body', el);
      var b = L.DomUtil.create('h3', '', body); b.textContent = 'Base map';
      var seg = L.DomUtil.create('div', 'seg', body);
      [['map', 'Map'], ['satellite', 'Satellite']].forEach(function (opt) {
        var lab = L.DomUtil.create('label', '', seg);
        var inp = L.DomUtil.create('input', '', lab); inp.type = 'radio'; inp.name = 'basemap'; inp.value = opt[0]; inp.checked = map.hasLayer(opt[0] === 'satellite' ? satellite : streetMap);
        var span = L.DomUtil.create('span', '', lab); span.textContent = opt[1];
        inp.onchange = function () {
          map.removeLayer(opt[0] === 'satellite' ? streetMap : satellite);
          (opt[0] === 'satellite' ? satellite : streetMap).addTo(map);
          remember('basemap', opt[0]);
          updateSources();
          if (map.hasLayer(groups.wind) && windCanvas._map) windCanvas._reset();
        };
      });
      SECTIONS.forEach(function (sec) {
        var hd = L.DomUtil.create('h3', '', body); hd.textContent = sec[1];
        OVERLAYS.filter(function (o) { return o.section === sec[0]; }).forEach(function (o) {
          var row = L.DomUtil.create('label', 'row' + (map.hasLayer(groups[o.key]) ? '' : ' off'), body);
          row.dataset.key = o.key;
          var inp;
          if (o.locked) {
            row.className += ' locked';
            row.title = 'Always shown';
            var lock = L.DomUtil.create('span', 'lock', row);
            lock.innerHTML = '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
          } else {
            inp = L.DomUtil.create('input', '', row); inp.type = 'checkbox'; inp.checked = map.hasLayer(groups[o.key]);
          }
          var sw = L.DomUtil.create('span', 'sw sw-' + o.shape, row); sw.style.setProperty('--c', o.colour);
          if (o.shape === 'pin') { sw.innerHTML = pinSvg(o.colour); pinSwatch = sw; }
          if (o.shape === 'icon') sw.innerHTML = hazardSvg(o.icon, o.colour);
          var lbl = L.DomUtil.create('span', 'lbl', row); lbl.textContent = o.label;
          L.DomUtil.create('span', 'count', row);
          if (inp) inp.onchange = function () { setOverlay(o.key, inp.checked); row.classList.toggle('off', !inp.checked); };
        });
      });
      return el;
    }
  });
  new LayersPanel({ position: 'bottomleft' }).addTo(map);
  updateSources();
  function setCounts(counts) {
    Array.prototype.forEach.call(document.querySelectorAll('.layers .row[data-key]'), function (row) {
      var n = counts[row.dataset.key];
      row.querySelector('.count').textContent = typeof n === 'number' ? String(n) : '';
    });
  }

  // Weather: rain radar tiles from RainViewer's latest frame, plus the conditions badge.
  var radarLayer = null, radarTime = null, currentWeather = null, currentCentre = null, pendingSpots = [];
  function spotIcon(rank) { return L.divIcon({ className: 'spot', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14], html: '<div>' + rank + '</div>' }); }
  var WIND_COLOUR = { good: '#2e7d32', caution: '#ef6c00', poor: '#c62828' };

  // Wind: animated streamlines on a canvas, as on a forecast chart. Particles are
  // advected through the field, interpolated bilinearly from the server's lattice,
  // and coloured by the advisory thresholds. Users who prefer reduced motion get a
  // still frame of short streaks instead.
  var LEVEL_RGB = { good: [46, 125, 50], caution: [239, 108, 0], poor: [198, 40, 40] };
  var LEVEL_RGB_SAT = { good: [156, 204, 101], caution: [255, 183, 77], poor: [239, 83, 80] };
  function buildGrid(field) {
    var dLat = field.spacingDeg, dLon = field.spacingDeg * 1.6, lim = field.limits || {};
    var pts = field.points.filter(function (p) { return p.directionDeg != null && p.windMs != null; });
    if (pts.length < 4) return null;
    var is = pts.map(function (p) { return Math.round(p.lat / dLat); }), js = pts.map(function (p) { return Math.round(p.lon / dLon); });
    var i0 = Math.min.apply(null, is), i1 = Math.max.apply(null, is), j0 = Math.min.apply(null, js), j1 = Math.max.apply(null, js);
    var ni = i1 - i0 + 1, nj = j1 - j0 + 1, n = ni * nj;
    var u = new Float32Array(n).fill(NaN), v = new Float32Array(n).fill(NaN), g = new Float32Array(n).fill(NaN), h = new Float32Array(n).fill(NaN);
    pts.forEach(function (p, k) {
      var idx = (is[k] - i0) * nj + (js[k] - j0), r = p.directionDeg * Math.PI / 180;
      u[idx] = -p.windMs * Math.sin(r); v[idx] = -p.windMs * Math.cos(r); g[idx] = p.gustMs || 0; h[idx] = p.wind120Ms || 0;
    });
    function bilinear(a, i, j, ti, tj) {
      var a00 = a[i * nj + j], a01 = a[i * nj + j + 1], a10 = a[(i + 1) * nj + j], a11 = a[(i + 1) * nj + j + 1];
      return a00 * (1 - ti) * (1 - tj) + a01 * (1 - ti) * tj + a10 * ti * (1 - tj) + a11 * ti * tj;
    }
    return {
      sample: function (lat, lon) {
        if (ni < 2 || nj < 2) return null;
        // Clamp to the grid so the flow continues to the edge of the view rather than stopping in a square.
        var fi = Math.max(0, Math.min(ni - 1.001, lat / dLat - i0)), fj = Math.max(0, Math.min(nj - 1.001, lon / dLon - j0));
        var i = Math.floor(fi), j = Math.floor(fj);
        var U = bilinear(u, i, j, fi - i, fj - j);
        if (isNaN(U)) return null;
        var V = bilinear(v, i, j, fi - i, fj - j), speed = Math.hypot(U, V);
        var G = bilinear(g, i, j, fi - i, fj - j), H = bilinear(h, i, j, fi - i, fj - j);
        var level = (G >= lim.gustNoFlyMs || speed >= lim.windStrongMs) ? 'poor' : (speed >= lim.windCautionMs || H >= lim.windStrongMs) ? 'caution' : 'good';
        return { u: U, v: V, speed: speed, level: level };
      }
    };
  }
  var WindCanvas = L.Layer.extend({
    onAdd: function (map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'wind-canvas');
      map.getPane('wind').appendChild(this._canvas);
      this._ctx = this._canvas.getContext('2d');
      this._particles = [];
      this._reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      map.on('move', this._reset, this);
      map.on('resize', this._resize, this);
      this._resize();
    },
    onRemove: function (map) {
      map.off('move', this._reset, this);
      map.off('resize', this._resize, this);
      this._stop();
      L.DomUtil.remove(this._canvas);
    },
    setGrid: function (grid) { this._grid = grid; this._reset(); },
    _resize: function () {
      var size = this._map.getSize();
      this._canvas.width = size.x; this._canvas.height = size.y;
      this._reset();
    },
    _reset: function () {
      // Keep the canvas glued to the viewport and start the flow afresh for the new view.
      L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._particles = [];
      this._frames = 0;
      this._stop();
      if (this._grid) this._start();
    },
    _start: function () {
      var self = this;
      if (this._raf) return;
      var w = this._canvas.width, h = this._canvas.height, count = Math.min(1600, Math.round(w * h / 1200));
      while (this._particles.length < count) this._particles.push(this._spawn());
      function frame() {
        self._raf = null;
        self._step();
        self._frames++;
        if (self._reduced && self._frames > 45) return; // a still frame of streaks
        self._raf = requestAnimationFrame(frame);
      }
      this._raf = requestAnimationFrame(frame);
    },
    _stop: function () { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; },
    _spawn: function () { return { x: Math.random() * this._canvas.width, y: Math.random() * this._canvas.height, age: Math.floor(Math.random() * 80), life: 60 + Math.random() * 60 }; },
    _step: function () {
      var ctx = this._ctx, map = this._map, grid = this._grid, w = this._canvas.width, h = this._canvas.height;
      if (!grid) return;
      // Fade the previous frame so trails decay.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.93)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      var palette = map.hasLayer(satellite) ? LEVEL_RGB_SAT : LEVEL_RGB;
      // Pixels per frame per m/s: about 1 m/s = 0.3 px at zoom 13, doubling per zoom level. Each step is also
      // capped so that, zoomed right in, particles drift rather than race and the upwind edge stays populated.
      var scale = 0.3 * Math.pow(2, map.getZoom() - 13), maxStep = 1.2;
      var buckets = { good: [], caution: [], poor: [] };
      for (var k = 0; k < this._particles.length; k++) {
        var p = this._particles[k];
        if (p.age++ > p.life || p.x < 0 || p.y < 0 || p.x > w || p.y > h) { this._particles[k] = this._spawn(); continue; }
        var ll = map.containerPointToLatLng([p.x, p.y]);
        var s = grid.sample(ll.lat, ll.lng);
        if (!s || s.speed < 0.2) { this._particles[k] = this._spawn(); continue; }
        var step = Math.min(1, maxStep / Math.max(1e-6, s.speed * scale));
        var nx = p.x + s.u * scale * step, ny = p.y - s.v * scale * step;
        buckets[s.level].push(p.x, p.y, nx, ny);
        p.x = nx; p.y = ny;
      }
      for (var level in buckets) {
        var seg = buckets[level];
        if (!seg.length) continue;
        var c = palette[level];
        ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.85)';
        ctx.beginPath();
        for (var i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); }
        ctx.stroke();
      }
    }
  });
  map.createPane('wind').style.zIndex = '450'; // above zones and paths, below markers
  var windCanvas = new WindCanvas();
  var windTimer = null, windSeq = 0, windField = null;
  function fetchWind() {
    if (!API_BASE || !map.hasLayer(groups.wind)) return;
    var b = map.getBounds().pad(0.3); // fetch beyond the view so small pans stay covered
    if (!(b.getEast() > b.getWest()) || !(b.getNorth() > b.getSouth())) return; // not laid out yet
    var seq = ++windSeq;
    fetch(API_BASE + '/api/wind?bbox=' + [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (v) { return v.toFixed(4); }).join(',') + '&z=' + map.getZoom())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (field) { if (seq !== windSeq) return; windField = field; drawWind(); })
      .catch(function () { /* wind is optional */ });
  }
  function drawWind() {
    if (!windField || !map.hasLayer(groups.wind)) return;
    if (!groups.wind.hasLayer(windCanvas)) windCanvas.addTo(groups.wind);
    windCanvas.setGrid(buildGrid(windField));
  }
  function showWind() {
    if (!map.hasLayer(groups.wind)) { groups.wind.clearLayers(); return; }
    if (windTimer) clearTimeout(windTimer);
    windTimer = setTimeout(fetchWind, 250);
  }
  map.on('moveend', showWind);
  map.on('zoomend', function () { if (map.hasLayer(groups.radar)) showWeather(); });


  function ensureRadar() {
    if (radarLayer) return;
    radarLayer = L.layerGroup().addTo(groups.radar);
    fetch(RADAR.index).then(function (r) { return r.json(); }).then(function (idx) {
      var frames = (idx && idx.radar && idx.radar.past) || [];
      var last = frames[frames.length - 1];
      if (!last || !idx.host) return;
      radarTime = new Date(last.time * 1000);
      L.tileLayer(idx.host + last.path + RADAR.tileSuffix, { pane: 'radar', opacity: 0.6, tileSize: 512, zoomOffset: -1, maxZoom: RADAR.maxZoom, maxNativeZoom: RADAR.maxNativeZoom, attribution: RADAR.attribution }).addTo(radarLayer);
      showWeather();
    }).catch(function () { /* radar is optional */ });
  }
  function showWeather() {
    if (map.hasLayer(groups.radar)) ensureRadar();
    showWind();
    var rated = currentWeather && map.hasLayer(groups.conditions);
    infoPill.className = 'pill mini' + (rated ? ' on ' + currentWeather.flyability : '');
    infoPill.textContent = rated ? currentWeather.flyability : '';
    if (!map.hasLayer(groups.conditions)) { weatherBox.className = ''; return; }
    var w = currentWeather, html = '';
    function num(v, unit) { return v == null ? '<b>–</b>' : '<b>' + Math.round(v) + '<i>' + unit + '</i></b>'; }
    if (w) {
      var dir = w.windDirectionDeg == null ? '' : '<svg class="dir" viewBox="0 0 10 10" style="transform:rotate(' + ((w.windDirectionDeg + 180) % 360).toFixed(0) + 'deg)"><path d="M5 0.5 L9 6 L5 4.5 L1 6 Z" fill="currentColor"/></svg>';
      html = '<div class="wx-head"><span class="pill ' + esc(w.flyability) + '">' + esc(w.flyability) + '</span><span class="wx-when">' + esc(w.time.slice(11, 16)) + ' · ' + esc(w.summary) + '</span></div>' +
        '<div class="wx-grid">' +
        '<div><small>Wind</small>' + num(w.windMs, ' m/s') + '<span>' + dir + (w.windFrom ? 'from ' + esc(w.windFrom) : '') + '</span></div>' +
        '<div><small>Gusts</small>' + num(w.gustMs, ' m/s') + '</div>' +
        '<div><small>At 120 m</small>' + num(w.wind120Ms, ' m/s') + '</div>' +
        '<div><small>Temp</small>' + num(w.temperatureC, ' °C') + '</div>' +
        '</div>';
      var foot = [];
      if (w.reasons.length) foot.push('<span class="why ' + esc(w.flyability) + '">' + esc(w.reasons.join(', ')) + '</span>');
      if (map.hasLayer(groups.radar)) foot.push(map.getZoom() > RADAR.maxZoom ? 'Radar hidden at this zoom' : radarTime ? 'Radar ' + radarTime.toISOString().slice(11, 16) + ' UTC' : 'Radar loading…');
      if (foot.length) html += '<div class="wx-foot">' + foot.join(' · ') + '</div>';
    } else {
      html = '<div class="wx-foot">' + (loaded ? 'No forecast for this point' : 'Loading conditions…') + (map.hasLayer(groups.radar) && radarTime ? ' · Radar ' + radarTime.toISOString().slice(11, 16) + ' UTC' : '') + '</div>';
    }
    weatherBox.innerHTML = html;
    weatherBox.className = 'on';
  }

  var COLOUR = {};
  OVERLAYS.forEach(function (o) { COLOUR[o.key] = o.colour; });
  // Location pin: one drawing for the map marker and the key.
  function pinSvg(colour) {
    return '<svg viewBox="0 0 26 36"><path d="M13 1C6.4 1 1 6.3 1 12.9c0 8.6 10.2 20.4 11.3 21.6a1 1 0 0 0 1.4 0C14.8 33.3 25 21.5 25 12.9 25 6.3 19.6 1 13 1z" fill="' + colour + '" stroke="#fff" stroke-width="1.5"/>' +
      '<circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>';
  }
  var pinIcon = L.divIcon({ className: 'pin', iconSize: [26, 36], iconAnchor: [13, 35], popupAnchor: [0, -30], html: pinSvg(COLOUR.route) });

  // Your drone: pick a catalogue model and it becomes the location marker, the key swatch and a rules line in the card.
  var droneIndex = null, selectedDroneId = recall('droneId', ''), centreMarker = null;
  var droneSelect = document.getElementById('drone-select'), droneSummary = document.getElementById('drone-summary');
  function droneById(id) { return droneIndex && id ? droneIndex.drones.find(function (d) { return d.id === id; }) || null : null; }
  function silhouette(d, size) { return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' + droneIndex.silhouettes[d.silhouette] + '</svg>'; }
  function droneMarkerIcon(d) {
    return L.divIcon({ className: 'drone-pin', iconSize: [44, 52], iconAnchor: [22, 51], popupAnchor: [0, -44], html:
      '<svg viewBox="0 0 44 52"><path d="M14 36 L22 51 L30 36 Z" fill="' + COLOUR.route + '"/>' +
      '<circle cx="22" cy="22" r="19" fill="#fff" stroke="' + COLOUR.route + '" stroke-width="2.5"/>' +
      '<g transform="translate(8 8) scale(0.4375)" style="color:' + COLOUR.route + '">' + droneIndex.silhouettes[d.silhouette] + '</g></svg>' });
  }
  function currentPinIcon() { var d = droneById(selectedDroneId); return d ? droneMarkerIcon(d) : pinIcon; }
  function applyDrone() {
    var d = droneById(selectedDroneId);
    if (droneSelect.value !== (d ? d.id : '')) droneSelect.value = d ? d.id : '';
    if (centreMarker) centreMarker.setIcon(currentPinIcon());
    if (pinSwatch) pinSwatch.innerHTML = d ? silhouette(d, 18) : pinSvg(COLOUR.route);
    if (d) {
      droneSummary.innerHTML = silhouette(d, 22) + '<span><b>' + esc(d.make + ' ' + d.model) + '</b> · ' + esc(d.weightG) + ' g' + (d.classMark ? ', ' + esc(d.classMark) : '') + ' · <b>' + esc(d.subcategory) + '</b><br>' + esc(d.overflight) + '</span>';
      droneSummary.className = 'drone-summary on';
    } else {
      droneSummary.className = 'drone-summary';
    }
  }
  function selectDrone(id, persist) {
    selectedDroneId = id || '';
    if (persist) remember('droneId', selectedDroneId);
    applyDrone();
  }
  droneSelect.onchange = function () { selectDrone(droneSelect.value, true); };
  if (API_BASE) {
    fetch(API_BASE + '/api/drones').then(function (r) { return r.json(); }).then(function (idx) {
      droneIndex = idx;
      var byMake = {};
      idx.drones.forEach(function (d) { (byMake[d.make] = byMake[d.make] || []).push(d); });
      Object.keys(byMake).sort().forEach(function (make) {
        var g = document.createElement('optgroup'); g.label = make;
        byMake[make].forEach(function (d) { var o = document.createElement('option'); o.value = d.id; o.textContent = d.model + ' · ' + d.weightG + ' g' + (d.classMark ? ' · ' + d.classMark : ''); g.appendChild(o); });
        droneSelect.appendChild(g);
      });
      applyDrone();
    }).catch(function () { document.getElementById('drone-row').style.display = 'none'; });
  } else {
    document.getElementById('drone-row').style.display = 'none';
  }
  // Parking: a UK-style sign, blue square with a white P.
  var parkingIcon = L.divIcon({ className: 'p-sign', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12], html:
    '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="4" fill="' + COLOUR.parking + '" stroke="#fff" stroke-width="1.5"/>' +
    '<text x="12" y="17.5" text-anchor="middle" font-family="-apple-system, Segoe UI, system-ui, sans-serif" font-weight="700" font-size="15" fill="#fff">P</text></svg>' });
  function zoneGroup(p) {
    if (p.zoneType === 'prohibited' || p.zoneType === 'restricted') return 'prohibited';
    if (p.zoneType === 'frz' || p.zoneType === 'danger' || p.zoneType === 'prison') return p.zoneType;
    return 'other';
  }

  // If the pane is resized just after the first render (embedded hosts lay out late), fit the view again.
  var viewBounds = null, viewFittedAt = 0;
  window.addEventListener('resize', function () { if (viewBounds && Date.now() - viewFittedAt < 3000) { map.invalidateSize(); map.fitBounds(viewBounds, { padding: [20, 20] }); } });
  function render(view) {
    OVERLAYS.forEach(function (o) { if (o.section !== 'weather') groups[o.key].clearLayers(); });
    var counts = { prohibited: 0, frz: 0, prison: 0, danger: 0, other: 0, notam: view.notams.length, prow: view.rightsOfWay.length, land: 0, access: 0, designation: 0, parking: view.parking.length, power: 0, transport: 0, aviation: 0, sites: 0, spots: 0 };
    var b = view.bbox;
    viewBounds = [[b[1], b[0]], [b[3], b[2]]]; viewFittedAt = Date.now();
    map.fitBounds(viewBounds, { padding: [20, 20] });
    var seenLand = {};
    view.landRestrictions.forEach(function (f) {
      var key = f.properties.kind === 'access_land' ? 'access' : f.properties.kind === 'designation' ? 'designation' : 'land';
      var entryKey = key + ':' + (f.properties.entryId || f.properties.name);
      if (!seenLand[entryKey]) { seenLand[entryKey] = 1; counts[key]++; }
      L.geoJSON(f, { style: { color: COLOUR[key], weight: 1, fillOpacity: key === 'land' ? 0.18 : 0.1 } }).bindPopup('<b>' + esc(f.properties.name) + '</b><br>' + esc(f.properties.owner) + (f.properties.takeoffBanned ? '<br>Take-off not permitted' : key === 'access' ? '<br>Open access land: not a take-off permission' : key === 'designation' ? '<br>Advisory designation' : '')).addTo(groups[key]);
    });
    (view.hazards || []).forEach(function (f) {
      var kind = f.properties.kind, key = HAZARD_GROUP[kind] || 'sites', colour = COLOUR[key];
      counts[key]++;
      var label = '<b>' + esc(HAZARD_LABEL[kind] || kind) + '</b>' + (f.properties.name ? '<br>' + esc(f.properties.name) : '') + (f.properties.operator ? '<br>' + esc(f.properties.operator) : '');
      if (f.geometry.type === 'Point') L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: hazardIcon(kind) }).bindPopup(label).addTo(groups[key]);
      else if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') L.geoJSON(f, { style: hazardLineStyle(kind, colour) }).bindPopup(label).addTo(groups[key]);
      else {
        var poly = L.geoJSON(f, { style: { color: colour, weight: 1.5, opacity: 0.9, fillOpacity: 0.12 } }).bindPopup(label).addTo(groups[key]);
        L.marker(poly.getBounds().getCenter(), { icon: hazardIcon(kind), interactive: false }).addTo(groups[key]);
      }
    });
    view.zones.forEach(function (f) {
      var key = zoneGroup(f.properties);
      L.geoJSON(f, { style: { color: COLOUR[key], weight: 2, fillOpacity: f.properties.relevant ? 0.22 : 0.06, dashArray: f.properties.relevant ? null : '6 6' } })
        .bindPopup('<b>' + esc(f.properties.designator || '') + ' ' + esc(f.properties.name) + '</b><br>' + esc(f.properties.label) + '<br>' + esc(f.properties.limits) + (f.properties.relevant ? '' : '<br><i>Above 400 ft only</i>')).addTo(groups[key]);
    });
    view.notams.forEach(function (n) {
      L.circle([n.lat, n.lon], { radius: n.radiusKm * 1000, color: COLOUR.notam, weight: 1.5, fillOpacity: 0.12 }).bindPopup('<b>NOTAM ' + esc(n.id) + '</b><br>' + esc(n.itemE)).addTo(groups.notam);
    });
    view.rightsOfWay.forEach(function (f) {
      L.geoJSON(f, { style: { color: COLOUR.prow, weight: 3, opacity: 0.9 } }).bindPopup('<b>Public ' + esc(f.properties.pathType.replace('_', ' ')) + (f.properties.routeNo ? ' ' + esc(f.properties.routeNo) : '') + '</b><br>' + esc(f.properties.authority) + '<br>' + f.properties.distanceM + ' m from the point').addTo(groups.prow);
    });
    view.parking.forEach(function (p) {
      L.marker([p.lat, p.lon], { icon: parkingIcon, keyboard: false }).bindPopup('<b>' + esc(p.name || (p.kind === 'layby' ? 'Layby' : 'Car park')) + '</b><br>' + p.distanceM + ' m away' + (p.fee === 'yes' ? '<br>Pay to park' : p.fee === 'no' ? '<br>Free' : '')).addTo(groups.parking);
    });
    if (view.route && view.route.length > 1) {
      L.polyline(view.route.map(function (p) { return [p[1], p[0]]; }), { color: COLOUR.route, weight: 3, dashArray: '8 6' }).addTo(groups.route);
    }
    centreMarker = L.marker([view.centre.lat, view.centre.lon], { icon: currentPinIcon() }).bindPopup(esc(view.centre.name || 'Your location')).addTo(groups.route);
    pendingSpots.forEach(function (s) { L.marker([s.lat, s.lon], { icon: spotIcon(s.rank) }).bindPopup('<b>Spot ' + esc(s.rank) + '</b><br>' + esc(s.label)).addTo(groups.spots); });
    counts.spots = pendingSpots.length;
    currentWeather = view.weather || null;
    currentCentre = [view.centre.lat, view.centre.lon];
    loaded = true;
    setStatus(view.centre.name || (view.route ? 'Your route' : 'Your location'));
    view.zones.forEach(function (f) { counts[zoneGroup(f.properties)]++; });
    setCounts(counts);
    var relevant = view.zones.filter(function (f) { return f.properties.relevant; }).length;
    chipsEl.innerHTML = [
      [relevant, 'zone', 'zones', 'below 400 ft'], [view.notams.length, 'NOTAM', 'NOTAMs'], [view.rightsOfWay.length, 'path', 'paths'], [view.parking.length, 'parking spot', 'parking spots'], [counts.land, 'landowner rule', 'landowner rules'], [counts.access, 'access area', 'access areas'], [counts.power + counts.transport + counts.aviation + counts.sites, 'hazard', 'hazards']
    ].map(function (c) { return '<span class="chip' + (c[0] ? '' : ' zero') + '"><b>' + c[0] + '</b> ' + (c[0] === 1 ? c[1] : c[2]) + (c[3] ? ' ' + c[3] : '') + '</span>'; }).join('');
    dataSources = view.attribution || [];
    updateSources();
    showWeather();
  }

  function load(req) {
    pendingSpots = Array.isArray(req.spots) ? req.spots.filter(function (s) { return typeof s.lat === 'number' && typeof s.lon === 'number'; }).map(function (s, i) { return { lat: s.lat, lon: s.lon, rank: s.rank || i + 1, label: s.label || 'Spot ' + (i + 1) }; }) : [];
    if (!API_BASE) { setStatus('Map data needs the hosted server'); if (typeof req.lat === 'number') { map.setView([req.lat, req.lon], 13); centreMarker = L.marker([req.lat, req.lon], { icon: currentPinIcon() }).addTo(groups.route); } return; }
    var q = new URLSearchParams();
    if (typeof req.lat === 'number' && typeof req.lon === 'number') { q.set('lat', req.lat); q.set('lon', req.lon); }
    if (req.place) q.set('place', req.place);
    if (req.radiusM) q.set('radius', req.radiusM);
    if (req.route && req.route.length > 1) q.set('route', req.route.map(function (p) { return p[0] + ',' + p[1]; }).join(';'));
    if (req.waypoints && req.waypoints.length > 1) q.set('waypoints', req.waypoints.map(function (w) { return Array.isArray(w) ? w[0] + ',' + w[1] : w; }).join(';'));
    setStatus('Loading…');
    fetch(API_BASE + '/api/view?' + q.toString()).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(render).catch(function (e) { setStatus('Could not load map data: ' + e.message); });
  }

  if (MODE === 'page') {
    var qs = new URLSearchParams(location.search);
    var lat = parseFloat(qs.get('lat')), lon = parseFloat(qs.get('lon'));
    var route = (qs.get('route') || '').split(';').filter(Boolean).map(function (s) { return s.split(',').map(parseFloat); });
    var wps = (qs.get('waypoints') || '').split(';').filter(Boolean);
    if (qs.get('drone')) selectDrone(qs.get('drone'), true);
    var spots = (qs.get('spots') || '').split(';').filter(Boolean).map(function (s, i) { var p = s.split(',').map(parseFloat); return { lat: p[0], lon: p[1], rank: i + 1, label: 'Spot ' + (i + 1) }; });
    if (isFinite(lat) && isFinite(lon)) load({ lat: lat, lon: lon, radiusM: parseFloat(qs.get('radius')) || undefined, route: route.length > 1 ? route : undefined, spots: spots });
    else if (qs.get('place')) load({ place: qs.get('place'), radiusM: parseFloat(qs.get('radius')) || undefined });
    else if (wps.length > 1) load({ waypoints: wps });
    else setStatus('Add ?lat=&lon= or ?place= to the URL');
  } else {
    // MCP App: JSON-RPC over postMessage with the host (ui/initialize, then ui/notifications/tool-result).
    var nextId = 1;
    function send(msg) { window.parent.postMessage(msg, '*'); }
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.jsonrpc !== '2.0') return;
      if (m.method === 'ui/notifications/tool-result' && m.params) {
        var meta = (m.params._meta && m.params._meta.ui) || {};
        if (meta.view && meta.view.drone) selectDrone(meta.view.drone, true);
        if (meta.view) load(meta.view);
      } else if (m.method === 'ui/notifications/tool-input' && m.params && m.params.arguments) {
        var a = m.params.arguments;
        if (typeof a.lat === 'number' && typeof a.lon === 'number') load({ lat: a.lat, lon: a.lon, radiusM: a.search_radius_m });
        else if (typeof a.place === 'string') load({ place: a.place, radiusM: a.search_radius_m });
        else if (Array.isArray(a.waypoints)) load({ waypoints: a.waypoints });
      }
    });
    send({ jsonrpc: '2.0', id: nextId++, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appInfo: { name: 'uk-drone-airspace-map', version: '1' }, appCapabilities: {} } });
    send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    setStatus('Waiting for the tool result…');
  }
})();
</script>
</body>
</html>`;
}
