import { useEffect, useMemo, useRef, useState } from 'react';
import { history } from '../domain/actions';
import { embedCode, estimatePenaltyMs, liveElapsed, liveResets, parseLiveLink, type LiveDriver, type LiveRace, type LiveRaceSummary } from '../domain/live';
import { activeSlot, refLabel, refOf, sheetOf } from '../domain/presets';
import { formatMs } from '../domain/time';
import { SHEET_SLOTS, type SheetSlot } from '../domain/types';
import { useStore } from '../store/store';
import { Icon, useToast } from '../ui/common';

const PAL = ['#ff7a00', '#7fb2ff', '#43c27a', '#f2b84b', '#d38cff', '#ff5d8f', '#4fd1c5', '#c0c4cc', '#a3e635', '#fb923c'];
const colorOf = (k: string) => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };
const STALE_MS = 15000;

export function Live({ raceId, go }: { raceId?: string; go: (p: string) => void }) {
  const { ds, commit } = useStore();
  const toast = useToast();
  const saved = ds.settings[0].liveUrl ?? '';
  const [editing, setEditing] = useState(!saved);
  const [text, setText] = useState(saved);
  const parsed = parseLiveLink(text);
  const base = saved;

  const connect = () => {
    if (!parsed) return;
    commit((d) => history({ ...d, settings: [{ ...d.settings[0], liveUrl: parsed.base }] }, 'live-url', 'settings', 'settings', d.settings[0].liveUrl ?? null, parsed.base, ''))
      .then((ok) => { if (ok) { setEditing(false); toast('Live results connected'); if (parsed.raceId) go('live/' + parsed.raceId); } });
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Live</h1><p className="muted">Live timing from the BeamMP server: positions every 3 seconds, the race route with each car's last known position, times and penalties as they happen.</p></div>
        {base && !editing && <div className="row"><button onClick={() => { setText(base); setEditing(true); }}>Change connection</button></div>}
      </div>
      {editing ? (
        <section className="panel">
          <h2>Connect to your live results</h2>
          <p className="small muted">Paste the embed code from your website, the live page link (…/embed) or the relay address. The relay is the small Cloudflare service that receives the server's live data (see <span className="mono">live/README.md</span> in the repo).</p>
          <textarea aria-label="Embed code or live link" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 90 }}
            placeholder={'<iframe src="https://baja75-live.yourname.workers.dev/embed" …></iframe>'} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={!parsed} onClick={connect}>Connect</button>
            {saved && <button onClick={() => setEditing(false)}>Cancel</button>}
            {text.trim() && !parsed && <span className="small" style={{ color: 'var(--bad)' }}>No https:// address found in that text</span>}
            {parsed && <span className="small muted">Relay: <span className="mono">{parsed.base}</span>{parsed.raceId ? ` · race ${parsed.raceId}` : ''}</span>}
          </div>
        </section>
      ) : raceId ? <RaceView base={base} raceId={raceId} go={go} /> : <RaceList base={base} go={go} />}
    </>
  );
}

function RaceList({ base, go }: { base: string; go: (p: string) => void }) {
  const [races, setRaces] = useState<LiveRaceSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    let stop = false;
    const load = () => fetch(base + '/api/races', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => { if (!stop) { setRaces(d.races); setErr(null); } }).catch((e) => { if (!stop) setErr(String(e.message ?? e)); });
    load();
    const t = window.setInterval(load, 5000);
    return () => { stop = true; window.clearInterval(t); };
  }, [base]);
  const live = races?.filter((r) => r.status === 'live') ?? [];
  const ended = races?.filter((r) => r.status === 'ended') ?? [];
  const code = embedCode(base);
  return (
    <>
      {err && <div className="notice bad small" role="alert">Can't reach the live relay at <span className="mono">{base}</span>: {err}. Check the address, or that the relay is deployed.</div>}
      <section className="panel">
        <div className="panel-head"><h2>Races on now</h2><span className="small muted">Refreshes every 5 s</span></div>
        {races === null && !err ? <div className="empty">Looking for races…</div>
          : live.length ? <RaceTable races={live} go={go} />
            : <div className="empty">No race is running. A race appears here as soon as a driver starts a run on a server course.</div>}
      </section>
      {ended.length > 0 && <section className="panel"><div className="panel-head"><h2>Recently finished</h2><span className="small muted">kept 48 hours</span></div><RaceTable races={ended} go={go} /></section>}
      <section className="panel">
        <h2>Embed on your website</h2>
        <p className="small muted">This always shows the race that's on now (and switches by itself when the next one starts). Add <span className="mono">?view=board</span> or <span className="mono">?view=map</span> to the address for just one half.</p>
        <pre className="raw" style={{ whiteSpace: 'pre-wrap' }}>{code}</pre>
        <div className="row"><button onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Embed code copied'), () => toast('Copy it from the box'))}>Copy embed code</button>
          <a className="btn" href={base + '/embed'} target="_blank" rel="noopener noreferrer">Open the live page</a></div>
      </section>
    </>
  );
}

