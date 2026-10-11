import { useState } from 'react';
import { history } from '../domain/actions';
import { classForRun, mappingConflicts, sortClasses } from '../domain/classes';
import { uuid } from '../domain/ids';
import type { MatchType, VehicleMapping } from '../domain/types';
import { useStore } from '../store/store';
import { useToast } from '../ui/common';
import { className } from './shared';

export function Classes() {
  const { ds, commit } = useStore();
  const toast = useToast();
  const [f, setF] = useState<{ type: MatchType; value: string; cls: string; scope: string }>({ type: 'model', value: '', cls: '', scope: 'global' });
  const classes = sortClasses(ds.classes);
  const conflicts = mappingConflicts(ds.mappings);
  const scopeName = (s: string) => (s === 'global' ? 'All events' : 'Only ' + (ds.events.find((e) => e.id === s)?.name ?? 'a deleted event'));
  // vehicles seen in imports
  const seen = new Map<string, { vehicle: string; config: string; model: string | null; n: number; cls: string | null; how: string }>();
  for (const r of ds.runs) {
    const k = r.vehicle;
    const a = classForRun(r, ds.mappings);
    const e = seen.get(k) ?? { vehicle: r.vehicle, config: r.configText, model: r.modelId, n: 0, cls: a.classId, how: a.how };
    e.n++; seen.set(k, e);
  }
  const unassigned = [...seen.values()].filter((v) => !v.cls);
  const add = (m: Omit<VehicleMapping, 'id'>) => {
    const dup = ds.mappings.find((x) => x.scope === m.scope && x.matchType === m.matchType && x.matchValue === m.matchValue);
    if (dup && dup.classId === m.classId) { toast('That mapping already exists'); return; }
    const rec = { ...m, id: uuid() };
    commit((d) => history({ ...d, mappings: [...d.mappings, rec] }, 'mapping', 'mapping', rec.id, null, rec, '')).then((ok) => ok && toast(dup ? 'Added: it conflicts with an existing mapping, resolve it below' : `${m.matchValue} → ${className(ds, m.classId)}`));
  };
  return (
    <>
      <div className="page-head"><div><h1>Classes &amp; Vehicles</h1><p className="muted">A run is in a class only when its vehicle is mapped here (or set by hand on the race page). Nothing is guessed from a vehicle's name or type.</p></div></div>
      {conflicts.length > 0 && <div className="notice bad"><b>Conflicting mappings</b>: runs matching these stay unassigned until one is removed.<ul>{conflicts.map((c) => <li key={c.key}>{c.mappings[0].matchType === 'model' ? 'Model' : 'Configuration'} “{c.mappings[0].matchValue}” ({scopeName(c.mappings[0].scope)}) → {c.mappings.map((m) => className(ds, m.classId)).join(' / ')}</li>)}</ul></div>}
      {unassigned.length > 0 && (
        <section className="panel" style={{ borderColor: '#6a5220' }}>
          <div className="panel-head"><h2>Unassigned vehicles</h2><span className="chip warn">{unassigned.length} NOT IN A CLASS</span></div>
          <div className="table-wrap"><table className="cards"><thead><tr><th>Vehicle as imported</th><th>Model ID</th><th className="num">Runs</th><th>Map the model</th><th>Map this exact configuration</th></tr></thead>
            <tbody>{unassigned.map((v) => (
              <tr key={v.vehicle}><td data-l="Vehicle">{v.vehicle || '(none)'}{v.how === 'conflict' && <span className="chip bad" style={{ marginLeft: 6 }}>CONFLICT</span>}</td><td data-l="Model" className="mono">{v.model ?? '—'}</td><td data-l="Runs" className="num">{v.n}</td>
                <td data-l="Model →">{v.model ? <ClassPick label={`Class for model ${v.model}`} onPick={(c) => add({ matchType: 'model', matchValue: v.model!, classId: c, scope: 'global' })} /> : '—'}</td>
                <td data-l="Config →"><ClassPick label={`Class for ${v.config}`} onPick={(c) => add({ matchType: 'config', matchValue: v.config, classId: c, scope: 'global' })} /></td></tr>))}</tbody></table></div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head"><h2>Add a mapping</h2></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field">Match<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as MatchType })}><option value="model">Model ID (e.g. utv)</option><option value="config">Exact configuration (as shown)</option></select></label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>Value
            <input list="seen-vehicles" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={f.type === 'model' ? 'utv' : 'Hirochi Aurata Race (CVT)'} />
            <datalist id="seen-vehicles">{[...new Set([...seen.values()].map((v) => (f.type === 'model' ? v.model ?? '' : v.config)).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="field">Class<select value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })}><option value="">Pick…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="field">Applies to<select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="global">All events (template)</option>{ds.events.map((e) => <option key={e.id} value={e.id}>Only {e.name}</option>)}</select></label>
          <button className="primary" disabled={!f.value.trim() || !f.cls} onClick={() => { add({ matchType: f.type, matchValue: f.value.trim(), classId: f.cls, scope: f.scope }); setF({ ...f, value: '' }); }}>Add</button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Order of precedence: set by hand on a run › this event's configuration › this event's model › template configuration › template model.</p>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Classes</h2></div>
        {classes.map((c) => {
          const ms = ds.mappings.filter((m) => m.classId === c.id);
          return (
            <div key={c.id} className="class-block">
              <div className="class-title"><h3>{c.label}</h3><span className="muted small">{ms.length} mapping{ms.length === 1 ? '' : 's'}</span></div>
              {ms.length ? <div className="table-wrap"><table className="cards"><tbody>{ms.map((m) => (
                <tr key={m.id}><td data-l="Match">{m.matchType === 'model' ? 'Model' : 'Configuration'}</td><td data-l="Value" className={m.matchType === 'model' ? 'mono' : ''}>{m.matchValue}</td><td data-l="Applies to" className="small">{scopeName(m.scope)}</td>
                  <td className="full"><button className="small ghost" onClick={() => commit((d) => history({ ...d, mappings: d.mappings.filter((x) => x.id !== m.id) }, 'mapping-removed', 'mapping', m.id, m, null, ''))}>Remove</button></td></tr>))}</tbody></table></div>
                : <p className="small muted">No vehicles mapped.</p>}
            </div>
          );
        })}
      </section>
    </>
  );
}

function ClassPick({ onPick, label }: { onPick: (classId: string) => void; label: string }) {
  const { ds } = useStore();
  return <select aria-label={label} value="" onChange={(e) => e.target.value && onPick(e.target.value)}><option value="">Class…</option>{sortClasses(ds.classes).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>;
}
