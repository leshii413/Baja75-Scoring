import { activeRefs, eventSheets, refLabel, sheetOf } from '../domain/presets';
import { needsReview } from '../domain/scoring';
import { SHEET_LABEL, type SheetKind } from '../domain/types';
import { useStore } from '../store/store';
import { EventStatusChip, Icon } from '../ui/common';
import { Summary } from './Presets';
import { courseLabel, seasonEvents } from './shared';

export function Dashboard({ go, seasonId }: { go: (p: string) => void; seasonId: string }) {
  const { ds } = useStore();
  const season = ds.seasons.find((s) => s.id === seasonId);
  const events = ds.events.filter((e) => e.seasonId === seasonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ordered = seasonEvents(ds, seasonId);
  const evIds = new Set(events.map((e) => e.id));
  const seasonRuns = ds.runs.filter((r) => r.eventId && evIds.has(r.eventId));
  const review = ds.runs.filter((r) => !r.driverId || !r.eventId || r.held).length;
  const manual = seasonRuns.filter((r) => needsReview(r)).length;
  const finalized = events.filter((e) => e.status === 'finalized').length;
  const counted = events.filter((e) => e.status !== 'draft' && e.included && !e.practice).length;
  const drivers = new Set(seasonRuns.map((r) => r.driverId).filter(Boolean)).size;
  const batches = [...ds.batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 5);
  const active = activeRefs(ds);
  const sheets = ordered.map((e) => ({ e, s: eventSheets(ds, e) }));
  // events not using the active Rule / Penalty Sheet, so a mix-up is easy to spot
  const odd = sheets.filter(({ e, s }) => e.status !== 'finalized' && (s.rules?.slot !== active.rules.slot || s.penalties?.slot !== active.penalties.slot)).length;
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
        <div className="stat"><b>{counted}</b><span>Counting toward Overall Score</span></div>
        <div className="stat"><b>{seasonRuns.length}</b><span>Runs this season</span></div>
        <div className="stat"><b>{drivers}</b><span>Drivers with runs this season</span></div>
        <div className={'stat' + (review ? ' warn' : '')}><b>{review}</b><span>Imported runs to review</span></div>
        <div className={'stat' + (manual ? ' warn' : '')}><b>{manual}</b><span>Results needing manual review</span></div>
      </div>
      {review > 0 && <div className="notice">{review} imported run(s) still need a driver, an event or a review. They are kept but don't score. <a href="#/import">Review them</a>.</div>}
      {manual > 0 && <div className="notice">{manual} result(s) this season were imported with No Data Provided values and are marked MANUAL REVIEW. Open the race, then Details › Source record.</div>}

      <section className="panel">
        <div className="panel-head"><h2>Sheets in use</h2><a className="btn small" href="#/presets">Presets</a></div>
        <p className="small muted">The active presets: what you edit, and what new race events use. Each event below shows the sheets it is scored with.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {(['rules', 'penalties', 'classes'] as SheetKind[]).map((k) => (
            <div key={k} className="preset-card active">
              <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{SHEET_LABEL[k]}</div>
              <b style={{ display: 'block', margin: '2px 0 8px', fontSize: '1.05rem' }}>{refLabel(active[k])}</b>
              <Summary kind={k} sheet={sheetOf(ds, k, active[k].slot)} />
            </div>))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Race events and their sheets</h2>{odd > 0 && <span className="chip warn">{odd} draft event{odd === 1 ? '' : 's'} not on the active sheets</span>}</div>
        {sheets.length ? (
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Event</th><th>Status</th><th>Rule Sheet</th><th>Penalty Sheet</th><th>Class Sheet</th></tr></thead>
            <tbody>{sheets.map(({ e, s }) => {
              const tag = (k: 'rules' | 'penalties' | 'classes') => !s.frozen && s[k] && s[k]!.slot !== active[k].slot ? <span className="chip info" style={{ marginLeft: 6 }}>NOT ACTIVE</span> : null;
              return (
                <tr key={e.id}>
                  <td data-l="Event"><a href={'#/races/' + e.id}>{e.round !== null ? `R${e.round} · ` : ''}{e.name}</a>{e.practice && <span className="chip" style={{ marginLeft: 6 }}>PRACTICE</span>}</td>
                  <td data-l="Status"><EventStatusChip status={e.status} /></td>
                  <td data-l="Rule Sheet">{refLabel(s.rules)}{tag('rules')}</td>
                  <td data-l="Penalty Sheet">{refLabel(s.penalties)}{s.penaltiesChanged && <span className="chip warn" style={{ marginLeft: 6 }} title="This event's penalty rules were changed after the sheet was copied in">CHANGED FOR THIS EVENT</span>}{tag('penalties')}</td>
                  <td data-l="Class Sheet">{refLabel(s.classes)}{s.frozen && <span className="small muted"> (as finalized)</span>}</td>
                </tr>);
            })}</tbody>
          </table></div>
        ) : <div className="empty">No race events in this season yet.</div>}
        <p className="small muted" style={{ marginTop: 8 }}>Draft events show the sheets they will be scored with; finalized events show the sheets recorded when they were finalized ("Not recorded" for results finalized before v1.0.3).</p>
      </section>

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
