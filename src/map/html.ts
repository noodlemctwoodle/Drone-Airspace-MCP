/**
 * Leaflet map used both as a standalone page (`/map?lat=&lon=`) and as the MCP
 * App view (`ui://uk-drone-airspace/map`). Same HTML; the app variant receives
 * its view descriptor from the host over postMessage and fetches the data from
 * the hosted API, while the page reads the query string.
 */
export const MAP_CSP = {
  resourceDomains: ['https://unpkg.com', 'https://tile.openstreetmap.org', 'https://a.tile.openstreetmap.org', 'https://b.tile.openstreetmap.org', 'https://c.tile.openstreetmap.org'],
};

export function mapHtml(opts: { mode: 'page' | 'app'; apiBase: string | null }): string {
  const apiBase = JSON.stringify(opts.apiBase ?? '');
  const mode = JSON.stringify(opts.mode);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UK Drone Airspace map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  :root { color-scheme: light dark; --panel: rgba(255,255,255,.92); --ink: #1b1b1b; }
  @media (prefers-color-scheme: dark) { :root { --panel: rgba(30,30,30,.92); --ink: #eee; } }
  html, body { margin: 0; height: 100%; font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); background: #ddd; }
  #map { position: absolute; inset: 0; }
  #legend { position: absolute; left: 10px; bottom: 10px; z-index: 1000; background: var(--panel); padding: 8px 10px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.3); max-width: 280px; }
  #legend div { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
  .sw { width: 14px; height: 14px; border-radius: 3px; display: inline-block; }
  #status { position: absolute; top: 10px; right: 10px; z-index: 1000; background: var(--panel); padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
  #attrib { position: absolute; right: 10px; bottom: 10px; z-index: 1000; background: var(--panel); padding: 4px 8px; border-radius: 6px; font-size: 11px; max-width: 45%; }
  .leaflet-popup-content { font-size: 13px; }
</style>
</head>
<body>
<div id="map"></div>
<div id="status">Loading…</div>
<div id="legend">
  <div><span class="sw" style="background:#c62828"></span>Prohibited / restricted</div>
  <div><span class="sw" style="background:#ef6c00"></span>Aerodrome FRZ</div>
  <div><span class="sw" style="background:#f9a825"></span>Danger area</div>
  <div><span class="sw" style="background:#6a1b9a"></span>NOTAM (temporary)</div>
  <div><span class="sw" style="background:#2e7d32"></span>Public right of way</div>
  <div><span class="sw" style="background:#00838f;opacity:.5"></span>Landowner rule (NT, byelaw)</div>
  <div><span class="sw" style="background:#1565c0;border-radius:50%"></span>Parking / layby</div>
</div>
<div id="attrib"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var API_BASE = ${apiBase};
  var MODE = ${mode};
  var status = document.getElementById('status');
  var map = L.map('map', { zoomControl: true }).setView([54.5, -3], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  var layers = L.layerGroup().addTo(map);

  function colourFor(p) {
    if (p.zoneType === 'prohibited' || p.zoneType === 'restricted') return '#c62828';
    if (p.zoneType === 'frz') return '#ef6c00';
    if (p.zoneType === 'danger') return '#f9a825';
    return '#757575';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(view) {
    layers.clearLayers();
    var b = view.bbox;
    map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [20, 20] });
    view.landRestrictions.forEach(function (f) {
      L.geoJSON(f, { style: { color: '#00838f', weight: 1, fillOpacity: 0.18 } }).bindPopup('<b>' + esc(f.properties.name) + '</b><br>' + esc(f.properties.owner) + (f.properties.takeoffBanned ? '<br>Take-off not permitted' : '')).addTo(layers);
    });
    view.zones.forEach(function (f) {
      var c = colourFor(f.properties);
      L.geoJSON(f, { style: { color: c, weight: 2, fillOpacity: f.properties.relevant ? 0.22 : 0.06, dashArray: f.properties.relevant ? null : '6 6' } })
        .bindPopup('<b>' + esc(f.properties.designator || '') + ' ' + esc(f.properties.name) + '</b><br>' + esc(f.properties.label) + '<br>' + esc(f.properties.limits) + (f.properties.relevant ? '' : '<br><i>Above 400 ft only</i>')).addTo(layers);
    });
    view.notams.forEach(function (n) {
      L.circle([n.lat, n.lon], { radius: n.radiusKm * 1000, color: '#6a1b9a', weight: 1.5, fillOpacity: 0.12 }).bindPopup('<b>NOTAM ' + esc(n.id) + '</b><br>' + esc(n.itemE)).addTo(layers);
    });
    view.rightsOfWay.forEach(function (f) {
      L.geoJSON(f, { style: { color: '#2e7d32', weight: 3, opacity: 0.9 } }).bindPopup('<b>Public ' + esc(f.properties.pathType.replace('_', ' ')) + (f.properties.routeNo ? ' ' + esc(f.properties.routeNo) : '') + '</b><br>' + esc(f.properties.authority) + '<br>' + f.properties.distanceM + ' m from the point').addTo(layers);
    });
    view.parking.forEach(function (p) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: '#0d47a1', fillColor: '#1565c0', fillOpacity: 0.95, weight: 1.5 }).bindPopup('<b>' + esc(p.name || (p.kind === 'layby' ? 'Layby' : 'Car park')) + '</b><br>' + p.distanceM + ' m away' + (p.fee === 'yes' ? '<br>Pay to park' : p.fee === 'no' ? '<br>Free' : '')).addTo(layers);
    });
    if (view.route && view.route.length > 1) {
      L.polyline(view.route.map(function (p) { return [p[1], p[0]]; }), { color: '#111', weight: 3, dashArray: '8 6' }).addTo(layers);
    }
    L.marker([view.centre.lat, view.centre.lon]).bindPopup(esc(view.centre.name || 'Your location')).addTo(layers);
    document.getElementById('attrib').textContent = (view.attribution || []).join(' · ');
    status.textContent = view.zones.length + ' zone' + (view.zones.length === 1 ? '' : 's') + ', ' + view.rightsOfWay.length + ' paths, ' + view.parking.length + ' parking, ' + view.notams.length + ' NOTAMs';
  }

  function load(req) {
    if (!API_BASE) { status.textContent = 'Map data needs the hosted server'; if (typeof req.lat === 'number') { map.setView([req.lat, req.lon], 13); L.marker([req.lat, req.lon]).addTo(layers); } return; }
    var q = new URLSearchParams();
    if (typeof req.lat === 'number' && typeof req.lon === 'number') { q.set('lat', req.lat); q.set('lon', req.lon); }
    if (req.place) q.set('place', req.place);
    if (req.radiusM) q.set('radius', req.radiusM);
    if (req.route && req.route.length > 1) q.set('route', req.route.map(function (p) { return p[0] + ',' + p[1]; }).join(';'));
    if (req.waypoints && req.waypoints.length > 1) q.set('waypoints', req.waypoints.map(function (w) { return Array.isArray(w) ? w[0] + ',' + w[1] : w; }).join(';'));
    status.textContent = 'Loading…';
    fetch(API_BASE + '/api/view?' + q.toString()).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(render).catch(function (e) { status.textContent = 'Could not load map data: ' + e.message; });
  }

  if (MODE === 'page') {
    var qs = new URLSearchParams(location.search);
    var lat = parseFloat(qs.get('lat')), lon = parseFloat(qs.get('lon'));
    var route = (qs.get('route') || '').split(';').filter(Boolean).map(function (s) { return s.split(',').map(parseFloat); });
    var wps = (qs.get('waypoints') || '').split(';').filter(Boolean);
    if (isFinite(lat) && isFinite(lon)) load({ lat: lat, lon: lon, radiusM: parseFloat(qs.get('radius')) || undefined, route: route.length > 1 ? route : undefined });
    else if (qs.get('place')) load({ place: qs.get('place'), radiusM: parseFloat(qs.get('radius')) || undefined });
    else if (wps.length > 1) load({ waypoints: wps });
    else status.textContent = 'Add ?lat=&lon= or ?place= to the URL';
  } else {
    // MCP App: JSON-RPC over postMessage with the host (ui/initialize, then ui/notifications/tool-result).
    var nextId = 1;
    function send(msg) { window.parent.postMessage(msg, '*'); }
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.jsonrpc !== '2.0') return;
      if (m.method === 'ui/notifications/tool-result' && m.params) {
        var meta = (m.params._meta && m.params._meta.ui) || {};
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
    status.textContent = 'Waiting for the tool result…';
  }
})();
</script>
</body>
</html>`;
}
