import { useMemo, useState } from 'react';
import { createEvent, findOrCreateCourse, history } from '../domain/actions';
import { classForRun } from '../domain/classes';
import { scoreEvent, type EntryResult } from '../domain/scoring';
import { formatMs } from '../domain/time';
import { useStore } from '../store/store';
import { Dialog, EventStatusChip, Icon, StatusChip, useToast } from '../ui/common';
import { className, driverLabel, seasonEvents } from './shared';

export function Races({ go, seasonId }: { go: (p: string) => void; seasonId: string }) {
  const { ds, commit } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [newEv, setNewEv] = useState(false);
  const [f, setF] = useState({ event: '', cls: '', vehicle: '', driver: '', status: '' });
  const events = seasonEvents(ds, seasonId);
  // courses first: every course with an event this season, or with runs not yet in an event
  const courses = ds.courses.filter((c) => events.some((e) => e.courseId === c.id)).sort((a, b) => a.originalName.localeCompare(b.originalName));
  const scores = useMemo(() => new Map(events.map((e) => [e.id, scoreEvent(ds, e.id)])), [ds, events]);
  const allResults: { ev: string; r: EntryResult }[] = [];
  for (const [ev, sc] of scores) for (const r of sc.all) allResults.push({ ev, r });
  const vehicles = [...new Set(allResults.map((x) => x.r.selectedRun?.vehicle).filter(Boolean) as string[])].sort();
  const filtered = allResults.filter(({ ev, r }) => (!f.event || ev === f.event) && (!f.cls || r.classId === f.cls) && (!f.vehicle || r.selectedRun?.vehicle === f.vehicle)
    && (!f.driver || r.driverId === f.driver) && (!f.status || r.status === f.status));
  const filtering = Object.values(f).some(Boolean);

  return (
    <>
      <div className="page-head">
        <div><h1>Races</h1><p className="muted">By course, then each race event (round), its vehicles and its class results.</p></div>
        <button className="primary" onClick={() => setNewEv(true)}><Icon name="plus" />New race event</button>
      </div>
      {!courses.length && <div className="empty">No race events in this season yet. <a href="#/import">Import a run log</a>: the import creates the event for its course, or press New race event.</div>}
      {courses.map((c) => {
        const evs = events.filter((e) => e.courseId === c.id);
        const runs = ds.runs.filter((r) => evs.some((e) => e.id === r.eventId));
        const models = new Map<string, { n: number; cls: Set<string> }>();
        for (const r of runs) {
          const k = r.vehicle || '(no vehicle)';
          const m = models.get(k) ?? { n: 0, cls: new Set<string>() };
          m.n++; m.cls.add(className(ds, classForRun(r, ds.mappings).classId)); models.set(k, m);
        }
        const isOpen = open[c.id] ?? true;
        return (
          <section className="panel" key={c.id}>
            <div className="panel-head">
              <h2>{c.alias || c.originalName}</h2>
              <span className="muted small">{c.alias ? `Imported name: ${c.originalName} · ` : ''}Map: {c.map || 'unknown'}</span>
              <button className="small" onClick={() => { const v = window.prompt('Display name for this course (blank = the imported name). The imported name is kept.', c.alias); if (v === null) return; commit((d) => history({ ...d, courses: d.courses.map((x) => (x.id === c.id ? { ...x, alias: v.trim() } : x)) }, 'course-alias', 'course', c.id, c.alias, v.trim(), '')); }}>Display name</button>
              <button className="small" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [c.id]: !isOpen })}>{isOpen ? 'Hide' : 'Show'}</button>
            </div>
            {isOpen && <>
              <div className="table-wrap"><table className="cards">
                <thead><tr><th>Round</th><th>Race event</th><th>Status</th><th className="num">Entries</th><th>Class winners</th><th></th></tr></thead>
                <tbody>{evs.map((e) => {
                  const sc = scores.get(e.id)!;
                  return (
                    <tr key={e.id}>
                      <td data-l="Round" className="num">{e.round ?? '—'}</td>
                      <td data-l="Race event"><a href={'#/races/' + e.id}>{e.name}</a>{e.date && <span className="muted small"> · {e.date}</span>}
                        {e.practice && <span className="chip" style={{ marginLeft: 6 }}>PRACTICE</span>}{!e.included && <span className="chip" style={{ marginLeft: 6 }}>NOT COUNTED</span>}</td>
                      <td data-l="Status"><EventStatusChip status={e.status} /></td>
                      <td data-l="Entries" className="num">{sc.all.length}{sc.noClass.length + sc.noDriver.length > 0 && <span className="chip warn" style={{ marginLeft: 6 }}>{sc.noClass.length + sc.noDriver.length} unassigned</span>}</td>
                      <td data-l="Class winners" className="small">{sc.groups.map((g) => { const w = g.results.filter((r) => r.classRank === 1); return w.length ? `${g.label}: ${w.map((x) => driverLabel(ds, x.driverId)).join(' = ')}` : null; }).filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                      <td className="full"><button className="small" onClick={() => go('races/' + e.id)}>Open</button></td>
                    </tr>);
                })}</tbody>
              </table></div>
              {models.size > 0 && <details style={{ marginTop: 10 }}><summary className="small muted">Vehicles on this course ({models.size})</summary>
                <div className="table-wrap"><table><thead><tr><th>Vehicle (as imported)</th><th className="num">Runs</th><th>Class</th></tr></thead>
                  <tbody>{[...models.entries()].sort((a, b) => b[1].n - a[1].n).map(([v, m]) => <tr key={v}><td>{v}</td><td className="num">{m.n}</td><td>{[...m.cls].join(', ')}</td></tr>)}</tbody></table></div>
              </details>}
            </>}
          </section>
        );
      })}
      {allResults.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Find results</h2></div>
          <div className="row" style={{ marginBottom: 10 }}>
            <select aria-label="Event" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}><option value="">All events</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <select aria-label="Class" value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })}><option value="">All classes</option>{[...ds.classes].sort((a, b) => a.order - b.order).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            <select aria-label="Vehicle" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })}><option value="">All vehicles</option>{vehicles.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <select aria-label="Driver" value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}><option value="">All drivers</option>{[...ds.drivers].sort((a, b) => a.name.localeCompare(b.name)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{['FINISHED', 'DNF', 'DNS', 'DSQ'].map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          {filtering ? (
            <div className="table-wrap"><table className="cards"><thead><tr><th>Event</th><th>Class</th><th>Pos</th><th>Driver</th><th>Vehicle</th><th className="num">Adjusted</th><th>Status</th><th className="num">Points</th></tr></thead>
              <tbody>{filtered.map(({ ev, r }) => (
                <tr key={r.entryId}><td data-l="Event"><a href={'#/races/' + ev}>{ds.events.find((e) => e.id === ev)?.name}</a></td><td data-l="Class">{className(ds, r.classId)}</td>
                  <td data-l="Pos" className="num">{r.classRank ?? '—'}</td><td data-l="Driver">{driverLabel(ds, r.driverId)}</td><td data-l="Vehicle" className="small">{r.selectedRun?.vehicle ?? '—'}</td>
                  <td data-l="Adjusted" className="num">{formatMs(r.adjustedMs)}</td><td data-l="Status"><StatusChip status={r.status} pending={r.blockers.length > 0 && !r.selectedRun} /></td><td data-l="Points" className="num pts">{r.points}</td></tr>
              ))}</tbody></table></div>
          ) : <p className="muted small">Pick a filter to list matching results across this season (draft results shown live).</p>}
        </section>
      )}
      <NewEventDialog open={newEv} onClose={() => setNewEv(false)} seasonId={seasonId} onCreate={async (o) => {
        let id = '';
        const ok = await commit((d) => { const c = findOrCreateCourse(d, o.course, o.map); const e = createEvent(c.ds, { seasonId, courseId: c.course.id, name: o.name, round: o.round, date: o.date, format: o.format }); id = e.event.id; return e.ds; });
        if (ok) { setNewEv(false); toast('Race event created'); go('races/' + id); }
      }} />
    </>
  );
}

