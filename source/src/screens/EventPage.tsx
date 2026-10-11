import { Fragment, useMemo, useState } from 'react';
import { cancelAmendment, deleteEvent, deleteRun, editRun, finalizeEvent, history, markReviewed, revertToDraft, selectRun, setEntryStatus, startAmendment, updateEvent } from '../domain/actions';
import { classForRun, sortClasses } from '../domain/classes';
import { penaltiesCsv, resultsCsv } from '../domain/exports';
import { uuid } from '../domain/ids';
import { checkCount, checkSeconds, label as metricLabel } from '../domain/penalties';
import { currentRevision, entryKey, needsReview, scoreEvent, sortResults, timeMissing, type EntryResult } from '../domain/scoring';
import { COL_METRIC, NO_DATA } from '../domain/csv';
import { formatMs, parseDuration } from '../domain/time';
import { METRICS, type Dataset, type ResultLine, type Run } from '../domain/types';
import { useStore } from '../store/store';
import { Dialog, download, EventStatusChip, Icon, safeFile, StatusChip, useOverride, useReason, useToast } from '../ui/common';
import { className, courseLabel, driverLabel, sortedDrivers } from './shared';

type View = 'class' | 'overall' | 'raw';

export function EventPage({ eventId, go }: { eventId: string; go: (p: string) => void }) {
  const { ds, commit } = useStore();
  const toast = useToast();
  const [reasonNode, askReason] = useReason();
  const [view, setView] = useState<View>('class');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [dns, setDns] = useState(false);
  const [overrideNode, askOverride] = useOverride();
  const ev = ds.events.find((e) => e.id === eventId);
  const score = useMemo(() => (ev ? scoreEvent(ds, ev.id) : null), [ds, ev]);
  if (!ev || !score) return <div className="empty">This race event no longer exists. <a href="#/races">Back to Races</a></div>;
  const rev = currentRevision(ds, ev.id);
  const frozen = ev.status === 'finalized' && rev;
  // what's on screen: the frozen snapshot when finalized, the live draft otherwise
  const lines: (ResultLine & { live?: EntryResult })[] = frozen ? rev!.snapshot.results : score.all.map((r) => ({ ...r, live: r }));
  const classes = sortClasses(ds.classes).filter((c) => lines.some((l) => l.classId === c.id));
  const course = ds.courses.find((c) => c.id === ev.courseId);

  const doFinalize = () => {
    const publish = (reason: string) => commit((d) => {
      const f = finalizeEvent(d, ev.id, reason);
      if (!f.ok) { toast('Not finalized: ' + f.blockers[0]); return d; }
      return f.ds;
    }).then((ok) => ok && toast(ev.status === 'amending' ? 'Amendment published' : 'Event finalized: its results now count in Overall Score'));
    if (ev.status === 'amending') askReason('Publish amendment', 'Why are the results changing? The earlier revision is kept in the history.', publish);
    else publish('Finalized');
  };

  return (
    <>
      {reasonNode}
      {overrideNode}
      <div className="page-head">
        <div>
          <div className="crumbs"><a href="#/races">Races</a> › {courseLabel(ds, ev.courseId)}</div>
          <h1>{ev.name} <EventStatusChip status={ev.status} />{ev.practice && <span className="chip" style={{ marginLeft: 6 }}>PRACTICE</span>}{!ev.included && <span className="chip" style={{ marginLeft: 6 }}>NOT COUNTED</span>}</h1>
          <p className="muted small">Course <b>{course?.originalName}</b>{course?.alias ? ` (shown as ${course.alias})` : ''} · Map {course?.map || 'unknown'} · Round {ev.round ?? '—'}{ev.date ? ' · ' + ev.date : ''} · {ev.format === 'best' ? 'Best adjusted attempt' : 'Selected attempt'}
            {rev && <> · Official revision {rev.revision} ({new Date(rev.createdAt).toLocaleString()})</>}</p>
        </div>
        <div className="row no-print">
          {ev.status === 'draft' && <button className="primary" onClick={doFinalize} disabled={score.blockers.length > 0}><Icon name="check" />Finalize</button>}
          {ev.status === 'finalized' && <button onClick={() => askReason('Start amendment', 'Why does this finalized event need changing? The published results keep counting until the amendment is published.', (r) => commit((d) => startAmendment(d, ev.id, r)))}>Start amendment</button>}
          {ev.status === 'amending' && <><button className="primary" onClick={doFinalize} disabled={score.blockers.length > 0}>Publish amendment</button><button onClick={() => commit((d) => cancelAmendment(d, ev.id))}>Cancel amendment</button></>}
          <button onClick={() => download(`${safeFile(ev.name)}_results.csv`, resultsCsv(ds, ev.id))}><Icon name="down" />Results CSV</button>
          <button onClick={() => download(`${safeFile(ev.name)}_penalties.csv`, penaltiesCsv(ds, ev.id))}><Icon name="down" />Penalties CSV</button>
          <button onClick={() => window.print()}><Icon name="print" />Print</button>
          <button onClick={() => setEdit(true)} disabled={ev.status === 'finalized'}>Event settings</button>
          {ev.status !== 'draft' && <button onClick={() => askOverride({ title: 'Revert to draft: ' + ev.name, what: [
            'Takes this event back to draft so its results can be changed freely.',
            'It stops counting in Overall Score until it is finalized again.',
            `Its ${ds.revisions.filter((r) => r.eventId === ev.id).length} revision(s) are kept in the list, set aside. The next finalize makes a new revision.`],
            then: (r) => commit((d) => revertToDraft(d, ev.id, r)).then((ok) => ok && toast('Back to draft')) })}><Icon name="lock" />Revert to draft…</button>}
          <button className="danger" onClick={() => {
            const runs = ds.runs.filter((r) => r.eventId === ev.id).length;
            askOverride({ title: 'Delete race event: ' + ev.name, danger: true, what: [
              `Removes ${ev.name} with its ${runs} imported run(s), entries, penalties, event rules and results${rev ? ', including the official results (it stops counting in Overall Score)' : ''}.`,
              'Drivers, classes and the course stay.'],
              then: (r) => commit((d) => deleteEvent(d, ev.id, r)).then((ok) => { if (ok) { toast('Race event deleted'); go('races'); } }) });
          }}><Icon name="lock" />Delete event…</button>
        </div>
      </div>
      <div className="only-print"><h2>{ev.name} · {courseLabel(ds, ev.courseId)} · {frozen ? `Official results (revision ${rev!.revision})` : 'Draft results'}</h2></div>

      {ev.status === 'amending' && <div className="notice info">Amending: the results below are the draft. Overall Score still uses revision {rev?.revision} until you publish the amendment.</div>}
      {!frozen && score.blockers.length > 0 && (
        <div className="notice no-print"><b>Before this event can be finalized:</b><ul>{score.blockers.slice(0, 12).map((b) => <li key={b}>{b}</li>)}</ul>{score.blockers.length > 12 && <span className="small">…and {score.blockers.length - 12} more</span>}</div>
      )}
      {!frozen && <Unassigned ds={ds} score={score} commit={commit} askReason={askReason} />}

      <div className="row no-print" style={{ margin: '4px 0 12px' }}>
        <div className="seg" role="group" aria-label="Results view">
          <button aria-pressed={view === 'class'} onClick={() => setView('class')}>Class results</button>
          <button aria-pressed={view === 'overall'} onClick={() => setView('overall')}>Overall placement</button>
          <button aria-pressed={view === 'raw'} onClick={() => setView('raw')}>Raw-time order</button>
        </div>
        {!frozen && <button className="small" onClick={() => setDns(true)}>Add DNS / DSQ entry</button>}
        {!frozen && ev.format === 'selected' && score.all.some((r) => !r.selectedRun && r.runs.length === 1 && !r.entry.statusOverride) &&
          <button className="small" onClick={() => commit((d) => { let x = d; for (const r of score.all) if (!r.selectedRun && r.runs.length === 1 && !r.entry.statusOverride) x = selectRun(x, r.entryId, r.runs[0].id, 'Only attempt selected'); return x; })}>Select the only attempt for drivers with one run</button>}
      </div>

      {view === 'class' && (classes.length ? classes.map((c) => {
        const rows = sortResults(lines.filter((l) => l.classId === c.id), ds);
        return (
          <section className="panel class-block" key={c.id}>
            <div className="class-title"><h3>{c.label}</h3><span className="muted small">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · ranked by adjusted time</span></div>
            <ResultsTable ds={ds} rows={rows} openRow={openRow} setOpenRow={setOpenRow} frozen={!!frozen} commit={commit} askReason={askReason} ev={ev} rankKey="class" />
          </section>
        );
      }) : <div className="empty">No class results yet. Import runs for this event, assign drivers and map vehicles to classes.</div>)}

      {view === 'overall' && (
        <section className="panel">
          <div className="class-title"><h3>Overall placement (all classes)</h3></div>
          <p className="small muted">Every finisher by adjusted time across all classes. For information: race points are awarded within each class, never from this order.</p>
          <ResultsTable ds={ds} rows={[...lines].sort((a, b) => (a.overallRank ?? 1e9) - (b.overallRank ?? 1e9))} openRow={openRow} setOpenRow={setOpenRow} frozen={!!frozen} commit={commit} askReason={askReason} ev={ev} rankKey="overall" />
        </section>
      )}
      {view === 'raw' && (
        <section className="panel">
          <div className="class-title"><h3>Raw-time order (before penalties)</h3></div>
          <p className="small muted">For comparison only: ranks and points use adjusted time.</p>
          <ResultsTable ds={ds} rows={[...lines].filter((l) => l.status === 'FINISHED').sort((a, b) => (a.rawMs ?? 1e15) - (b.rawMs ?? 1e15))} openRow={openRow} setOpenRow={setOpenRow} frozen={!!frozen} commit={commit} askReason={askReason} ev={ev} rankKey="raw" />
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Total Points</h2><span className="muted small">{frozen ? `Official, revision ${rev!.revision}` : 'Draft: not official until finalized'}</span></div>
        {lines.length ? (
          <div className="table-wrap"><table className="cards">
            <thead><tr><th>Class</th><th className="num">Position</th><th>Driver</th><th>Status</th><th className="num">Points</th></tr></thead>
            <tbody>{classes.flatMap((c) => sortResults(lines.filter((l) => l.classId === c.id), ds)).map((l) => (
              <tr key={l.entryId}><td data-l="Class">{className(ds, l.classId)}</td><td data-l="Position" className="num rank">{l.classRank ?? '—'}{l.tied && <span className="tie">TIE</span>}</td>
                <td data-l="Driver">{driverLabel(ds, l.driverId)}</td><td data-l="Status"><StatusChip status={l.status} pending={!!l.live && !l.live.selectedRun && !l.live.entry.statusOverride} /></td>
                <td data-l="Points" className="num pts">{l.points}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty">No points yet.</div>}
      </section>

      {rev && <Revisions ds={ds} eventId={ev.id} />}
      {edit && <EventSettings ev={ev} onClose={() => setEdit(false)} />}
      <DnsDialog open={dns} onClose={() => setDns(false)} ds={ds} eventId={ev.id} onSave={(driverId, classId, status, reason) => {
        commit((d) => setEntryStatus(d, entryKey(ev.id, driverId, classId), status, reason)).then((ok) => { if (ok) { setDns(false); toast(`${status} recorded`); } });
      }} />
      <p className="no-print small" style={{ marginTop: 20 }}><button className="ghost small" onClick={() => go('races')}>← All races</button></p>
    </>
  );
}

type Commit = (fn: (d: Dataset) => Dataset) => Promise<boolean>;
type AskReason = (title: string, help: string, then: (r: string) => void, initial?: string) => void;

function ResultsTable({ ds, rows, openRow, setOpenRow, frozen, commit, askReason, ev, rankKey }: {
  ds: Dataset; rows: (ResultLine & { live?: EntryResult })[]; openRow: string | null; setOpenRow: (k: string | null) => void; frozen: boolean;
  commit: Commit; askReason: AskReason; ev: { id: string; format: string }; rankKey: 'class' | 'overall' | 'raw';
}) {
  if (!rows.length) return <div className="empty">Nothing here.</div>;
  return (
    <div className="table-wrap"><table className="cards">
      <thead><tr>
        <th className="num">{rankKey === 'class' ? 'Class rank' : rankKey === 'overall' ? 'Overall' : '#'}</th><th>Driver</th><th className="num">Race number</th><th>Vehicle</th>
        {rankKey !== 'class' && <th>Class</th>}
        <th className="num">Raw time</th><th className="num">Penalty time</th><th className="num">Adjusted time</th><th>Status</th>
        {rankKey !== 'class' && <th className="num">Class rank</th>}<th className="num">Race points</th><th className="no-print"><span className="sr">Details</span></th>
      </tr></thead>
      <tbody>{rows.map((l, i) => {
        const run = ds.runs.find((r) => r.id === l.runId);
        const d = ds.drivers.find((x) => x.id === l.driverId);
        const key = l.entryId + rankKey;
        const isOpen = openRow === key;
        const pending = !!l.live && !l.live.selectedRun && !l.live.entry.statusOverride;
        const rank = rankKey === 'class' ? l.classRank : rankKey === 'overall' ? l.overallRank : i + 1;
        return (
          <Fragment key={key}>
            <tr className={isOpen ? 'expanded' : ''}>
              <td data-l={rankKey === 'class' ? 'Class rank' : 'Position'} className="num rank">{rank ?? '—'}{rankKey === 'class' && l.tied && <span className="tie" title="Equal adjusted time: shared position">TIE</span>}</td>
              <td data-l="Driver">{d?.name ?? 'Unknown'}{needsReview(run) && <span className="chip warn" style={{ marginLeft: 6 }} title={`${NO_DATA}: ${run!.noData!.join(', ')}`}>MANUAL REVIEW</span>}</td>
              <td data-l="Race number" className="num">{d?.number || '—'}</td>
              <td data-l="Vehicle" className="small">{run?.vehicle ?? '—'}</td>
              {rankKey !== 'class' && <td data-l="Class">{className(ds, l.classId)}</td>}
              <td data-l="Raw time" className="num">{l.status === 'DNF' && l.rawMs !== null ? <span title="Time before stopping, not a finish time">DNF {formatMs(l.rawMs)}</span> : formatMs(l.status === 'FINISHED' ? l.rawMs : null)}</td>
              <td data-l="Penalty time" className="num">{l.penaltyMs ? formatMs(l.penaltyMs, { plus: true }) : '0:00.0'}</td>
              <td data-l="Adjusted time" className="num"><b>{formatMs(l.adjustedMs)}</b></td>
              <td data-l="Status"><StatusChip status={l.status} pending={pending} /></td>
              {rankKey !== 'class' && <td data-l="Class rank" className="num">{l.classRank ?? '—'}</td>}
              <td data-l="Race points" className="num pts">{l.points}</td>
              <td className="full no-print"><button className="small" aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : key)}>{isOpen ? 'Close' : 'Details'}</button></td>
            </tr>
            {isOpen && <tr className="detail"><td colSpan={12}><EntryDetail ds={ds} line={l} frozen={frozen} commit={commit} askReason={askReason} ev={ev} /></td></tr>}
          </Fragment>
        );
      })}</tbody>
    </table></div>
  );
}

function EntryDetail({ ds, line, frozen, commit, askReason, ev }: { ds: Dataset; line: ResultLine & { live?: EntryResult }; frozen: boolean; commit: Commit; askReason: AskReason; ev: { id: string; format: string } }) {
  const live = line.live;
  const runs = live?.runs ?? ds.runs.filter((r) => r.id === line.runId);
  const sel = ds.runs.find((r) => r.id === line.runId) ?? null;
  const [man, setMan] = useState({ name: '', reason: '', count: '1', seconds: '' });
  const manErr = !man.name.trim() ? 'Name it' : !man.reason.trim() ? 'A reason is required' : !checkCount(man.count).ok ? 'Count: a whole number' : (() => { const c = checkSeconds(man.seconds); return !c.ok ? c.error : c.value === null ? 'Seconds are required' : null; })();
  const entryId = line.entryId;
  return (
    <div className="grid two">
      <div className="stack">
        <h4>Attempts</h4>
        {runs.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{ev.format === 'selected' ? 'Official' : 'Used'}</th><th>When</th><th className="num">Time</th><th className="num">Penalties</th><th>Status</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <td>{ev.format === 'selected' && !frozen ? (
                  <label className="check"><input type="radio" name={'sel-' + entryId} checked={line.runId === r.id} onChange={() => commit((d) => selectRun(d, entryId, r.id))} /><span className="sr">Select this attempt</span></label>
                ) : line.runId === r.id ? <span className="chip ok">USED</span> : ''}</td>
                <td className="small">{r.timestampText || r.localDate || '—'}</td>
                <td className="num">{r.status === 'DNF' ? 'DNF ' : ''}{formatMs(r.elapsedMs)}{r.precisionMs === 1 ? '' : ''}</td>
                <td className="num">{live?.runPenaltyMs.has(r.id) ? formatMs(live.runPenaltyMs.get(r.id)!, { plus: true }) : '—'}</td>
                <td><StatusChip status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted small">No attempts{line.status === 'DNS' ? ' (did not start)' : ''}.</p>}
        {!frozen && (
          <div className="row">
            {(['DNS', 'DSQ'] as const).map((s) => live?.entry.statusOverride === s
              ? <button key={s} className="small" onClick={() => askReason(`Remove ${s}`, 'Why is this status being removed?', (r) => commit((d) => setEntryStatus(d, entryId, null, r)))}>Remove {s}</button>
              : <button key={s} className="small danger" onClick={() => askReason(`Mark ${s}`, s === 'DSQ' ? 'Why is this entry disqualified? (0 points, no position)' : 'Why is this a DNS? (0 points, no position)', (r) => commit((d) => setEntryStatus(d, entryId, s, r)))}>Mark {s}</button>)}
          </div>
        )}
        {runs.map((r) => <SourceRecord key={r.id} run={r} ds={ds} frozen={frozen} commit={commit} askReason={askReason} />)}
      </div>
      <div className="stack">
        <h4>Penalties</h4>
        {line.breakdown.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Penalty</th><th className="num">Count</th><th className="num">Each</th><th className="num">Added</th>{!frozen && sel && <th></th>}</tr></thead>
            <tbody>{line.breakdown.map((b, i) => {
              const rule = b.kind === 'auto' ? ds.rules.find((r) => r.scope === ev.id && r.metric === b.metric && r.name === b.name) : null;
              const ov = rule && sel ? ds.overrides.find((o) => o.runId === sel.id && o.ruleId === rule.id) : null;
              const mp = b.kind === 'manual' ? ds.manualPenalties.filter((m) => m.entryId === entryId).find((m) => m.name === b.name && m.reason === b.reason) : null;
              return (
                <tr key={i}>
                  <td><b>{b.name}</b>{b.kind === 'manual' && <span className="chip orange" style={{ marginLeft: 6 }}>MANUAL</span>}<div className="small muted">{b.reason}</div>{b.note && <div className="small" style={{ color: 'var(--warn)' }}>{b.note}</div>}</td>
                  <td className="num">{b.count}</td><td className="num">{b.seconds} s</td><td className="num">{formatMs(b.addedMs, { plus: true })}</td>
                  {!frozen && sel && <td className="no-print">
                    {rule && !ov && <span className="row" style={{ gap: 4 }}>
                      <button className="small" onClick={() => askReason(`Waive "${b.name}"`, 'Why is this penalty waived for this run?', (r) => commit((d) => history({ ...d, overrides: [...d.overrides, { id: uuid(), runId: sel.id, ruleId: rule.id, count: null, waived: true, justification: r }] }, 'waiver', 'run', sel.id, null, rule.name, r)))}>Waive</button>
                      <button className="small" onClick={() => { const v = window.prompt(`Correct count for ${b.name} (now ${b.count})`); if (v === null) return; const c = checkCount(v); if (!c.ok) { window.alert(c.error); return; } askReason('Correct the count', `Why is ${metricLabel(b.metric)} ${c.value} instead of the imported value?`, (r) => commit((d) => history({ ...d, overrides: [...d.overrides, { id: uuid(), runId: sel.id, ruleId: rule.id, count: c.value, waived: false, justification: r }] }, 'count-correction', 'run', sel.id, b.count, c.value, r))); }}>Correct</button>
                    </span>}
                    {ov && <button className="small" onClick={() => askReason('Remove the waiver / correction', 'Why?', (r) => commit((d) => history({ ...d, overrides: d.overrides.filter((o) => o.id !== ov.id) }, 'override-removed', 'run', sel.id, ov, null, r)))}>Undo</button>}
                    {mp && <button className="small" onClick={() => askReason('Remove manual penalty', 'Why is it removed?', (r) => commit((d) => history({ ...d, manualPenalties: d.manualPenalties.filter((m) => m.id !== mp.id) }, 'manual-penalty-removed', 'entry', entryId, mp, null, r)))}>Remove</button>}
                  </td>}
                </tr>);
            })}</tbody>
          </table></div>
        ) : <p className="muted small">No penalties.</p>}
        <p className="small">Total penalty: <b className="num">{formatMs(line.penaltyMs, { plus: true })}</b> · Adjusted: <b className="num">{formatMs(line.adjustedMs)}</b></p>
        {!frozen && (
          <details>
            <summary className="small">Add a manual penalty</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="field">Name<input value={man.name} onChange={(e) => setMan({ ...man, name: e.target.value })} placeholder="Unsafe re-entry" /></label>
              <label className="field">Reason (required)<input value={man.reason} onChange={(e) => setMan({ ...man, reason: e.target.value })} placeholder="Steward decision, video at 2:14" /></label>
              <div className="row">
                <label className="field">Count<input className="secs" inputMode="numeric" value={man.count} onChange={(e) => setMan({ ...man, count: e.target.value })} /></label>
                <label className="field">Seconds each (0–9999)<input className="secs" inputMode="numeric" value={man.seconds} aria-invalid={!!man.seconds && !checkSeconds(man.seconds).ok} onChange={(e) => setMan({ ...man, seconds: e.target.value })} /></label>
              </div>
              {manErr && <span className="small muted">{manErr}</span>}
              <button className="primary small" disabled={!!manErr} onClick={() => {
                const sec = checkSeconds(man.seconds); const cnt = checkCount(man.count);
                if (!sec.ok || sec.value === null || !cnt.ok) return;
                const mp = { id: uuid(), entryId, name: man.name.trim(), reason: man.reason.trim(), count: cnt.value, seconds: sec.value };
                commit((d) => history({ ...d, manualPenalties: [...d.manualPenalties, mp] }, 'manual-penalty', 'entry', entryId, null, mp, mp.reason)).then((ok) => ok && setMan({ name: '', reason: '', count: '1', seconds: '' }));
              }}>Add penalty</button>
            </div>
          </details>
        )}
        {live?.warnings.length ? <div className="notice small">{live.warnings.join(' · ')}</div> : null}
      </div>
    </div>
  );
}

function SourceRecord({ run, ds, frozen, commit, askReason }: { run: Run; ds: Dataset; frozen: boolean; commit: Commit; askReason: AskReason }) {
  const a = classForRun(run, ds.mappings);
  const [overrideNode, askOverride] = useOverride();
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const ev = ds.events.find((e) => e.id === run.eventId);
  const nd = (col: string) => !!run.noData?.includes(col);
  const ndTag = <span style={{ color: 'var(--warn)' }}>{NO_DATA}</span>;
  const metricCol = (key: string) => Object.entries(COL_METRIC).find(([, m]) => m === key)?.[0] ?? '';
  const frozenNote = ev && ev.status === 'finalized' ? 'This event is finalized: its official results don\u2019t change until it is amended or reverted to draft.' : 'The draft results update straight away.';
  return (
    <details>
      <summary className="small">Source record · {run.status === 'DNF' ? 'DNF ' : ''}{formatMs(run.elapsedMs)} · {run.sourceFile || run.source}</summary>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Course</dt><dd>{nd('course') ? ndTag : run.courseName}</dd><dt>Map</dt><dd>{nd('map') ? ndTag : run.map || '—'}</dd>
        <dt>Vehicle</dt><dd>{nd('vehicle') ? ndTag : run.vehicle || '—'} {run.modelId && <span className="muted">(model {run.modelId})</span>}</dd>
        <dt>Class</dt><dd>{className(ds, a.classId)} <span className="muted small">({a.how === 'manual' ? 'set by hand' : a.how.replace('-', ' ')})</span>
          {!frozen && <select className="small" style={{ marginLeft: 6, minHeight: 32 }} aria-label="Set class for this run" value={run.classOverride ?? ''} onChange={(e) => {
            const v = e.target.value || null;
            askReason('Set this run’s class by hand', 'Why does this run go in this class?', (r) => commit((d) => history({ ...d, runs: d.runs.map((x) => (x.id === run.id ? { ...x, classOverride: v } : x)) }, 'class-assignment', 'run', run.id, run.classOverride, v, r)));
          }}><option value="">From mappings</option>{sortClasses(ds.classes).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}</dd>
        <dt>Date</dt><dd>{nd('date') ? ndTag : run.timestampText || '—'} {run.utcIso && <span className="muted small">= {run.utcIso} UTC</span>}</dd>
        <dt>Time</dt><dd className="num">{timeMissing(run) ? <>{ndTag} <span className="small muted">(enter it with Change this run)</span></> : <>{run.status === 'DNF' ? 'DNF after ' : ''}{formatMs(run.elapsedMs)} <span className="muted small">{run.precisionMs === 1 ? 'exact (ms)' : 'to the tenth'}</span></>}</dd>
        {METRICS.map((m) => <Fragment key={m.key}><dt>{m.label}</dt><dd className="num">{nd(metricCol(m.key)) ? <>0 <span className="small" style={{ color: 'var(--warn)' }}>({NO_DATA})</span></> : run.counters[m.key] ?? <span style={{ color: 'var(--warn)' }}>unknown</span>}</dd></Fragment>)}
        <dt>Time off course</dt><dd className="num">{run.timeOffCourseMs === null ? 'unknown' : formatMs(run.timeOffCourseMs)} <span className="muted small">(for review, not a penalty)</span></dd>
        {run.vcpsTotal !== null && <><dt>VCPs</dt><dd>{run.vcpsCleared}/{run.vcpsTotal}</dd></>}
        {(run.sourceDriver || run.sourceNumber) && <><dt>Driver in log</dt><dd>{run.sourceDriver} {run.sourceNumber && '#' + run.sourceNumber}</dd></>}
        {run.session && <><dt>Session</dt><dd>{run.session}</dd></>}
        {run.unknownFields.server && <><dt>Server</dt><dd>{run.unknownFields.server} <span className="muted small">(note only)</span></dd></>}
      </dl>
      {run.segments.length > 0 && <><h4 style={{ marginTop: 10 }}>Off-course moments</h4><ul className="small">{run.segments.map((s) => <li key={s.index}>#{s.index} at {formatMs(s.atMs)} · RM {s.rmMiles ?? '?'} mi · off for {formatMs(s.offForMs)} · resets {s.resets ?? '?'} · recoveries {s.recoveries ?? '?'}</li>)}</ul></>}
      {run.damage.length > 0 && <><h4>Damage hits</h4><ul className="small">{run.damage.map((h) => <li key={h.index}>#{h.index} at {formatMs(h.atMs)} · RM {h.rmMiles ?? '?'} mi · {h.parts}</li>)}</ul></>}
      {run.truncation.length > 0 && <p className="small" style={{ color: 'var(--warn)' }}>Not every detail was written to the log: {run.truncation.join('; ')}. The counts above are complete.</p>}
      {run.noData?.length ? (
        <div className={'notice small' + (needsReview(run) ? '' : ' ok')}>
          <b>{needsReview(run) ? 'MANUAL REVIEW NEEDED' : 'Reviewed'}</b>: imported with {NO_DATA} for {run.noData.join(', ')}. It still counts as a valid result;
          {' '}penalty counts marked {NO_DATA} score as 0.{timeMissing(run) && ' The time must be entered before the race can be finalized.'}
          {run.reviewed && !timeMissing(run) && <> Reviewed: {run.reviewed}</>}
          {needsReview(run) && !timeMissing(run) && !frozen && <div style={{ marginTop: 6 }}><button className="small" onClick={() => askReason('Mark as reviewed', `What did you check? The ${NO_DATA} values stay as they are (penalty counts 0).`, (r) => commit((d) => markReviewed(d, run.id, r)).then((ok) => ok && toast('Marked as reviewed')))}>Mark as reviewed…</button></div>}
        </div>) : null}
      {run.issues.length > 0 && <div className="notice small"><ul>{run.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {Object.keys(run.unknownFields).length > 0 && <p className="small muted">Other fields: {Object.entries(run.unknownFields).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
      <pre className="raw">{run.raw}</pre>
      <div className="row no-print">
        <button className="small" onClick={() => setEditing(true)}><Icon name="lock" />Change this run…</button>
        <button className="small danger" onClick={() => askOverride({ title: 'Delete this run', danger: true, what: [
          `Removes the ${run.status === 'DNF' ? 'DNF' : formatMs(run.elapsedMs)} run of ${run.timestampText || run.localDate || 'unknown date'} (${run.vehicle || 'no vehicle'}).`,
          'If it was the official attempt, the driver goes back to "no attempt selected".', frozenNote],
          then: (r) => commit((d) => deleteRun(d, run.id, r)).then((ok) => ok && toast('Run deleted')) })}><Icon name="lock" />Delete this run…</button>
      </div>
      {overrideNode}
      {editing && <EditRunDialog run={run} onClose={() => setEditing(false)} onSave={(patch, summary) => askOverride({ title: 'Change this run', what: [summary, 'The imported text stays in the source record.', frozenNote],
        then: (r) => commit((d) => editRun(d, run.id, patch, r)).then((ok) => { if (ok) { setEditing(false); toast('Run changed'); } }) })} />}
    </details>
  );
}

function Unassigned({ ds, score, commit, askReason }: { ds: Dataset; score: ReturnType<typeof scoreEvent>; commit: Commit; askReason: AskReason }) {
  const toast = useToast();
  if (!score.noClass.length && !score.noDriver.length && !score.held.length) return null;
  const byModel = new Map<string, Run[]>();
  for (const { run } of score.noClass) { const k = run.modelId ?? run.vehicle; byModel.set(k, [...(byModel.get(k) ?? []), run]); }
  return (
    <section className="panel" style={{ borderColor: '#6a5220' }}>
      <div className="panel-head"><h2>Needs review</h2><span className="chip warn">NOT SCORED</span></div>
      {score.noClass.length > 0 && <>
        <h4>Unassigned vehicles</h4>
        <div className="table-wrap"><table className="cards"><thead><tr><th>Vehicle</th><th className="num">Runs</th><th>Why</th><th>Map to class (template)</th></tr></thead>
          <tbody>{[...byModel.entries()].map(([k, runs]) => (
            <tr key={k}><td data-l="Vehicle">{runs[0].vehicle || '(none)'}</td><td data-l="Runs" className="num">{runs.length}</td><td data-l="Why" className="small">{score.noClass.find((x) => x.run.id === runs[0].id)?.reason}</td>
              <td data-l="Class">{runs[0].modelId ? <select aria-label={`Class for ${runs[0].modelId}`} defaultValue="" onChange={(e) => {
                const cid = e.target.value; if (!cid) return;
                commit((d) => history({ ...d, mappings: [...d.mappings, { id: uuid(), matchType: 'model', matchValue: runs[0].modelId!, classId: cid, scope: 'global' }] }, 'mapping', 'mapping', runs[0].modelId!, null, cid, 'Mapped from a race page'))
                  .then((ok) => ok && toast(`Model ${runs[0].modelId} → ${className(ds, cid)}`));
              }}><option value="">Model “{runs[0].modelId}” →</option>{sortClasses(ds.classes).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select> : <a href="#/classes">Map in Classes &amp; Vehicles</a>}</td></tr>
          ))}</tbody></table></div>
      </>}
      {score.noDriver.length > 0 && <>
        <h4 style={{ marginTop: 12 }}>Runs without a driver</h4>
        <div className="table-wrap"><table className="cards"><thead><tr><th>When</th><th>Vehicle</th><th className="num">Time</th><th>Driver</th></tr></thead>
          <tbody>{score.noDriver.map((r) => (
            <tr key={r.id}><td data-l="When" className="small">{r.timestampText}</td><td data-l="Vehicle" className="small">{r.vehicle}</td><td data-l="Time" className="num">{formatMs(r.elapsedMs)}</td>
              <td data-l="Driver"><select aria-label="Driver" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) commit((d) => history({ ...d, runs: d.runs.map((x) => (x.id === r.id ? { ...x, driverId: v } : x)) }, 'driver-assignment', 'run', r.id, null, v, 'Assigned on the race page')); }}>
                <option value="">Pick driver…</option>{sortedDrivers(ds).map((d) => <option key={d.id} value={d.id}>{d.name}{d.number ? ' #' + d.number : ''}</option>)}</select></td></tr>
          ))}</tbody></table></div>
      </>}
      {score.held.length > 0 && <>
        <h4 style={{ marginTop: 12 }}>Changed copies held for review</h4>
        <p className="small muted">These came in with the same run id or start time as a run already imported, but different content. Keep both, or discard the new copy.</p>
        {score.held.map((r) => (
          <div key={r.id} className="row" style={{ marginBottom: 8 }}>
            <span className="small">{r.timestampText} · {driverLabel(ds, r.driverId)} · {formatMs(r.elapsedMs)} · {r.heldReason}</span>
            <button className="small" onClick={() => askReason('Keep this copy', 'Why is this copy kept as a separate attempt?', (why) => commit((d) => history({ ...d, runs: d.runs.map((x) => (x.id === r.id ? { ...x, held: false } : x)) }, 'held-accepted', 'run', r.id, true, false, why)))}>Keep as attempt</button>
            <button className="small danger" onClick={() => askReason('Discard this copy', 'Why is it discarded?', (why) => commit((d) => history({ ...d, runs: d.runs.filter((x) => x.id !== r.id) }, 'held-discarded', 'run', r.id, r, null, why)))}>Discard</button>
          </div>
        ))}
      </>}
    </section>
  );
}

function Revisions({ ds, eventId }: { ds: Dataset; eventId: string }) {
  const revs = ds.revisions.filter((r) => r.eventId === eventId).sort((a, b) => b.revision - a.revision);
  return (
    <details className="panel no-print">
      <summary><b>Revisions ({revs.length})</b></summary>
      <div className="table-wrap" style={{ marginTop: 8 }}><table><thead><tr><th className="num">Revision</th><th>When</th><th>Justification</th><th>State</th></tr></thead>
        <tbody>{revs.map((r) => <tr key={r.id}><td className="num">{r.revision}</td><td className="small">{new Date(r.createdAt).toLocaleString()}</td><td className="small">{r.justification}</td><td>{r.superseded ? <span className="chip">SUPERSEDED</span> : <span className="chip ok">OFFICIAL</span>}</td></tr>)}</tbody></table></div>
    </details>
  );
}

function EventSettings({ ev, onClose }: { ev: NonNullable<Dataset['events'][number]>; onClose: () => void }) {
  const { ds, commit } = useStore();
  const [f, setF] = useState({ name: ev.name, round: ev.round === null ? '' : String(ev.round), date: ev.date, format: ev.format, included: ev.included, practice: ev.practice, seasonId: ev.seasonId });
  const roundBad = f.round.trim() !== '' && !/^\d{1,4}$/.test(f.round.trim());
  return (
    <Dialog open title="Event settings" onClose={onClose} foot={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={roundBad || !f.name.trim()} onClick={() => commit((d) => updateEvent(d, ev.id, { name: f.name.trim(), round: f.round.trim() ? Number(f.round) : null, date: f.date, format: f.format, included: f.included, practice: f.practice, seasonId: f.seasonId }, 'Event settings')).then((ok) => ok && onClose())}>Save</button></>}>
      <div className="stack">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="row">
          <label className="field">Round<input inputMode="numeric" value={f.round} aria-invalid={roundBad} onChange={(e) => setF({ ...f, round: e.target.value })} /></label>
          <label className="field">Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field">Season<select value={f.seasonId} onChange={(e) => setF({ ...f, seasonId: e.target.value })}>{ds.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        </div>
        <label className="check"><input type="radio" checked={f.format === 'selected'} onChange={() => setF({ ...f, format: 'selected' })} />Selected attempt (an official picks the run that counts)</label>
        <label className="check"><input type="radio" checked={f.format === 'best'} onChange={() => setF({ ...f, format: 'best' })} />Best adjusted attempt (time trial)</label>
        <label className="check"><input type="checkbox" checked={f.included} onChange={(e) => setF({ ...f, included: e.target.checked })} />Counts toward the season's Overall Score</label>
        <label className="check"><input type="checkbox" checked={f.practice} onChange={(e) => setF({ ...f, practice: e.target.checked })} />Practice (never counts)</label>
      </div>
    </Dialog>
  );
}

function DnsDialog({ open, onClose, ds, eventId, onSave }: { open: boolean; onClose: () => void; ds: Dataset; eventId: string; onSave: (driverId: string, classId: string, s: 'DNS' | 'DSQ', reason: string) => void }) {
  const [f, setF] = useState({ driver: '', cls: '', status: 'DNS' as 'DNS' | 'DSQ', reason: '' });
  const ok = f.driver && f.cls && f.reason.trim();
  return (
    <Dialog open={open} title="Add a DNS / DSQ entry" onClose={onClose} foot={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ok} onClick={() => onSave(f.driver, f.cls, f.status, f.reason.trim())}>Save</button></>}>
      <div className="stack">
        <p className="small muted">For a driver entered in this event who has no run to import (0 points, no position).</p>
        <label className="field">Driver<select value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}><option value="">Pick…</option>{sortedDrivers(ds).map((d) => <option key={d.id} value={d.id}>{d.name}{d.number ? ' #' + d.number : ''}</option>)}</select></label>
        <label className="field">Class<select value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })}><option value="">Pick…</option>{sortClasses(ds.classes).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <div className="seg" role="group" aria-label="Status">{(['DNS', 'DSQ'] as const).map((s) => <button key={s} aria-pressed={f.status === s} onClick={() => setF({ ...f, status: s })}>{s}</button>)}</div>
        <label className="field">Reason (required)<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <p className="small muted">Event: {ds.events.find((e) => e.id === eventId)?.name}</p>
      </div>
    </Dialog>
  );
}

function EditRunDialog({ run, onClose, onSave }: { run: Run; onClose: () => void; onSave: (patch: Parameters<typeof editRun>[2], summary: string) => void }) {
  const [time, setTime] = useState(formatMs(run.elapsedMs));
  const [status, setStatus] = useState(run.status);
  const [counts, setCounts] = useState<Record<string, string>>(Object.fromEntries(METRICS.map((m) => [m.key, run.counters[m.key] === null ? '' : String(run.counters[m.key])])));
  const d = parseDuration(time);
  const bad = METRICS.filter((m) => counts[m.key].trim() !== '' && !checkCount(counts[m.key]).ok).map((m) => m.label);
  const ok = !!d && !bad.length;
  const save = () => {
    if (!d) return;
    const counters = Object.fromEntries(METRICS.map((m) => [m.key, counts[m.key].trim() === '' ? null : Number(counts[m.key])])) as Run['counters'];
    const changes: string[] = [];
    if (d.ms !== run.elapsedMs) changes.push(`time ${formatMs(run.elapsedMs)} → ${formatMs(d.ms)}`);
    if (status !== run.status) changes.push(`status ${run.status} → ${status}`);
    for (const m of METRICS) if (counters[m.key] !== run.counters[m.key]) changes.push(`${m.label} ${run.counters[m.key] ?? 'unknown'} → ${counters[m.key] ?? 'unknown'}`);
    if (!changes.length) { onClose(); return; }
    onSave({ elapsedMs: d.ms, precisionMs: d.ms === run.elapsedMs ? run.precisionMs : d.precisionMs, status, counters }, 'Changes ' + changes.join(', ') + '.');
  };
  return (
    <Dialog open title="Change this run" onClose={onClose} foot={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ok} onClick={save}><Icon name="lock" />Save…</button></>}>
      <div className="stack">
        <div className="row">
          <label className="field">Time (m:ss.t)<input className="num" value={time} aria-invalid={!d} onChange={(e) => setTime(e.target.value)} />{!d && <span className="err">Like 4:16.8 or 1:04:16.8</span>}</label>
          <div className="seg" role="group" aria-label="Status">{(['FINISHED', 'DNF'] as const).map((x) => <button key={x} aria-pressed={status === x} onClick={() => setStatus(x)}>{x}</button>)}</div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {METRICS.map((m) => <label key={m.key} className="field">{m.label}<input className="secs" inputMode="numeric" value={counts[m.key]} placeholder="unknown" aria-invalid={bad.includes(m.label)} onChange={(e) => setCounts({ ...counts, [m.key]: e.target.value })} /></label>)}
        </div>
        <p className="small muted">Blank = unknown. Saving asks for an override (type OVERRIDE, a reason, then a 5 second wait).</p>
      </div>
    </Dialog>
  );
}
