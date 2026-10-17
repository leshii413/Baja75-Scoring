import { useEffect, useState } from 'react';
import { deleteSeason, history, renameSeason } from '../domain/actions';
import { makeBackup, mergeDatasets, previewMerge, validateBackup, type BackupFile, type MergePreview } from '../domain/backup';
import { manualTemplateCsv } from '../domain/csv';
import { uuid } from '../domain/ids';
import { checkPointsTable, DEFAULT_POINTS, pointsFor } from '../domain/scoring';
import { nowIso } from '../domain/time';
import type { Dataset, PointsTable } from '../domain/types';
import { askPersistent, storageStatus } from '../store/db';
import { useStore } from '../store/store';
import { activeSlot, refLabel, refOf } from '../domain/presets';
import { Dialog, download, Icon, readFileText, useOverride, useToast } from '../ui/common';
import { LogoSetting } from '../ui/Logo';

export const APP_VERSION = '1.1.0';
export const PATREON_URL = 'https://www.patreon.com/c/Baja75Series';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';

export function SettingsPage() {
  const { ds, commit, replace } = useStore();
  const toast = useToast();
  const s = ds.settings[0];
  const [pts, setPts] = useState(s.points.schedule.join(', '));
  const [fallback, setFallback] = useState(String(s.points.fallback));
  const [store, setStore] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  const [restore, setRestore] = useState<{ backup: BackupFile; preview: MergePreview; name: string } | null>(null);
  const [restoreErr, setRestoreErr] = useState<string[] | null>(null);
  const [season, setSeason] = useState('');
  const [overrideNode, askOverride] = useOverride();
  useEffect(() => { storageStatus().then(setStore); }, [ds]);

  const parsed: PointsTable | null = (() => {
    const parts = pts.split(/[,\s]+/).filter(Boolean);
    if (!parts.every((p) => /^\d{1,6}$/.test(p)) || !/^\d{1,6}$/.test(fallback.trim())) return null;
    return { schedule: parts.map(Number), fallback: Number(fallback) };
  })();
  const ptsErr = parsed ? checkPointsTable(parsed) : ['Whole numbers of 0 or more, separated by commas'];
  const backupNow = (label = '') => download(`Baja75_scoring_backup${label}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(makeBackup(ds, APP_VERSION), null, 1), 'application/json');

  return (
    <>
      <div className="page-head"><div><h1>Settings / Backup</h1><p className="muted">Baja75 Scoring Management System v{APP_VERSION}</p></div></div>
      <div className="grid two">
        <section className="panel">
          <h2>Race points</h2>
          <p className="small">Editing the active <b>Rule Sheet: {refLabel(refOf(ds, 'rules', activeSlot(ds, 'rules')))}</b> (<a href="#/presets">Presets</a>). Draft events on another Rule Sheet keep theirs.</p>
          <label className="field" style={{ marginBottom: 8 }}>New events start as<select value={s.defaultFormat ?? 'selected'} onChange={(e) => commit((d) => history({ ...d, settings: [{ ...d.settings[0], defaultFormat: e.target.value as 'selected' | 'best' }] }, 'default-format', 'settings', 'settings', d.settings[0].defaultFormat ?? 'selected', e.target.value, ''))}>
            <option value="selected">Selected attempt (an official picks the run)</option><option value="best">Best adjusted attempt (time trial)</option></select></label>
          <p className="small muted">Points for class positions 1, 2, 3… then the points every later finisher gets. Non-finishers (DNF, DNS, DSQ) get {s.nonfinishPoints}. Changing this recalculates draft results only; finalized events keep the table they were finalized with.</p>
          <label className="field">Positions 1, 2, 3…<input value={pts} onChange={(e) => setPts(e.target.value)} aria-invalid={ptsErr.length > 0} /></label>
          <label className="field" style={{ marginTop: 8 }}>Every later finisher<input className="secs" value={fallback} onChange={(e) => setFallback(e.target.value)} /></label>
          {ptsErr.length > 0 && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{ptsErr[0]}</p>}
          {parsed && !ptsErr.length && <p className="small muted">Check: 1st {pointsFor(1, parsed)} · 2nd {pointsFor(2, parsed)} · 3rd {pointsFor(3, parsed)} · 15th {pointsFor(15, parsed)} · 16th {pointsFor(16, parsed)} · 100th {pointsFor(100, parsed)}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={!parsed || ptsErr.length > 0} onClick={() => commit((d) => history({ ...d, settings: [{ ...d.settings[0], points: parsed! }] }, 'points-table', 'settings', 'settings', d.settings[0].points, parsed, '')).then((ok) => ok && toast('Points table saved'))}>Save points</button>
            <button onClick={() => { setPts(DEFAULT_POINTS.schedule.join(', ')); setFallback(String(DEFAULT_POINTS.fallback)); }}>Baja75 default</button>
          </div>
          <h3 style={{ marginTop: 16 }}>Policies (app defaults, review them against your rulebook)</h3>
          <ul className="small">
            <li><b>Ties in a race:</b> equal adjusted times share the position and its points (1, 1, 3). No hidden tie-breaker.</li>
            <li><b>Ties in the championship:</b> equal totals share the rank. Wins and podiums are shown, not used to break ties.</li>
            <li><b>Non-finishers:</b> DNF, DNS and DSQ score 0 points and no position.</li>
            <li><b>Official result:</b> new events use the selected-attempt format (an official picks the run); best adjusted attempt can be chosen per event.</li>
            <li><b>Penalty rates</b> start at 0 seconds until you set them.</li>
            <li><b>Overall Score</b> counts finalized events marked as counting, never practice or drafts.</li>
          </ul>
        </section>
        <section className="panel">
          <h2>Seasons</h2>
          <div className="stack" style={{ marginBottom: 10 }}>{ds.seasons.map((x) => {
            const evs = ds.events.filter((e) => e.seasonId === x.id);
            const runs = ds.runs.filter((r) => evs.some((e) => e.id === r.eventId)).length;
            return (
              <div key={x.id} className="season-row"><div><b>{x.name}</b>{x.id === s.selectedSeasonId && <span className="chip orange" style={{ marginLeft: 6 }}>SELECTED</span>}
                <div className="small muted">{evs.length} event{evs.length === 1 ? '' : 's'} · {runs} run{runs === 1 ? '' : 's'}</div></div>
                <span className="row" style={{ gap: 6 }}>
                  <button className="small" onClick={() => { const n = window.prompt('New name for ' + x.name, x.name); if (!n || !n.trim() || n.trim() === x.name) return; askOverride({ title: 'Rename season', what: [`Renames "${x.name}" to "${n.trim()}".`, 'Its events and results don\u2019t change.'], then: (r) => commit((d) => renameSeason(d, x.id, n, r)).then((ok) => ok && toast('Season renamed')) }); }}><Icon name="lock" />Rename…</button>
                  <button className="small danger" disabled={ds.seasons.length < 2} title={ds.seasons.length < 2 ? 'Add another season first: there must always be one' : undefined} onClick={() => askOverride({ title: 'Delete season: ' + x.name, danger: true, what: [
                    `Removes the season "${x.name}" and its ${evs.length} race event(s).`,
                    `Removes ${runs} imported run(s), their entries, penalties, finalized results and revisions with it.`,
                    'Drivers, classes, vehicle mappings and the penalty template stay.'],
                    then: (r) => commit((d) => deleteSeason(d, x.id, r)).then((ok) => ok && toast('Season deleted')) })}><Icon name="lock" />Delete…</button>
                </span></div>);
          })}</div>
          <div className="row"><input aria-label="New season name" placeholder="Baja75 Series 2027" value={season} onChange={(e) => setSeason(e.target.value)} />
            <button disabled={!season.trim()} onClick={() => { const n = { id: uuid(), name: season.trim(), createdAt: nowIso() }; commit((d) => history({ ...d, seasons: [...d.seasons, n], settings: [{ ...d.settings[0], selectedSeasonId: n.id }] }, 'create', 'season', n.id, null, n, '')).then((ok) => ok && setSeason('')); }}>Add season</button></div>
          <h2 style={{ marginTop: 18 }}>Backup &amp; restore</h2>
          <p className="small muted">One JSON file holds everything: drivers, classes, mappings, rules, imported runs, corrections, revisions and results. Use it to move your data between Windows and Android, or to keep a safe copy. Devices don't sync by themselves.</p>
          <div className="row">
            <button className="primary" onClick={() => backupNow()}><Icon name="down" />Download backup</button>
            <label className="btn"><Icon name="upload" />Restore from backup…<input type="file" hidden accept=".json,application/json" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
              let json: unknown; try { json = JSON.parse(await readFileText(f)); } catch { setRestoreErr(['That file is not valid JSON']); return; }
              const v = validateBackup(json);
              if (!v.ok) { setRestoreErr(v.errors); return; }
              setRestore({ backup: v.backup, preview: previewMerge(ds, v.backup.data), name: f.name });
            }} /></label>
          </div>
          {restoreErr && <div className="notice bad small" role="alert" style={{ marginTop: 10 }}><b>Backup not restored, nothing changed:</b><ul>{restoreErr.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <h2 style={{ marginTop: 18 }}>Manual entry template</h2>
          <p className="small muted">For results entered by hand (no run log): fill the CSV and import it in Import Data. Blank warning cells mean unknown; 0 means none. DNS / DSQ are set on the race page.</p>
          <button onClick={() => download('Baja75_manual_entries_template.csv', manualTemplateCsv())}><Icon name="down" />CSV template</button>
        </section>
        <section className="panel">
          <h2>Logo</h2>
          <LogoSetting />
          <h2 style={{ marginTop: 18 }}>This device</h2>
          <dl className="kv">
            <dt>Saved data</dt><dd>{ds.runs.length} runs · {ds.drivers.length} drivers · {ds.events.length} events · {ds.revisions.length} result revisions</dd>
            <dt>Storage</dt><dd>{store?.usage != null ? `${(store.usage / 1048576).toFixed(1)} MB used` : 'unknown'}{store?.quota ? ` of ${(store.quota / 1073741824).toFixed(1)} GB` : ''}</dd>
            <dt>Kept by the browser</dt><dd>{store?.persisted === true ? 'Yes (persistent)' : store?.persisted === false ? <>Can be cleared when space runs low. <button className="small" onClick={async () => { const ok = await askPersistent(); toast(ok ? 'Storage is now persistent' : 'The browser said no: install the app, or keep backups'); setStore(await storageStatus()); }}>Ask to keep it</button></> : 'unknown'}</dd>
            <dt>Works offline</dt><dd>{'serviceWorker' in navigator ? 'Yes, once installed or opened once online' : 'Not in this browser'}</dd>
          </dl>
          <h3 style={{ marginTop: 14 }}>Install</h3>
          <ul className="small">
            <li><b>Windows 11:</b> run <span className="mono">Start Baja75 Scoring.cmd</span> from the app folder (no install needed), then in Microsoft Edge choose <i>… › Apps › Install this site as an app</i> (or the install icon in the address bar). It then opens from the Start menu like a normal program.</li>
            <li><b>Android:</b> open the app's https:// address in Chrome, then <i>⋮ › Add to Home screen › Install</i>. A plain http:// address on your network can't be installed.</li>
            <li>Data stays in the browser on each device. Move it with Download backup / Restore.</li>
          </ul>
        </section>
        <section className="panel">
          <h2>Change history</h2>
          <p className="small muted">Scoring changes on this device, newest first. For review: a browser's local history is not tamper-proof.</p>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table><thead><tr><th>When</th><th>Change</th><th>Reason</th></tr></thead>
            <tbody>{[...ds.history].reverse().slice(0, 200).map((h) => <tr key={h.id}><td className="small">{new Date(h.at).toLocaleString()}</td><td className="small">{h.type.startsWith('override:') ? <><span className="chip bad">OVERRIDE</span> {h.type.slice(9)}</> : h.type} · {h.entity}</td><td className="small">{h.reason || '—'}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <section className="panel">
        <h2>License</h2>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer license" aria-label="Creative Commons BY-NC-SA 4.0 license">
            <img src="./cc-by-nc-sa.svg" alt="Creative Commons BY-NC-SA" width={120} height={42} style={{ display: 'block' }} />
          </a>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p><b>Baja75 Scoring Management System</b> © {new Date().getFullYear()}<br />Created by <b>Leshii413 | Baja75 Series</b><br />
              <a href={PATREON_URL} target="_blank" rel="noopener noreferrer">{PATREON_URL}</a></p>
            <p className="small">Licensed under the <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer license">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)</a>:
              you may share and adapt it for non-commercial use, giving credit to Leshii413 | Baja75 Series and sharing changes under the same license.</p>
          </div>
        </div>
      </section>
      {overrideNode}
      <RestoreDialog st={restore} onClose={() => setRestore(null)} onApply={async (mode) => {
        if (!restore) return;
        if (mode === 'replace') backupNow('_before-restore');
        const next: Dataset = mode === 'replace' ? restore.backup.data : mergeDatasets(ds, restore.backup.data, mode === 'merge-incoming' ? 'incoming' : 'keep');
        const ok = await replace(next);
        if (ok) { setRestore(null); setRestoreErr(null); toast(mode === 'replace' ? 'Backup restored' : 'Backup merged'); }
      }} />
    </>
  );
}

function RestoreDialog({ st, onClose, onApply }: { st: { backup: BackupFile; preview: MergePreview; name: string } | null; onClose: () => void; onApply: (m: 'replace' | 'merge-keep' | 'merge-incoming') => void }) {
  if (!st) return null;
  const p = st.preview; const d = st.backup.data;
  const added = Object.entries(p.added).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing new';
  return (
    <Dialog open title="Restore backup" onClose={onClose} foot={<>
      <button onClick={onClose}>Cancel</button>
      <button onClick={() => onApply('merge-keep')}>Merge (keep mine on conflicts)</button>
      {p.conflicts.length > 0 && <button onClick={() => onApply('merge-incoming')}>Merge (take backup's on conflicts)</button>}
      <button className="danger" onClick={() => onApply('replace')}>Replace everything</button></>}>
      <p className="small">{st.name}: saved {new Date(st.backup.exportedAt).toLocaleString()} · {d.runs.length} runs, {d.drivers.length} drivers, {d.events.length} events, {d.revisions.length} revisions. The file checked out.</p>
      <ul className="small"><li><b>Merge</b> adds {added}; {p.same} records are already identical here{p.conflicts.length ? `; ${p.conflicts.length} differ` : ''}.</li>
        <li><b>Replace everything</b> first downloads a backup of what's on this device now, then swaps it for the file.</li></ul>
      {p.conflicts.length > 0 && <details><summary className="small">Records that differ ({p.conflicts.length})</summary><ul className="small">{p.conflicts.slice(0, 40).map((c) => <li key={c.collection + c.id}>{c.collection}: {c.label}</li>)}</ul></details>}
      <p className="small muted">Restoring the same backup twice changes nothing: records are matched by their id, so no points are added twice.</p>
    </Dialog>
  );
}
