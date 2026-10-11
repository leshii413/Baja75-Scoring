import { useEffect, useMemo, useRef, useState } from 'react';
import { createDriver, createEvent, deleteRun, findOrCreateCourse, history, similarDrivers } from '../domain/actions';
import { parseManualCsv } from '../domain/csv';
import { looksLikeDiscordResults, parseDiscordResults } from '../domain/parseDiscord';
import { uuid } from '../domain/ids';
import { planRows, runFromParsed, summarize, type PlanRow } from '../domain/importPlan';
import { parseRaceLog, type ParseResult } from '../domain/parseLog';
import { looksLikeTimesJson, parseTimesJson } from '../domain/parseTimesJson';
import { formatMs, nowIso } from '../domain/time';
import type { Dataset, ImportBatch, RunSource } from '../domain/types';
import { useStore } from '../store/store';
import { Dialog, Icon, readFileText, StatusChip, useOverride, useToast } from '../ui/common';
import { driverLabel, seasonEvents, sortedDrivers } from './shared';

interface Loaded { key: string; name: string; size: number; lastModified: number | null; source: RunSource; result: ParseResult; map: string; driverId: string; suggested: string }

const NEW = '__new__';

export function ImportData({ go, seasonId }: { go: (p: string) => void; seasonId: string }) {
  const { ds, commit, setPending } = useStore();
  const toast = useToast();
  const [files, setFiles] = useState<Loaded[]>([]);
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const [eventFor, setEventFor] = useState<Record<string, string>>({}); // course|map -> event id or NEW
  const [rowDriver, setRowDriver] = useState<Record<string, string>>({});
  const [rowEvent, setRowEvent] = useState<Record<string, string>>({});
  const [newDriver, setNewDriver] = useState<{ forKey: string; name: string; number: string } | null>(null);
  const [done, setDone] = useState<ImportBatch | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setPending('import', files.length > 0); return () => setPending('import', false); }, [files.length, setPending]);

  // the log's own Driver field: offered when it matches exactly one registered driver (you confirm it)
  const suggestDriver = (result: ParseResult): string => {
    const names = [...new Set(result.runs.map((r) => r.sourceDriver).filter(Boolean))];
    if (names.length !== 1) return '';
    const num = [...new Set(result.runs.map((r) => r.sourceNumber).filter(Boolean))][0] ?? '';
    const m = ds.drivers.filter((d) => d.name.toLowerCase() === names[0].toLowerCase() && (!num || !d.number || d.number === num));
    return m.length === 1 ? m[0].id : '';
  };
  const addTexts = (items: { name: string; size: number; lastModified: number | null; text: string }[]) => {
    const out: Loaded[] = [];
    for (const it of items) {
      const t = it.text;
      let source: RunSource = 'log', result: ParseResult;
      if (/\.json$/i.test(it.name) || /^\s*[{[]/.test(t)) {
        if (/"app"\s*:\s*"Baja75 Scoring Management System"/.test(t)) { toast(`${it.name} is a full backup: restore it in Settings / Backup`); continue; }
        if (!looksLikeTimesJson(t)) { toast(`${it.name}: not a times file or a run log`); continue; }
        source = 'json'; result = parseTimesJson(t, it.name);
      } else if (/\.csv$/i.test(it.name)) { source = 'manual'; result = parseManualCsv(t, it.name); }
      else if (looksLikeDiscordResults(t)) {
        // one row per Discord post, so each gets its own driver
        const all = parseDiscordResults(t, it.name);
        all.runs.forEach((r, i) => {
          const one: ParseResult = { runs: [r], rejected: i === 0 ? all.rejected : [], notes: all.notes };
          const label = `Discord: ${r.sourceDriver || 'unknown driver'}${r.unknownFields.server ? ' · ' + r.unknownFields.server : ''}`;
          out.push({ key: uuid(), name: label, size: it.size, lastModified: it.lastModified, source: 'discord', result: one, map: '', driverId: suggestDriver(one), suggested: suggestDriver(one) });
        });
        if (!all.runs.length) toast(`${it.name}: ${all.rejected[0]?.reason ?? 'no result posts found'}`);
        continue;
      }
      else result = parseRaceLog(t);
      const suggested = suggestDriver(result);
      out.push({ key: uuid(), name: it.name, size: it.size, lastModified: it.lastModified, source, result, map: '', driverId: suggested, suggested });
    }
    setFiles((f) => [...f, ...out]); setDone(null);
  };
  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const items = await Promise.all([...list].map(async (f) => ({ name: f.name, size: f.size, lastModified: f.lastModified, text: await readFileText(f) })));
    addTexts(items);
  };

  const events = seasonEvents(ds, seasonId);
  // every course in the loaded files -> which event gets its runs
  const courseKeys = useMemo(() => {
    const m = new Map<string, { course: string; map: string; n: number }>();
    for (const f of files) for (const r of f.result.runs) {
      const map = r.map || f.map; const k = `${r.courseName}|${map}`;
      const e = m.get(k) ?? { course: r.courseName, map, n: 0 }; e.n++; m.set(k, e);
    }
    return m;
  }, [files]);
  const defaultEvent = (course: string, map: string) => {
    const c = ds.courses.find((x) => x.originalName === course && x.map === map);
    const evs = c ? events.filter((e) => e.courseId === c.id && e.status !== 'finalized') : [];
    return evs.length === 1 ? evs[0].id : '';
  };
  const eventChoice = (course: string, map: string) => eventFor[`${course}|${map}`] ?? defaultEvent(course, map);

  const rows: PlanRow[] = useMemo(() => {
    const base: Omit<PlanRow, 'action' | 'why'>[] = [];
    for (const f of files) f.result.runs.forEach((p, i) => {
      const key = `${f.key}:${i}`;
      const map = p.map || f.map;
      const parsed = { ...p, map };
      const ev = rowEvent[key] ?? eventChoice(p.courseName, map);
      base.push({ key, parsed, file: f.name, source: f.source, driverId: (rowDriver[key] ?? f.driverId) || null, eventId: ev && ev !== NEW ? ev : ev === NEW ? NEW : null });
    });
    // a new event isn't created yet: plan it as an event of its own (nothing there to duplicate)
    return planRows(ds, base.map((b) => (b.eventId === NEW ? { ...b, eventId: 'new:' + b.parsed.courseName + '|' + b.parsed.map } : b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, ds, rowDriver, rowEvent, eventFor, seasonId]);
  const sum = summarize(rows);
  const rejected = files.flatMap((f) => f.result.rejected.map((r) => ({ ...r, file: f.name })));
  const finalizedTargets = new Set(rows.filter((r) => r.eventId && ds.events.find((e) => e.id === r.eventId)?.status === 'finalized').map((r) => r.eventId));

  const doImport = async () => {
    const now = nowIso();
    let batch: ImportBatch | null = null;
    const ok = await commit((d0) => {
      let d: Dataset = d0;
      const created = new Map<string, string>();
      const evId = (r: PlanRow) => {
        if (!r.eventId) return null;
        if (!r.eventId.startsWith('new:')) return r.eventId;
        const k = r.eventId;
        if (!created.has(k)) {
          const c = findOrCreateCourse(d, r.parsed.courseName, r.parsed.map); d = c.ds;
          const round = d.events.filter((e) => e.seasonId === seasonId).reduce((m, e) => Math.max(m, e.round ?? 0), 0) + 1;
          const e = createEvent(d, { seasonId, courseId: c.course.id, name: `Round ${round}`, round, date: r.parsed.localDate });
          d = e.ds; created.set(k, e.event.id);
        }
        return created.get(k)!;
      };
      const b: ImportBatch = { id: uuid(), importedAt: now, files: files.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified })), driverId: files.length === 1 ? files[0].driverId || null : null,
        eventId: null, added: 0, duplicates: 0, held: 0, rejected: rejected.map(({ text, reason, line, file }) => ({ text, reason: `${file}: ${reason}`, line })), note: paste ? 'Includes pasted text' : '' };
      const newRuns = [];
      for (const r of rows) {
        if (r.action === 'duplicate') { b.duplicates++; continue; }
        const eventId = r.action === 'needs-event' ? null : evId(r);
        if (eventId) { const c = findOrCreateCourse(d, r.parsed.courseName, r.parsed.map); d = c.ds; }
        const held = r.action === 'revision';
        if (held) b.held++; else b.added++;
        newRuns.push(runFromParsed(r.parsed, { batchId: b.id, source: r.source, file: r.file, driverId: r.driverId, eventId, held, heldReason: held ? r.why : '', now }));
      }
      batch = b;
      d = { ...d, runs: [...d.runs, ...newRuns], batches: [...d.batches, b] };
      return history(d, 'import', 'batch', b.id, null, { added: b.added, duplicates: b.duplicates, held: b.held, rejected: b.rejected.length }, '');
    });
    if (ok && batch) { setDone(batch); setFiles([]); setPaste(''); setEventFor({}); setRowDriver({}); setRowEvent({}); toast('Import saved'); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Import Data</h1><p className="muted">Run logs (<span className="mono">settings/TreadXLGPS/race_log.txt</span>, or a driver's export from MENU › Times › Export), times files (<span className="mono">times/&lt;map&gt;/&lt;name&gt;.json</span>) and the manual CSV template.</p></div></div>
      {done && <div className="notice ok" role="status"><b>Imported.</b> {done.added} added · {done.duplicates} duplicates skipped · {done.held} held for review · {done.rejected.length} rejected blocks kept for review. <a href="#/races">Open Races</a></div>}

      <section className="panel">
        <div className={'drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
          <p><b>Drop files here</b> or</p>
          <button className="primary" onClick={() => input.current?.click()}><Icon name="upload" />Choose files</button>
          <input ref={input} type="file" multiple hidden accept=".txt,.log,.json,.csv,text/plain,application/json,text/csv" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <p className="small" style={{ marginTop: 10 }}>Several files at once is fine: give each its driver below.</p>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Paste a run log instead</summary>
          <textarea aria-label="Pasted run log" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="2026-10-07 08:38:06 UTC+08:00 (…) | Map: johnson_valley | Course: … | Time: 4:16.8 | …" />
          <div className="row" style={{ marginTop: 8 }}><button disabled={!paste.trim()} onClick={() => { addTexts([{ name: 'Pasted text', size: paste.length, lastModified: null, text: paste }]); setPaste(''); }}>Read pasted text</button></div>
        </details>
        <DiscordPaste onRead={(text) => addTexts([{ name: 'Discord paste', size: text.length, lastModified: null, text }])} />
      </section>

      {files.length > 0 && <>
        <section className="panel">
          <div className="panel-head"><h2>1. Driver for each file</h2></div>
          <p className="small muted">The run log doesn't reliably say who drove: pick the driver for each file. A file with several drivers can be split row by row below.</p>
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>File</th><th className="num">Runs</th><th>Driver</th><th></th></tr></thead>
            <tbody>{files.map((f) => (
              <tr key={f.key}>
                <td data-l="File"><b>{f.name}</b><div className="small muted">{f.source === 'json' ? 'Times file' : f.source === 'manual' ? 'Manual CSV' : f.source === 'discord' ? 'Discord result (BeamJoy Revived)' : 'Run log'}{f.result.runs[0]?.sourceDriver ? ` · ${f.source === 'discord' ? 'post' : 'log'} says driver: ${f.result.runs[0].sourceDriver}${f.result.runs[0].sourceNumber ? ' #' + f.result.runs[0].sourceNumber : ''}` : ''}</div>
                  {f.source === 'json' && <label className="field" style={{ marginTop: 6 }}>Map (not in times files)<input value={f.map} onChange={(e) => setFiles(files.map((x) => (x.key === f.key ? { ...x, map: e.target.value } : x)))} placeholder="johnson_valley" /></label>}</td>
                <td data-l="Runs" className="num">{f.result.runs.length}{f.result.rejected.length > 0 && <span className="chip bad" style={{ marginLeft: 6 }}>{f.result.rejected.length} rejected</span>}</td>
                <td data-l="Driver">
                  <select aria-label={`Driver for ${f.name}`} value={f.driverId} onChange={(e) => { if (e.target.value === NEW) { setNewDriver({ forKey: f.key, name: f.result.runs[0]?.sourceDriver ?? '', number: f.result.runs[0]?.sourceNumber ?? '' }); return; } setFiles(files.map((x) => (x.key === f.key ? { ...x, driverId: e.target.value } : x))); }}>
                    <option value="">Pick driver…</option>{sortedDrivers(ds).map((d) => <option key={d.id} value={d.id}>{d.name}{d.number ? ' #' + d.number : ''}</option>)}<option value={NEW}>+ New driver…</option>
                  </select>
                  {f.suggested && f.driverId === f.suggested && <div className="small muted">Matched from the log's Driver field: check it</div>}
                </td>
                <td className="full"><button className="small ghost" onClick={() => setFiles(files.filter((x) => x.key !== f.key))}>Remove</button></td>
              </tr>))}</tbody>
          </table></div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>2. Race event for each course</h2></div>
          <p className="small muted">Runs are grouped by their course name. The same course can be raced in several rounds, so pick which event these runs belong to.</p>
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Course (as imported)</th><th>Map</th><th className="num">Runs</th><th>Event</th></tr></thead>
            <tbody>{[...courseKeys.entries()].map(([k, c]) => (
              <tr key={k}><td data-l="Course"><b>{c.course}</b></td><td data-l="Map">{c.map || <span className="muted">unknown</span>}</td><td data-l="Runs" className="num">{c.n}</td>
                <td data-l="Event"><select aria-label={`Event for ${c.course}`} value={eventChoice(c.course, c.map)} onChange={(e) => setEventFor({ ...eventFor, [k]: e.target.value })}>
                  <option value="">Decide later (kept unassigned)</option>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === 'finalized' ? ' (finalized)' : ''} · {ds.courses.find((x) => x.id === e.courseId)?.originalName}</option>)}
                  <option value={NEW}>+ New event for this course</option>
                </select></td></tr>))}</tbody>
          </table></div>
          {finalizedTargets.size > 0 && <div className="notice small" style={{ marginTop: 10 }}>Runs going into a finalized event won't change its official results until you start an amendment.</div>}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>3. Review</h2>
            <span className="chip ok">{sum.add} TO ADD</span><span className="chip">{sum.duplicate} DUPLICATE</span><span className="chip warn">{sum.revision} HELD</span>
            <span className="chip bad">{sum['needs-driver'] + sum['needs-event']} UNASSIGNED</span>{rejected.length > 0 && <span className="chip bad">{rejected.length} REJECTED</span>}</div>
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Result</th><th>File</th><th>Course</th><th>When</th><th>Vehicle</th><th className="num">Time</th><th>Status</th><th>Warnings</th><th>Driver</th><th>Event</th></tr></thead>
            <tbody>{rows.map((r) => {
              const p = r.parsed;
              const c = p.counters;
              return (
                <tr key={r.key}>
                  <td data-l="Result">{r.action === 'add' ? <span className="chip ok">ADD</span> : r.action === 'duplicate' ? <span className="chip">DUPLICATE</span> : r.action === 'revision' ? <span className="chip warn">HOLD</span> : <span className="chip bad">UNASSIGNED</span>}{r.why && <div className="small muted">{r.why}</div>}</td>
                  <td data-l="File" className="small">{r.file}</td>
                  <td data-l="Course">{p.courseName}</td>
                  <td data-l="When" className="small">{p.timestampText.replace(/\s*\(.*\)$/, '') || '—'}</td>
                  <td data-l="Vehicle" className="small">{p.vehicle || '—'}</td>
                  <td data-l="Time" className="num">{p.status === 'DNF' ? 'DNF ' : ''}{formatMs(p.elapsedMs)}</td>
                  <td data-l="Status"><StatusChip status={p.status} /></td>
                  <td data-l="Warnings" className="small">OC {c.offCourse ?? '?'} · WW {c.wrongWay ?? '?'} · SP {c.speeding ?? '?'} · VCP {c.missedVcps ?? '?'} · JS {c.jumpStarts ?? '?'} · R {c.resets ?? '?'} · Rec {c.recoveries ?? '?'} · Dmg {c.damageHits ?? '?'}
                    {p.issues.length > 0 && <div style={{ color: 'var(--warn)' }}>{p.issues.join(' · ')}</div>}</td>
                  <td data-l="Driver"><select aria-label="Driver for this run" value={rowDriver[r.key] ?? files.find((f) => r.key.startsWith(f.key))?.driverId ?? ''} onChange={(e) => setRowDriver({ ...rowDriver, [r.key]: e.target.value })}>
                    <option value="">—</option>{sortedDrivers(ds).map((d) => <option key={d.id} value={d.id}>{d.name}{d.number ? ' #' + d.number : ''}</option>)}</select></td>
                  <td data-l="Event"><select aria-label="Event for this run" value={rowEvent[r.key] ?? eventChoice(p.courseName, p.map)} onChange={(e) => setRowEvent({ ...rowEvent, [r.key]: e.target.value })}>
                    <option value="">—</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}<option value={NEW}>+ New event</option></select></td>
                </tr>);
            })}</tbody>
          </table></div>
          {rejected.length > 0 && <details style={{ marginTop: 10 }}><summary><b>Rejected blocks ({rejected.length})</b>: kept with the import for review, never attached to another run</summary>
            {rejected.map((r, i) => <div key={i} style={{ marginTop: 8 }}><div className="small" style={{ color: 'var(--bad)' }}>{r.file}, line {r.line}: {r.reason}</div><pre className="raw">{r.text}</pre></div>)}</details>}
          <div className="row end" style={{ marginTop: 12 }}>
            <button onClick={() => { setFiles([]); setRowDriver({}); setRowEvent({}); setEventFor({}); }}>Cancel</button>
            <button className="primary" onClick={doImport} disabled={!rows.length || rows.every((r) => r.action === 'duplicate')}>Import {sum.add + sum.revision + sum['needs-driver'] + sum['needs-event']} run(s)</button>
          </div>
          <p className="small muted" style={{ textAlign: 'right' }}>Unassigned runs are kept and listed below until you give them a driver and an event; they never score until then.</p>
        </section>
      </>}

      <UnassignedRuns ds={ds} seasonId={seasonId} commit={commit} />
      <section className="panel">
        <div className="panel-head"><h2>Import history</h2></div>
        {ds.batches.length ? <div className="table-wrap"><table className="cards"><thead><tr><th>When</th><th>Files</th><th>Driver</th><th className="num">Added</th><th className="num">Duplicates</th><th className="num">Held</th><th className="num">Rejected</th></tr></thead>
          <tbody>{[...ds.batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).map((b) => (
            <tr key={b.id}><td data-l="When" className="small">{new Date(b.importedAt).toLocaleString()}</td><td data-l="Files" className="small">{b.files.map((f) => f.name).join(', ')}</td><td data-l="Driver">{b.driverId ? driverLabel(ds, b.driverId) : '—'}</td>
              <td data-l="Added" className="num">{b.added}</td><td data-l="Duplicates" className="num">{b.duplicates}</td><td data-l="Held" className="num">{b.held}</td>
              <td data-l="Rejected" className="num">{b.rejected.length ? <details><summary>{b.rejected.length}</summary>{b.rejected.map((r, i) => <div key={i} className="small" style={{ textAlign: 'left' }}>{r.reason}<pre className="raw">{r.text}</pre></div>)}</details> : 0}</td></tr>))}</tbody></table></div>
          : <div className="empty">No imports yet.</div>}
      </section>

      <NewDriverDialog st={newDriver} onClose={() => setNewDriver(null)} onCreate={async (name, number) => {
        let id = '';
        const ok = await commit((d) => { const r = createDriver(d, { name, number }); id = r.driver.id; return r.ds; });
        if (ok) { setFiles((fs) => fs.map((x) => (x.key === newDriver!.forKey ? { ...x, driverId: id } : x))); setNewDriver(null); }
      }} />
      <p className="small muted">Tip: drivers can export their log in game: MENU › Times › Export saves <span className="mono">settings/TreadXLGPS/exports/Baja75_results_&lt;driver&gt;_….txt</span>. <a href="#/drivers" onClick={() => go('drivers')}>Manage drivers</a></p>
    </>
  );
}

export function NewDriverDialog({ st, onClose, onCreate }: { st: { name: string; number: string } | null; onClose: () => void; onCreate: (name: string, number: string) => void }) {
  const { ds } = useStore();
  const [name, setName] = useState(''); const [number, setNumber] = useState('');
  useEffect(() => { if (st) { setName(st.name); setNumber(st.number); } }, [st]);
  const sim = similarDrivers(ds, name, number);
  return (
    <Dialog open={!!st} title="New driver" onClose={onClose} foot={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), number.trim())}>{sim.length ? 'Create anyway' : 'Create'}</button></>}>
      <div className="stack">
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="field">Race number<input value={number} onChange={(e) => setNumber(e.target.value)} /></label>
        {sim.length > 0 && <div className="notice small">Already registered: {sim.map((d) => d.name + (d.number ? ' #' + d.number : '')).join(', ')}. Pick that driver instead unless this really is someone else.</div>}
      </div>
    </Dialog>
  );
}

