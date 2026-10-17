// The live results page served at /embed (iframe it on any website). Plain HTML + JS, no libraries.
//   /embed            follows the newest live race (switches by itself when a new one starts)
//   /embed/<raceId>   one race
//   ?view=board | map (default both) · ?title=0 hides the header

export function embedHtml(raceId: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baja75 Live</title>
<style>
:root{--bg:#0b0b0c;--panel:#151516;--panel2:#1c1c1e;--line:#2a2a2d;--text:#f2f0ed;--muted:#a3a09b;--orange:#ff7a00;--ok:#43c27a;--warn:#f2b84b;--bad:#ff5d5d;--info:#7fb2ff;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}.muted{color:var(--muted)}.small{font-size:12px}
header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.mark{background:var(--orange);color:#111;font-weight:800;border-radius:6px;padding:4px 7px;font-size:12px;letter-spacing:.04em}
h1{font-size:16px;margin:0;flex:1;min-width:160px}h1 span{display:block;font-size:12px;font-weight:400;color:var(--muted)}
.live{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:12px;letter-spacing:.08em;color:var(--bad)}
.live i{width:9px;height:9px;border-radius:50%;background:var(--bad);animation:p 1.2s infinite}.live.ended{color:var(--muted)}.live.ended i{background:var(--muted);animation:none}
@keyframes p{50%{opacity:.25}}
main{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;padding:12px}
main.board,main.map{grid-template-columns:1fr}
@media(max-width:760px){main{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;min-width:0}
table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;background:var(--panel2)}
td.r,th.r{text-align:right}tr.stale td{opacity:.55}
.pos{font-weight:800;font-size:15px;width:34px}.sw{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 7px;font-size:11px;font-weight:700;letter-spacing:.04em}
.chip.run{color:var(--info);border-color:#2a4466}.chip.fin{color:var(--ok);border-color:#1f5a3a}.chip.dnf{color:var(--bad);border-color:#6b2a2a}.chip.pos{color:var(--muted)}
.pen{color:var(--warn)}.wrap{overflow-x:auto}
svg{display:block;width:100%;height:auto;background:#101012}
.maphead{display:flex;justify-content:space-between;padding:7px 10px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)}
.empty{padding:28px;text-align:center;color:var(--muted)}
.list a{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none}.list a:hover{background:var(--panel2)}
.hide-sm{}@media(max-width:560px){.hide-sm{display:none}}
</style></head><body>
<header id="hdr"><span class="mark">B75</span><h1 id="title">Baja75 Live<span id="sub">Connecting…</span></h1><span id="live" class="live ended"><i></i><b>OFFLINE</b></span><span id="age" class="small muted"></span></header>
<main id="main"><div class="card"><div class="empty">Connecting…</div></div></main>
<script>
(function(){
const FIXED = ${JSON.stringify(raceId)};
const qs = new URLSearchParams(location.search);
const VIEW = qs.get('view') || 'both';
if (qs.get('title') === '0') document.getElementById('hdr').style.display = 'none';
const main = document.getElementById('main');
if (VIEW !== 'both') main.className = VIEW;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PAL = ['#ff7a00','#7fb2ff','#43c27a','#f2b84b','#d38cff','#ff5d8f','#4fd1c5','#c0c4cc','#a3e635','#fb923c'];
const color = (k) => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };
const fmt = (ms) => { if (ms == null) return '—'; ms = Math.max(0, Math.round(ms)); const h = Math.floor(ms/3600000), m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60, t = Math.floor(ms/100)%10;
  return (h ? h + ':' + String(m).padStart(2,'0') : m) + ':' + String(s).padStart(2,'0') + '.' + t; };
const PEN = [['offCourse','Off course','OC'],['speeding','Speeding','SP'],['missedVcps','Missed VCPs','VCP'],['wrongWay','Wrong way','WW'],['jumpStarts','Jump start','JS'],['recoveries','Recoveries','REC'],['damageHits','Damage','DMG']];
let race = null, trails = {}, recvAt = 0, ws = null, raceId = FIXED, pollT = null, lastMsg = 0, bounds = null;

function api(p){ return fetch(p, {cache:'no-store'}).then((r) => r.ok ? r.json() : Promise.reject(r.status)); }

async function pickRace(){
  if (FIXED) return FIXED;
  try {
    const d = await api('/api/races');
    const live = d.races.filter((r) => r.status === 'live');
    if (live.length) return live[0].id;
    showList(d.races); return null;
  } catch (e) { setStatus('offline'); return null; }
}
function showList(races){
  document.getElementById('sub').textContent = 'No race is live right now';
  setStatus('ended');
  main.className = 'board';
  main.innerHTML = '<div class="card list">' + (races.length ? races.map((r) => '<a href="/embed/' + esc(r.id) + location.search + '"><span><b>' + esc(r.name) + '</b><br><span class="small muted">' + esc(r.map) + ' · ' + new Date(r.startedAt).toLocaleString() + '</span></span><span class="small muted">' + (r.status === 'live' ? 'LIVE' : 'ended') + ' · ' + r.drivers + ' drivers</span></a>').join('') : '<div class="empty">No races yet. A race appears here when a driver starts a run on a server course.</div>') + '</div>';
}
function setStatus(s){
  const el = document.getElementById('live');
  el.className = 'live' + (s === 'live' ? '' : ' ended');
  el.querySelector('b').textContent = s === 'live' ? 'LIVE' : s === 'ended' ? 'FINISHED' : 'OFFLINE';
}
function connect(){
  if (ws) { try { ws.close(); } catch(e){} ws = null; }
  try {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/races/' + raceId + '/ws');
    ws.onmessage = (e) => { if (e.data === 'pong') return; onMsg(JSON.parse(e.data)); };
    ws.onclose = () => { ws = null; startPoll(); setTimeout(() => { if (!ws) connect(); }, 10000); };
  } catch (e) { startPoll(); }
}
function startPoll(){
  if (pollT) return;
  const tick = async () => { if (ws && ws.readyState === 1 && Date.now() - lastMsg < 20000) { pollT = null; return; }
    try { const r = await api('/api/races/' + raceId + (race ? '' : '?trails=1')); onMsg(race ? {type:'update', race:r, add:{}} : {type:'snapshot', race:r}); } catch(e){}
    pollT = setTimeout(tick, 3000); };
  pollT = setTimeout(tick, 100);
}
function onMsg(m){
  lastMsg = Date.now();
  if (m.type === 'missing') { raceId = FIXED ? raceId : null; return boot(); }
  if (m.type === 'snapshot') { race = m.race; trails = m.race.trails || {}; bounds = null; }
  if (m.type === 'update') { race = m.race; for (const k in (m.add || {})) (trails[k] = trails[k] || []).push(...m.add[k]); }
  recvAt = Date.now();
  render();
  if (!FIXED && race && race.status === 'ended') setTimeout(follow, 30000);
}
async function follow(){ const id = await pickRace(); if (id && id !== raceId) { raceId = id; race = null; trails = {}; connect(); } }
function render(){
  if (!race) return;
  document.getElementById('title').firstChild.textContent = race.name;
  document.getElementById('sub').textContent = [race.map, race.server].filter(Boolean).join(' · ');
  setStatus(race.status);
  const html = [];
  if (VIEW !== 'map') html.push(board());
  if (VIEW !== 'board') html.push(mapCard());
  main.innerHTML = html.join('');
}
function liveElapsed(d){
  if (d.state !== 'running' || d.elapsedMs == null) return d.state === 'finished' ? (d.finishMs != null ? d.finishMs : d.elapsedMs) : d.elapsedMs;
  return d.elapsedMs + Math.min(Date.now() - recvAt, 15000);
}
function board(){
  const ds = race.drivers.filter((d) => d.navUnit);
  if (!ds.length) return '<div class="card"><div class="empty">Waiting for drivers…</div></div>';
  const rows = ds.map((d) => {
    const stale = (race.now - d.lastSeen) > 15000;
    const st = d.state === 'running' ? '<span class="chip run">ON COURSE</span>' : d.state === 'finished' ? '<span class="chip fin">FINISHED</span>' : d.state === 'dnf' ? '<span class="chip dnf">DNF</span>' : '<span class="chip pos">' + esc(d.state.toUpperCase()) + '</span>';
    const pens = PEN.filter(([k]) => d.counters && d.counters[k]).map(([k,, a]) => a + ' ' + d.counters[k]);
    const resets = Math.max(d.counters && d.counters.resets || 0, d.serverResets || 0);
    if (resets) pens.push('RST ' + resets);
    const prog = d.lap != null && d.laps ? 'Lap ' + d.lap + '/' + d.laps : '';
    const rm = d.rm != null ? 'RM ' + d.rm.toFixed(1) + (d.routeMiles ? '/' + d.routeMiles.toFixed(1) : '') : (d.vcp ? 'VCP ' + d.vcp[0] + '/' + d.vcp[1] : '');
    return '<tr class="' + (stale ? 'stale' : '') + '"><td class="pos num">' + (d.rank || '—') + '</td><td><span class="sw" style="background:' + color(d.key) + '"></span><b>' + esc(d.name) + '</b>' + (d.number ? ' <span class="muted">#' + esc(d.number) + '</span>' : '') + '<div class="small muted hide-sm">' + esc(d.vehicle) + '</div></td>'
      + '<td>' + st + '</td><td class="r num"><b>' + fmt(liveElapsed(d)) + '</b></td><td class="small num hide-sm">' + [prog, rm].filter(Boolean).join(' · ') + '</td><td class="small pen">' + (pens.join(' · ') || '<span class="muted">—</span>') + '</td></tr>';
  }).join('');
  return '<div class="card wrap"><table><thead><tr><th>Pos</th><th>Driver</th><th>Status</th><th class="r">Time</th><th class="hide-sm">Progress</th><th>Penalties</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function grow(b, x, y){ if (!b) return {x0:x, x1:x, y0:y, y1:y}; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); return b; }
function mapCard(){
  let b = bounds;
  (race.route || []).forEach((p) => { b = grow(b, p[0], p[1]); });
  for (const k in trails) trails[k].forEach((p) => { b = grow(b, p[0], p[1]); });
  race.drivers.forEach((d) => { if (d.pos) b = grow(b, d.pos[0], d.pos[1]); });
  bounds = b;
  if (!b) return '<div class="card"><div class="maphead"><span>Live view</span></div><div class="empty">No positions yet</div></div>';
  const w = Math.max(b.x1 - b.x0, 200), h = Math.max(b.y1 - b.y0, 200), pad = Math.max(w, h) * 0.06;
  const vx = b.x0 - pad, vy = -(b.y1 + pad), vw = w + pad * 2, vh = h + pad * 2, u = Math.max(vw, vh) / 300;
  const P = (p) => p[0].toFixed(1) + ',' + (-p[1]).toFixed(1);
  let s = '<svg viewBox="' + [vx, vy, vw, vh].map((n) => n.toFixed(1)).join(' ') + '" role="img" aria-label="Live map">';
  if (race.route && race.route.length > 1) s += '<polyline points="' + race.route.map(P).join(' ') + '" fill="none" stroke="#5a3a1a" stroke-width="' + (u * 3.2) + '" stroke-linejoin="round" stroke-linecap="round"/>';
  for (const k in trails) if (trails[k].length > 1) s += '<polyline points="' + trails[k].map(P).join(' ') + '" fill="none" stroke="' + (race.route ? color(k) : '#3a3a3e') + '" stroke-opacity="' + (race.route ? .5 : .9) + '" stroke-width="' + (u * (race.route ? 1.2 : 2.4)) + '" stroke-linejoin="round" stroke-linecap="round"/>';
  const ds = [...race.drivers].filter((d) => d.pos).reverse();
  for (const d of ds) {
    const stale = (race.now - d.lastSeen) > 15000, c = color(d.key);
    const x = d.pos[0], y = -d.pos[1];
    s += '<g opacity="' + (stale ? .45 : 1) + '"><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (u * 4.5) + '" fill="' + c + '" stroke="#0b0b0c" stroke-width="' + (u * 1.2) + '"/>'
      + '<text x="' + (x + u * 6).toFixed(1) + '" y="' + (y + u * 3).toFixed(1) + '" font-size="' + (u * 9) + '" fill="#f2f0ed" stroke="#0b0b0c" stroke-width="' + (u * 2.4) + '" paint-order="stroke" font-weight="700">' + esc((d.rank ? 'P' + d.rank + ' ' : '') + (d.number ? '#' + d.number : d.name)) + (stale ? ' (last known)' : '') + '</text></g>';
  }
  s += '</svg>';
  const n = race.drivers.filter((d) => d.pos).length;
  return '<div class="card"><div class="maphead"><span>Live view · last known positions</span><span>' + n + ' car' + (n === 1 ? '' : 's') + (race.route ? '' : ' · route drawn from driven paths') + '</span></div>' + s + '</div>';
}
setInterval(() => {
  if (!race) return;
  const age = Math.round((Date.now() - recvAt) / 1000);
  document.getElementById('age').textContent = age > 4 ? 'updated ' + age + ' s ago' : '';
  if (race.status === 'live' && VIEW !== 'map') { const t = document.querySelectorAll('td.r b'); const ds = race.drivers.filter((d) => d.navUnit); t.forEach((el, i) => { if (ds[i]) el.textContent = fmt(liveElapsed(ds[i])); }); }
}, 250);
async function boot(){ raceId = await pickRace(); if (raceId) { connect(); } else setTimeout(boot, 15000); }
boot();
})();
</script></body></html>`;
}