export function NewEventDialog({ open, onClose, onCreate, seasonId, initial }: {
  open: boolean; onClose: () => void; seasonId: string; initial?: { course: string; map: string };
  onCreate: (o: { course: string; map: string; name: string; round: number | null; date: string; format: 'selected' | 'best' }) => void;
}) {
  const { ds } = useStore();
  const [course, setCourse] = useState(initial?.course ?? '');
  const [map, setMap] = useState(initial?.map ?? '');
  const [name, setName] = useState('');
  const [round, setRound] = useState('');
  const [date, setDate] = useState('');
  const [format, setFormat] = useState<'selected' | 'best'>('selected');
  const known = ds.courses;
  const roundBad = round.trim() !== '' && !/^\d{1,4}$/.test(round.trim());
  const nextRound = ds.events.filter((e) => e.seasonId === seasonId).reduce((m, e) => Math.max(m, e.round ?? 0), 0) + 1;
  const ok = course.trim() && !roundBad;
  return (
    <Dialog open={open} title="New race event" onClose={onClose}
      foot={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ok} onClick={() => onCreate({ course: course.trim(), map: map.trim(), name: name.trim() || `Round ${round || nextRound}`, round: round.trim() ? Number(round) : nextRound, date, format })}>Create</button></>}>
      <div className="stack">
        <label className="field">Course (the race name exactly as the run log shows it)
          <input list="known-courses" value={course} onChange={(e) => { setCourse(e.target.value); const k = known.find((c) => c.originalName === e.target.value); if (k) setMap(k.map); }} placeholder="route 20261007 082741" />
          <datalist id="known-courses">{known.map((c) => <option key={c.id} value={c.originalName}>{c.map}</option>)}</datalist>
        </label>
        <label className="field">Map<input value={map} onChange={(e) => setMap(e.target.value)} placeholder="johnson_valley" /></label>
        <div className="row">
          <label className="field" style={{ flex: 2 }}>Event name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Round ${round || nextRound}`} /></label>
          <label className="field" style={{ flex: 1 }}>Round<input inputMode="numeric" value={round} aria-invalid={roundBad} onChange={(e) => setRound(e.target.value)} placeholder={String(nextRound)} />{roundBad && <span className="err">A whole number</span>}</label>
          <label className="field" style={{ flex: 1.4 }}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted">Official result per driver</legend>
          <label className="check"><input type="radio" name="fmt" checked={format === 'selected'} onChange={() => setFormat('selected')} />Selected attempt: an official picks the run that counts (default)</label>
          <label className="check"><input type="radio" name="fmt" checked={format === 'best'} onChange={() => setFormat('best')} />Best adjusted attempt (time trial)</label>
        </fieldset>
        <p className="small muted">The same course can be used for more than one round: each event keeps its own runs, penalties and results.</p>
      </div>
    </Dialog>
  );
}
