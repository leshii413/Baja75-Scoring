import { useState } from 'react';
import { history } from '../domain/actions';
import { uuid } from '../domain/ids';
import { copyRulesForEvent } from '../domain/penalties';
import { activeSlot, eventSheets, refLabel, refOf } from '../domain/presets';
import { scoreEvent, sortResults } from '../domain/scoring';
import { formatMs } from '../domain/time';
import { METRICS, type Dataset, type Metric, type PenaltyRule } from '../domain/types';
import { useStore } from '../store/store';
import { SecondsInput, StatusChip, useReason } from '../ui/common';
import { driverLabel, seasonEvents } from './shared';

export function Penalties({ seasonId }: { seasonId: string }) {
  const { ds, commit } = useStore();
  const [reasonNode, askReason] = useReason();
  const events = seasonEvents(ds, seasonId);
  const [scope, setScope] = useState<string>(events.find((e) => e.status !== 'finalized')?.id ?? 'template');
  const ev = ds.events.find((e) => e.id === scope);
  const locked = !!ev && ev.status === 'finalized';
  const rules = ds.rules.filter((r) => r.scope === scope);
  const save = (r: PenaltyRule, patch: Partial<PenaltyRule>, why = '') => commit((d) => history({ ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }, 'rule', 'rule', r.id, r, { ...r, ...patch }, why));
  const [addMetric, setAddMetric] = useState<Metric>('offCourse');

  return (
    <>
      {reasonNode}
      <div className="page-head"><div><h1>Penalties</h1><p className="muted">Seconds added per occurrence of each counter in the run log: any whole number from 0 to 9999. Start at 0 and set what your rulebook says.</p></div></div>
      <div className="notice info small">The rates start at <b>0</b>: they are not official Baja75 amounts. <b>Time off course</b> is shown for review only and is never charged on top of the Off course count. One damage hit is one incident however many parts it broke.</div>
      <section className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field" style={{ minWidth: 260 }}>Rule set
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="template">Default template (copied into each new event)</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status === 'finalized' ? ' (finalized: locked)' : e.status === 'amending' ? ' (amending)' : ''}</option>)}
            </select>
          </label>
          {ev && !locked && <button onClick={() => askReason('Copy the template into this event', 'This replaces this event’s rules with the default template. Why?', (why) => commit((d) => history({ ...d, rules: [...d.rules.filter((r) => r.scope !== ev.id), ...copyRulesForEvent(d.rules.filter((r) => r.scope === 'template'), ev.id)] }, 'rules-reset', 'event', ev.id, null, 'template', why)))}>Reset from template</button>}
        </div>
        {locked && <div className="notice small">This event is finalized: its rules are frozen with its results. Start an amendment on the race page to change them.</div>}
        {scope === 'template' && <p className="small muted">The default template is the active <b>Penalty Sheet: {refLabel(refOf(ds, 'penalties', activeSlot(ds, 'penalties')))}</b> (<a href="#/presets">Presets</a>). Changing it affects events created afterwards. Existing events keep their own rules (use Reset from template on one to copy these in, or pick a Penalty Sheet in the race's Event settings).</p>}
        {ev && <p className="small muted">This event uses <b>Penalty Sheet: {refLabel(eventSheets(ds, ev).penalties)}</b>{eventSheets(ds, ev).penaltiesChanged ? ', with changes made for this event' : ''}.</p>}
        <div className="table-wrap"><table className="cards">
          <thead><tr><th>On</th><th>Penalty</th><th>Reason / justification</th><th>Counter</th><th>Seconds each</th><th></th></tr></thead>
          <tbody>{rules.map((r) => {
            const dup = rules.filter((x) => x.metric === r.metric && x.enabled).length > 1;
            return (
              <tr key={r.id}>
                <td data-l="On"><label className="check"><input type="checkbox" checked={r.enabled} disabled={locked} onChange={(e) => save(r, { enabled: e.target.checked })} /><span className="sr">Enabled</span></label></td>
                <td data-l="Penalty"><TextCell value={r.name} disabled={locked} label="Penalty name" onSave={(v) => save(r, { name: v })} /></td>
                <td data-l="Reason"><TextCell value={r.reason} disabled={locked} label="Reason" onSave={(v) => save(r, { reason: v })} wide /></td>
                <td data-l="Counter" className="small">{METRICS.find((m) => m.key === r.metric)?.label}{dup && <div><label className="check small"><input type="checkbox" checked={r.stackingConfirmed} disabled={locked} onChange={(e) => save(r, { stackingConfirmed: e.target.checked })} />Stacking intended</label></div>}</td>
                <td data-l="Seconds each"><SecondsInput value={r.seconds} disabled={locked} label={`Seconds per occurrence for ${r.name}`} onCommit={(v) => save(r, { seconds: v })} /></td>
                <td className="full">{!METRICS.some((m) => `tpl-${m.key}` === r.id) && !locked && rules.filter((x) => x.metric === r.metric).length > 1 &&
                  <button className="small ghost" onClick={() => askReason('Remove rule', 'Why is this rule removed?', (why) => commit((d) => history({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }, 'rule-removed', 'rule', r.id, r, null, why)))}>Remove</button>}</td>
              </tr>);
          })}</tbody>
        </table></div>
        {!locked && <div className="row" style={{ marginTop: 10 }}>
          <select aria-label="Counter for a new rule" value={addMetric} onChange={(e) => setAddMetric(e.target.value as Metric)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          <button className="small" onClick={() => { const m = METRICS.find((x) => x.key === addMetric)!; const r: PenaltyRule = { id: uuid(), metric: addMetric, name: m.rule + ' (extra)', reason: m.reason, seconds: 0, enabled: true, scope, stackingConfirmed: false }; commit((d) => history({ ...d, rules: [...d.rules, r] }, 'rule-added', 'rule', r.id, null, r, '')); }}>Add another rule for this counter</button>
          <span className="small muted">Two rules on one counter only count once you tick "Stacking intended" on both.</span>
        </div>}
      </section>
      {ev && <Preview ds={ds} eventId={ev.id} />}
      <p className="small muted">Manual penalties for one driver are added on the race page: open the driver's row › Details › Add a manual penalty.</p>
    </>
  );
}

function TextCell({ value, onSave, disabled, label, wide }: { value: string; onSave: (v: string) => void; disabled?: boolean; label: string; wide?: boolean }) {
  const [t, setT] = useState(value);
  const [k, setK] = useState(value);
  if (k !== value) { setK(value); setT(value); }
  const blank = !t.trim();
  return (
    <span>
      <input aria-label={label} value={t} disabled={disabled} aria-invalid={blank} style={{ width: wide ? '100%' : undefined, minWidth: wide ? 220 : 160 }}
        onChange={(e) => setT(e.target.value)} onBlur={() => { if (!blank && t.trim() !== value) onSave(t.trim()); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {blank && <span className="small" role="alert" style={{ color: 'var(--bad)', display: 'block' }}>Can't be blank</span>}
    </span>
  );
}

function Preview({ ds, eventId }: { ds: Dataset; eventId: string }) {
  const sc = scoreEvent(ds, eventId);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Live preview · {sc.event.name}</h2><span className="muted small">Draft results with these rates</span></div>
      {sc.all.length ? sc.groups.map((g) => (
        <div key={g.classId} className="class-block">
          <div className="class-title"><h3>{g.label}</h3></div>
          <div className="table-wrap"><table className="cards"><thead><tr><th className="num">Pos</th><th>Driver</th><th className="num">Raw</th><th className="num">Penalty</th><th className="num">Adjusted</th><th>Status</th><th className="num">Points</th></tr></thead>
            <tbody>{sortResults(g.results, ds).map((r) => (
              <tr key={r.entryId}><td data-l="Pos" className="num rank">{r.classRank ?? '—'}{r.tied && <span className="tie">TIE</span>}</td><td data-l="Driver">{driverLabel(ds, r.driverId)}</td>
                <td data-l="Raw" className="num">{r.status === 'FINISHED' ? formatMs(r.rawMs) : '—'}</td><td data-l="Penalty" className="num">{formatMs(r.penaltyMs, { plus: true })}</td><td data-l="Adjusted" className="num"><b>{formatMs(r.adjustedMs)}</b></td>
                <td data-l="Status"><StatusChip status={r.status} pending={!r.selectedRun && !r.entry.statusOverride} /></td><td data-l="Points" className="num pts">{r.points}</td></tr>))}</tbody></table></div>
        </div>
      )) : <div className="empty">No entries in this event yet.</div>}
      {sc.noClass.length > 0 && <p className="small muted">{sc.noClass.length} run(s) not in a class yet: map their vehicles in Classes &amp; Vehicles.</p>}
    </section>
  );
}
