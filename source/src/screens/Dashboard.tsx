import { useStore } from '../store/store';
import { EventStatusChip, Icon } from '../ui/common';
import { courseLabel } from './shared';

export function Dashboard({ go, seasonId }: { go: (p: string) => void; seasonId: string }) {
  const { ds } = useStore();
  const season = ds.seasons.find((s) => s.id === seasonId);
  const events = ds.events.filter((e) => e.seasonId === seasonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const review = ds.runs.filter((r) => !r.driverId || !r.eventId || r.held).length;
  const finalized = events.filter((e) => e.status === 'finalized').length;
  const batches = [...ds.batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 5);
  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p className="muted">{season?.name ?? 'No season selected'}</p></div>
        <div className="row">
          <button className="primary" onClick={() => go('import')}><Icon name="upload" />Import Data</button>
          <button onClick={() => go('races')}><Icon name="flag" />Open Race</button>
        </div>
      </div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{events.length}</b><span>Race events this season</span></div>
        <div className="stat"><b>{finalized}</b><span>Finalized</span></div>
        <div className="stat"><b>{events.length - finalized}</b><span>Draft or amending</span></div>
        <div className="stat"><b>{review}</b><span>Imported runs to review</span></div>
        <div className="stat"><b>{ds.drivers.length}</b><span>Drivers</span></div>
      </div>
      {review > 0 && <div className="notice">{review} imported run(s) still need a driver, an event or a review. They are kept but don't score. <a href="#/import">Review them</a>.</div>}
      <div className="grid two">
        <section className="panel">
          <div className="panel-head"><h2>Latest races</h2></div>
          {events.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Race</th><th className="hide-sm">Course</th><th>Status</th></tr></thead>
              <tbody>{events.slice(0, 8).map((e) => (
                <tr key={e.id}><td><a href={'#/races/' + e.id}>{e.name}</a>{e.practice && <span className="chip" style={{ marginLeft: 6 }}>PRACTICE</span>}</td>
                  <td className="hide-sm muted">{courseLabel(ds, e.courseId)}</td><td><EventStatusChip status={e.status} /></td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">No race events yet. Import a run log to create one.</div>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Recent imports</h2></div>
          {batches.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Files</th><th className="num">Added</th><th className="num">Duplicates</th><th className="num">Held</th></tr></thead>
              <tbody>{batches.map((b) => (
                <tr key={b.id}><td className="small">{new Date(b.importedAt).toLocaleString()}</td><td className="small">{b.files.map((f) => f.name).join(', ') || 'Pasted text'}</td>
                  <td className="num">{b.added}</td><td className="num">{b.duplicates}</td><td className="num">{b.held}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <div className="empty">Nothing imported yet.</div>}
        </section>
      </div>
    </>
  );
}