function RaceTable({ races, go }: { races: LiveRaceSummary[]; go: (p: string) => void }) {
  return (
    <div className="table-wrap"><table className="cards">
      <thead><tr><th>Race</th><th>Map</th><th>Server</th><th>Started</th><th className="num">Drivers</th><th className="num">On course</th><th className="num">Finished</th><th></th></tr></thead>
      <tbody>{races.map((r) => (
        <tr key={r.id}>
          <td data-l="Race"><b>{r.name}</b> {r.status === 'live' ? <span className="chip bad">LIVE</span> : <span className="chip">ENDED</span>}</td>
          <td data-l="Map">{r.map || '—'}</td><td data-l="Server" className="small">{r.server || '—'}</td>
          <td data-l="Started" className="small">{new Date(r.startedAt).toLocaleString()}</td>
          <td data-l="Drivers" className="num">{r.drivers}</td><td data-l="On course" className="num">{r.running}</td><td data-l="Finished" className="num">{r.finished}</td>
          <td className="full"><button className="small primary" onClick={() => go('live/' + r.id)}>Watch live</button></td>
        </tr>))}</tbody>
    </table></div>
  );
}

/** One race: a WebSocket snapshot and its updates (every ~3 s), polling if the socket can't connect. */
function useLiveRace(base: string, raceId: string) {
  const [race, setRace] = useState<LiveRace | null>(null);
  const [missing, setMissing] = useState(false);
  const [conn, setConn] = useState<'connecting' | 'live' | 'polling' | 'offline'>('connecting');
  const trails = useRef<Record<string, [number, number][]>>({});
  const recvAt = useRef(0);
  useEffect(() => {
    let stop = false, ws: WebSocket | null = null, poll: number | undefined, retry: number | undefined, first = true;
    trails.current = {}; setRace(null); setMissing(false);
    const onMsg = (m: { type: string; race?: LiveRace; add?: Record<string, [number, number][]> }) => {
      if (stop) return;
      if (m.type === 'missing') { setMissing(true); return; }
      if (!m.race) return;
      if (m.type === 'snapshot') trails.current = { ...(m.race.trails ?? {}) };
      for (const [k, pts] of Object.entries(m.add ?? {})) trails.current[k] = [...(trails.current[k] ?? []), ...pts];
      recvAt.current = Date.now();
      setRace(m.race);
    };
    const startPoll = () => {
      if (poll !== undefined || stop) return;
      setConn('polling');
      const tick = async () => {
        try {
          const r = await fetch(`${base}/api/races/${raceId}${first ? '?trails=1' : ''}`, { cache: 'no-store' });
          if (r.status === 404) { setMissing(true); }
          else if (r.ok) { const race = await r.json() as LiveRace; onMsg(first ? { type: 'snapshot', race } : { type: 'update', race }); first = false; }
          else setConn('offline');
        } catch { setConn('offline'); }
        if (!stop) poll = window.setTimeout(tick, 3000);
      };
      tick();
    };
    const open = () => {
      try {
        ws = new WebSocket(base.replace(/^http/, 'ws') + `/api/races/${raceId}/ws`);
        ws.onopen = () => { setConn('live'); if (poll !== undefined) { window.clearTimeout(poll); poll = undefined; } };
        ws.onmessage = (e) => { if (e.data !== 'pong') onMsg(JSON.parse(e.data)); };
        ws.onclose = () => { ws = null; if (!stop) { startPoll(); retry = window.setTimeout(open, 15000); } };
      } catch { startPoll(); }
    };
    open();
    return () => { stop = true; ws?.close(); window.clearTimeout(poll); window.clearTimeout(retry); };
  }, [base, raceId]);
  return { race, trails: trails.current, recvAt: recvAt.current, missing, conn };
}

