import { Fragment, useState } from 'react';
import { updateEvent } from '../domain/actions';
import { championshipCsv } from '../domain/exports';
import { championship } from '../domain/scoring';
import { useStore } from '../store/store';
import { download, EventStatusChip, Icon, safeFile } from '../ui/common';
import { driverLabel, seasonEvents } from './shared';

export function Overall({ seasonId }: { seasonId: string; go: (p: string) => void }) {
  const { ds, commit } = useStore();
  const [cls, setCls] = useState('all');
  const [draft, setDraft] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const season = ds.seasons.find((s) => s.id === seasonId);
  const ch = championship(ds, seasonId, { draftPreview: draft });
  const shown = cls === 'all' ? ch.classes : ch.classes.filter((c) => c.classId === cls);
  const events = seasonEvents(ds, seasonId);
  // every driver's points across all classes: for reference only (class championships are decided within a class)
  const combined = new Map<string, number>();
  for (const c of ch.classes) for (const r of c.rows) combined.set(r.driverId, (combined.get(r.driverId) ?? 0) + r.total);

  return (
    <>
      <div className="page-head">
        <div><h1>Overall Score</h1><p className="muted">{season?.name}: championship points by class, from finalized race events that count toward the season.</p></div>
        <div className="row no-print">
          <button onClick={() => download(`${safeFile(season?.name ?? 'season')}_overall.csv`, championshipCsv(ds, seasonId, draft))}><Icon name="down" />Overall CSV</button>
          <button onClick={() => window.print()}><Icon name="print" />Print</button>
        </div>
      </div>
      <div className="only-print"><h2>{season?.name} · Overall Score{draft ? ' (DRAFT PREVIEW, not official)' : ''}</h2></div>
      <section className="panel no-print">
        <div className="row">
          <label className="field">Class<select value={cls} onChange={(e) => setCls(e.target.value)}><option value="all">All classes</option>{[...ds.classes].sort((a, b) => a.order - b.order).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />Draft preview (adds draft events, not official)</label>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="small">Events in this season ({events.length}) · counted: {ch.events.length}</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}><table className="cards"><thead><tr><th>Event</th><th>Status</th><th>Counts</th></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.id}><td data-l="Event"><a href={'#/races/' + e.id}>{e.name}</a></td><td data-l="Status"><EventStatusChip status={e.status} />{e.practice && <span className="chip" style={{ marginLeft: 6 }}>PRACTICE</span>}</td>
                <td data-l="Counts"><label className="check"><input type="checkbox" checked={e.included} disabled={e.practice} onChange={(x) => commit((d) => updateEvent(d, e.id, { included: x.target.checked }, x.target.checked ? 'Included in Overall Score' : 'Excluded from Overall Score'))} />
                  <span className="small">{e.practice ? 'Practice: never counts' : !e.included ? 'Excluded' : e.status === 'draft' ? 'Counts once finalized' : 'Counts'}</span></label></td></tr>))}</tbody></table></div>
        </details>
      </section>
      {draft && <div className="notice">Draft preview: draft events are added with their current, unofficial results.</div>}
      {!shown.length && <div className="empty">No points yet. Finalize a race event (Races › event › Finalize) to start the standings.</div>}
      {shown.map((c) => (
        <section className="panel class-block" key={c.classId}>
          <div className="class-title"><h3>{c.label}</h3><span className="muted small">{c.rows.length} driver{c.rows.length === 1 ? '' : 's'}</span></div>
          <div className="table-wrap"><table className="cards">
            <thead><tr><th className="num">Rank</th><th>Driver</th><th className="num">Number</th>{ch.events.map((e) => <th key={e.id} className="num hide-sm">{e.round !== null ? 'R' + e.round : e.name}{ch.draftEvents.includes(e.id) ? '*' : ''}</th>)}
              <th className="num">Total points</th><th className="num">Events</th><th className="num">Wins</th><th className="num">Podiums</th><th className="num">Finishes</th></tr></thead>
            <tbody>{c.rows.map((r) => {
              const d = ds.drivers.find((x) => x.id === r.driverId);
              const k = c.classId + r.driverId;
              return (
                <Fragment key={k}>
                  <tr>
                    <td data-l="Rank" className="num rank">{r.rank}{r.tied && <span className="tie" title="Equal points: shared rank">TIE</span>}</td>
                    <td data-l="Driver">{d?.name ?? 'Unknown'} <button className="small ghost only-sm-btn" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} style={{ minHeight: 28 }}>{open === k ? 'Hide races' : 'Races'}</button></td>
                    <td data-l="Number" className="num">{d?.number || '—'}</td>
                    {ch.events.map((e) => <td key={e.id} data-l={e.name} className="num hide-sm">{e.id in r.byEvent ? r.byEvent[e.id] : '—'}</td>)}
                    <td data-l="Total points" className="num pts">{r.total}</td><td data-l="Events" className="num">{r.events}</td><td data-l="Wins" className="num">{r.wins}</td><td data-l="Podiums" className="num">{r.podiums}</td><td data-l="Finishes" className="num">{r.finishes}</td>
                  </tr>
                  {open === k && <tr className="detail"><td colSpan={8 + ch.events.length}>{ch.events.map((e) => <div key={e.id} className="row small" style={{ justifyContent: 'space-between' }}><span>{e.name}</span><b className="num">{e.id in r.byEvent ? r.byEvent[e.id] : '—'}</b></div>)}</td></tr>}
                </Fragment>);
            })}</tbody>
          </table></div>
        </section>
      ))}
      {ch.draftEvents.length > 0 && <p className="small muted">* draft event, not official</p>}
      <p className="small muted">Ties share a rank. Wins and podiums are shown for information and don't break ties.</p>
      {cls === 'all' && combined.size > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>All drivers, every class combined</h2><span className="chip">REFERENCE ONLY</span></div>
          <p className="small muted">Each driver's points from all their classes added together. The championships are decided within each class above: this list doesn't name an overall champion.</p>
          <div className="table-wrap"><table><thead><tr><th>Driver</th><th className="num">Points (all classes)</th></tr></thead>
            <tbody>{[...combined.entries()].sort((a, b) => b[1] - a[1] || driverLabel(ds, a[0]).localeCompare(driverLabel(ds, b[0]))).map(([id, pts]) => <tr key={id}><td>{driverLabel(ds, id)}</td><td className="num">{pts}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </>
  );
}