function UnassignedRuns({ ds, seasonId, commit }: { ds: Dataset; seasonId: string; commit: (fn: (d: Dataset) => Dataset) => Promise<boolean> }) {
  const runs = ds.runs.filter((r) => !r.driverId || !r.eventId);
  const [overrideNode, askOverride] = useOverride();
  if (!runs.length) return null;
  const events = seasonEvents(ds, seasonId);
  const set = (id: string, patch: { driverId?: string; eventId?: string }) => commit((d) => {
    const r = d.runs.find((x) => x.id === id)!;
    const next = { ...r, ...patch };
    // the same run already there for this driver and event: it would be a duplicate, so it isn't attached
    if (next.driverId && next.eventId && d.runs.some((x) => x.id !== id && x.driverId === next.driverId && x.eventId === next.eventId && x.fingerprint === r.fingerprint)) {
      throw new Error('this run is already imported for that driver and event (a duplicate)');
    }
    return history({ ...d, runs: d.runs.map((x) => (x.id === id ? next : x)) }, 'assignment', 'run', id, null, patch, 'Assigned after import');
  });
  return (
    <section className="panel" style={{ borderColor: '#6a5220' }}>
      {overrideNode}
      <div className="panel-head"><h2>Unassigned runs</h2><span className="chip warn">{runs.length} NOT SCORED</span></div>
      <div className="table-wrap"><table className="cards"><thead><tr><th>Course</th><th>When</th><th>Vehicle</th><th className="num">Time</th><th>Driver</th><th>Event</th><th></th></tr></thead>
        <tbody>{runs.map((r) => (
          <tr key={r.id}><td data-l="Course">{r.courseName}</td><td data-l="When" className="small">{r.timestampText}</td><td data-l="Vehicle" className="small">{r.vehicle}</td><td data-l="Time" className="num">{r.status === 'DNF' ? 'DNF ' : ''}{formatMs(r.elapsedMs)}</td>
            <td data-l="Driver"><select aria-label="Driver" value={r.driverId ?? ''} onChange={(e) => e.target.value && set(r.id, { driverId: e.target.value })}><option value="">Pick…</option>{sortedDrivers(ds).map((d) => <option key={d.id} value={d.id}>{d.name}{d.number ? ' #' + d.number : ''}</option>)}</select></td>
            <td data-l="Event"><select aria-label="Event" value={r.eventId ?? ''} onChange={(e) => e.target.value && set(r.id, { eventId: e.target.value })}><option value="">Pick…</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name} · {ds.courses.find((c) => c.id === e.courseId)?.originalName}</option>)}</select></td>
            <td className="full"><button className="small danger" onClick={() => askOverride({ title: 'Delete this run', danger: true, what: [`Removes the unassigned ${r.status === 'DNF' ? 'DNF' : formatMs(r.elapsedMs)} run on ${r.courseName} (${r.timestampText || 'no date'}).`], then: (why) => commit((d) => deleteRun(d, r.id, why)) })}><Icon name="lock" />Delete…</button></td></tr>
        ))}</tbody></table></div>
    </section>
  );
}