function RaceView({ base, raceId, go }: { base: string; raceId: string; go: (p: string) => void }) {
  const { ds } = useStore();
  const { race, trails, recvAt, missing, conn } = useLiveRace(base, raceId);
  const [slot, setSlot] = useState<SheetSlot>(activeSlot(ds, 'penalties'));
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(t); }, []);
  const rules = sheetOf(ds, 'penalties', slot).rules;
  const toast = useToast();
  if (missing) return <div className="empty">That race isn't on the live relay any more (races are kept 48 hours after they end). <a href="#/live">All live races</a></div>;
  if (!race) return <div className="empty">Connecting to the live race…</div>;
  const since = Date.now() - recvAt;
  const ranked = race.drivers.filter((d) => d.navUnit);
  const posOnly = race.drivers.filter((d) => !d.navUnit);
  return (
    <>
      <div className="crumbs"><a href="#/live" onClick={(e) => { e.preventDefault(); go('live'); }}>Live</a> › {race.name}</div>
      <section className="panel">
        <div className="panel-head">
          <h2>{race.name} {race.status === 'live' ? <span className="chip bad">● LIVE</span> : <span className="chip">FINISHED</span>}</h2>
          <span className="small muted">{[race.map, race.server].filter(Boolean).join(' · ')} · {conn === 'live' ? 'connected' : conn === 'polling' ? 'updating every 3 s' : conn}{since > 6000 ? ` · last update ${Math.round(since / 1000)} s ago` : ''}</span>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="field">Estimate penalties with<select value={slot} onChange={(e) => setSlot(Number(e.target.value) as SheetSlot)}>
            {SHEET_SLOTS.map((n) => <option key={n} value={n}>Penalty Sheet {refLabel(refOf(ds, 'penalties', n))}{n === activeSlot(ds, 'penalties') ? ' (active)' : ''}</option>)}</select></label>
          <button className="small" onClick={() => navigator.clipboard?.writeText(embedCode(base, race.id)).then(() => toast('Embed code for this race copied'), () => undefined)}><Icon name="down" />Embed code for this race</button>
        </div>
        <div className="table-wrap"><table className="cards">
          <thead><tr><th className="num">Pos</th><th>Driver</th><th>Status</th><th className="num">Time</th><th>Progress</th>
            <th className="num" title="Off course">OC</th><th className="num" title="Wrong way">WW</th><th className="num" title="Speeding">SP</th><th className="num" title="Missed VCPs">VCP</th>
            <th className="num" title="Jump starts">JS</th><th className="num" title="Resets (larger of Nav Unit and server count)">RST</th><th className="num" title="Recoveries">REC</th><th className="num" title="Damage">DMG</th>
            <th className="num">Est. penalty</th><th className="num">Est. adjusted</th></tr></thead>
          <tbody>{ranked.map((d) => <DriverRow key={d.key} d={d} race={race} since={since} rules={rules} />)}</tbody>
        </table></div>
        {!ranked.length && <div className="empty">Waiting for drivers…</div>}
        {posOnly.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>On the map without Navigation Unit data (position only): {posOnly.map((d) => d.name).join(', ')}.</p>}
        <p className="small muted" style={{ marginTop: 6 }}>Estimates while the race runs. Official results still come from the run logs (or Discord results) through Import Data.</p>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Live view</h2><span className="small muted">{race.route ? 'Route from the server' : 'Route drawn from the paths driven'} · faded dots: last known position (no update for 15 s)</span></div>
        <LiveMap race={race} trails={trails} />
      </section>
    </>
  );
}

function DriverRow({ d, race, since, rules }: { d: LiveDriver; race: LiveRace; since: number; rules: Parameters<typeof estimatePenaltyMs>[1] }) {
  const stale = race.now - d.lastSeen > STALE_MS;
  const t = liveElapsed(d, race.status === 'live' ? since : 0);
  const pen = estimatePenaltyMs(d, rules);
  const c = (k: keyof LiveDriver['counters']) => d.counters[k] ?? 0;
  const prog = [d.lap != null && d.laps ? `Lap ${d.lap}/${d.laps}` : '', d.rm != null ? `RM ${d.rm.toFixed(1)}${d.routeMiles ? '/' + d.routeMiles.toFixed(1) : ''}` : '', d.vcp ? `VCP ${d.vcp[0]}/${d.vcp[1]}` : ''].filter(Boolean).join(' · ');
  return (
    <tr style={stale ? { opacity: 0.55 } : undefined}>
      <td data-l="Pos" className="num rank">{d.rank ?? '—'}</td>
      <td data-l="Driver"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: colorOf(d.key), marginRight: 6 }} /><b>{d.name}</b>{d.number && <span className="muted"> #{d.number}</span>}<div className="small muted">{d.vehicle}{d.speedKmh != null && d.state === 'running' ? ` · ${d.speedKmh} km/h` : ''}</div></td>
      <td data-l="Status">{d.state === 'running' ? <span className="chip info">ON COURSE</span> : d.state === 'finished' ? <span className="chip ok">FINISHED</span> : d.state === 'dnf' ? <span className="chip bad">DNF</span> : <span className="chip">{d.state.toUpperCase()}</span>}{stale && <div className="small muted">last known</div>}</td>
      <td data-l="Time" className="num"><b>{formatMs(t)}</b></td>
      <td data-l="Progress" className="small">{prog || '—'}</td>
      <td data-l="Off course" className="num">{c('offCourse')}</td><td data-l="Wrong way" className="num">{c('wrongWay')}</td><td data-l="Speeding" className="num">{c('speeding')}</td>
      <td data-l="Missed VCPs" className="num">{c('missedVcps')}</td><td data-l="Jump starts" className="num">{c('jumpStarts')}</td><td data-l="Resets" className="num">{liveResets(d)}</td>
      <td data-l="Recoveries" className="num">{c('recoveries')}</td><td data-l="Damage" className="num">{c('damageHits')}</td>
      <td data-l="Est. penalty" className="num" style={{ color: pen ? 'var(--warn)' : undefined }}>{pen ? formatMs(pen, { plus: true }) : '0:00.0'}</td>
      <td data-l="Est. adjusted" className="num">{t != null ? <b>{formatMs(t + pen)}</b> : '—'}</td>
    </tr>
  );
}

