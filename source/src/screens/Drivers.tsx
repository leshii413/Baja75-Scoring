import { useState } from 'react';
import { createDriver, deleteDriver, editDriver } from '../domain/actions';
import { classForRun } from '../domain/classes';
import type { Driver } from '../domain/types';
import { useStore } from '../store/store';
import { Dialog, Icon, useOverride, useToast } from '../ui/common';
import { NewDriverDialog } from './ImportData';
import { className } from './shared';

export function Drivers() {
  const { ds, commit } = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [q, setQ] = useState('');
  const [overrideNode, askOverride] = useOverride();
  const list = [...ds.drivers].filter((d) => !q || (d.name + ' ' + d.number + ' ' + d.team + ' ' + d.aliases.join(' ')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="page-head"><div><h1>Drivers</h1><p className="muted">Each driver keeps one id: change a name or number and their points stay with them. Drivers are never merged automatically.</p></div>
        <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" />New driver</button></div>
      <section className="panel">
        <input aria-label="Search drivers" placeholder="Search name, number, team…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10, width: '100%', maxWidth: 360 }} />
        {list.length ? <div className="table-wrap"><table className="cards">
          <thead><tr><th>Driver</th><th className="num">Number</th><th>Team</th><th>Also known as</th><th>Entries</th><th className="num">Runs</th><th></th></tr></thead>
          <tbody>{list.map((d) => {
            const runs = ds.runs.filter((r) => r.driverId === d.id);
            const entries = new Set(runs.filter((r) => r.eventId).map((r) => `${ds.events.find((e) => e.id === r.eventId)?.name ?? '?'} · ${className(ds, classForRun(r, ds.mappings).classId)}`));
            return (
              <tr key={d.id}><td data-l="Driver"><b>{d.name}</b><div className="small dim mono">{d.id.slice(0, 8)}</div></td><td data-l="Number" className="num">{d.number || '—'}</td><td data-l="Team">{d.team || '—'}</td>
                <td data-l="Also known as" className="small">{d.aliases.join(', ') || '—'}</td><td data-l="Entries" className="small">{[...entries].join(' · ') || '—'}</td><td data-l="Runs" className="num">{runs.length}</td>
                <td className="full"><button className="small" onClick={() => setEditing(d)}>Edit</button></td></tr>);
          })}</tbody>
        </table></div> : <div className="empty">No drivers yet.</div>}
      </section>
      <NewDriverDialog st={adding ? { name: '', number: '' } : null} onClose={() => setAdding(false)} onCreate={(name, number) => commit((d) => createDriver(d, { name, number }).ds).then((ok) => { if (ok) { setAdding(false); toast('Driver added'); } })} />
      {overrideNode}
      {editing && <EditDriver d={editing} onClose={() => setEditing(null)}
        onSave={(patch) => askOverride({ title: 'Change driver: ' + editing.name, what: [
          `Saves ${patch.name}${patch.number ? ' #' + patch.number : ''}${patch.team ? ' (' + patch.team + ')' : ''} on driver ${editing.name}${editing.number ? ' #' + editing.number : ''}.`,
          'Their runs, entries and points stay with them (same driver id). An old name is kept as an alias.'],
          then: (r) => commit((x) => editDriver(x, editing.id, patch, r)).then((ok) => { if (ok) { setEditing(null); toast('Driver changed'); } }) })}
        onDelete={() => {
          const runs = ds.runs.filter((r) => r.driverId === editing.id).length;
          const finals = ds.revisions.filter((v) => !v.superseded && v.snapshot.results.some((l) => l.driverId === editing.id)).length;
          askOverride({ title: 'Delete driver: ' + editing.name, danger: true, what: [
            `Removes ${editing.name} from the driver list.`,
            runs ? `Their ${runs} run(s) are kept but become unassigned (they stop scoring until given a driver).` : 'They have no runs.',
            'Their entries, DNS / DSQ marks and manual penalties are removed.',
            finals ? `${finals} finalized event(s) still list their result as "Removed driver" until those events are amended or reverted.` : 'No finalized results name them.'],
            then: (r) => commit((x) => deleteDriver(x, editing.id, r)).then((ok) => { if (ok) { setEditing(null); toast('Driver deleted'); } }) });
        }} />}
    </>
  );
}

function EditDriver({ d, onClose, onSave, onDelete }: { d: Driver; onClose: () => void; onSave: (p: Partial<Driver>) => void; onDelete: () => void }) {
  const [f, setF] = useState({ name: d.name, number: d.number, team: d.team, aliases: d.aliases.join(', ') });
  return (
    <Dialog open title={'Edit ' + d.name} onClose={onClose} foot={<><button className="danger" onClick={onDelete}><Icon name="lock" />Delete…</button><button onClick={onClose}>Cancel</button>
      <button className="primary" disabled={!f.name.trim()} onClick={() => onSave({ name: f.name.trim(), number: f.number.trim(), team: f.team.trim(), aliases: f.aliases.split(',').map((s) => s.trim()).filter(Boolean) })}>Save…</button></>}>
      <div className="stack">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Race number<input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        <label className="field">Team (optional)<input value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></label>
        <label className="field">Also known as (comma separated)<input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} /></label>
        <p className="small muted">Saving or deleting asks for an override (type OVERRIDE, a reason, then a 5 second wait).</p>
      </div>
    </Dialog>
  );
}