/** Results a BeamJoy Revived server posted to Discord, pasted as copied (one or several posts). */
function DiscordPaste({ onRead }: { onRead: (text: string) => void }) {
  const [text, setText] = useState('');
  const toast = useToast();
  return (
    <details style={{ marginTop: 12 }}>
      <summary>Paste results from Discord (BeamJoy Revived webhook)</summary>
      <p className="small muted" style={{ marginTop: 8 }}>For drivers who ran without the Navigation Unit. Copy the result posts from Discord (one or many) and paste them here as they are.
        Each post becomes one result. The server name is kept as a note. A post has no race number, map or penalty counts: those are recorded as <b>No Data Provided</b>.
        The result still counts (penalties 0) and is marked <b>MANUAL REVIEW</b> on the race page. Dates are read as month/day/year in this device&apos;s time zone.</p>
      <textarea aria-label="Pasted Discord results" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 160 }}
        placeholder={'hilly\nBAJA75 Series: October 3rd Race\n`38:32.360`\nBest lap\n`6:27.173`\nLaps\n4\nVehicle\nSP Dunekicker (2008) (custom)\n-►Baja75 Casual Server•10/6/2026 1:09 PM'} />
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={!text.trim()} onClick={() => {
          if (!looksLikeDiscordResults(text)) { toast('No Discord result post found: paste the driver, race title, `time` and the server • date line'); return; }
          onRead(text); setText('');
        }}>Read Discord results</button>
      </div>
    </details>
  );
}