/** Route + every car's path, with the last known position of each car. BeamNG x is east, y north: y is flipped for the screen. */
export function LiveMap({ race, trails }: { race: LiveRace; trails: Record<string, [number, number][]> }) {
  const bounds = useRef<{ x0: number; x1: number; y0: number; y1: number } | null>(null);
  useEffect(() => { bounds.current = null; }, [race.id]);
  const b = useMemo(() => {
    let bb = bounds.current;
    const grow = (x: number, y: number) => { bb = bb ? { x0: Math.min(bb.x0, x), x1: Math.max(bb.x1, x), y0: Math.min(bb.y0, y), y1: Math.max(bb.y1, y) } : { x0: x, x1: x, y0: y, y1: y }; };
    race.route?.forEach((p) => grow(p[0], p[1]));
    for (const pts of Object.values(trails)) pts.forEach((p) => grow(p[0], p[1]));
    race.drivers.forEach((d) => d.pos && grow(d.pos[0], d.pos[1]));
    bounds.current = bb;
    return bb;
  }, [race, trails]);
  if (!b) return <div className="empty">No positions yet</div>;
  const w = Math.max(b.x1 - b.x0, 200), h = Math.max(b.y1 - b.y0, 200), pad = Math.max(w, h) * 0.06;
  const vb = [b.x0 - pad, -(b.y1 + pad), w + pad * 2, h + pad * 2];
  const u = Math.max(vb[2], vb[3]) / 300;
  const pts = (list: [number, number][]) => list.map((p) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={vb.map((n) => n.toFixed(1)).join(' ')} role="img" aria-label="Live map of the race" style={{ display: 'block', width: '100%', maxHeight: '70vh', background: '#101012', borderRadius: 8 }}>
      {race.route && race.route.length > 1 && <polyline points={pts(race.route)} fill="none" stroke="#5a3a1a" strokeWidth={u * 3.2} strokeLinejoin="round" strokeLinecap="round" />}
      {Object.entries(trails).map(([k, list]) => list.length > 1 && <polyline key={k} points={pts(list)} fill="none" stroke={race.route ? colorOf(k) : '#3a3a3e'} strokeOpacity={race.route ? 0.5 : 0.9} strokeWidth={u * (race.route ? 1.2 : 2.4)} strokeLinejoin="round" strokeLinecap="round" />)}
      {[...race.drivers].filter((d) => d.pos).reverse().map((d) => {
        const stale = race.now - d.lastSeen > STALE_MS;
        const x = d.pos![0], y = -d.pos![1];
        return (
          <g key={d.key} opacity={stale ? 0.45 : 1}>
            <circle cx={x} cy={y} r={u * 4.5} fill={colorOf(d.key)} stroke="#0b0b0c" strokeWidth={u * 1.2} />
            <text x={x + u * 6} y={y + u * 3} fontSize={u * 9} fill="#f2f0ed" stroke="#0b0b0c" strokeWidth={u * 2.4} paintOrder="stroke" fontWeight={700}>
              {(d.rank ? `P${d.rank} ` : '') + (d.number ? '#' + d.number : d.name) + (stale ? ' (last known)' : '')}
            </text>
          </g>);
      })}
    </svg>
  );
}
