import { useState } from 'react';
import { choosePreset, copyIntoPreset, renamePresetAction } from '../domain/actions';
import { sortClasses } from '../domain/classes';
import { presetsOf, refLabel, sheetOf } from '../domain/presets';
import { METRICS, SHEET_LABEL, SHEET_SLOTS, type ClassSheet, type Dataset, type PenaltySheet, type RuleSheet, type SheetKind, type SheetSlot } from '../domain/types';
import { useStore } from '../store/store';
import { useReason, useToast } from '../ui/common';

const EDIT: Record<SheetKind, { href: string; where: string }> = {
  rules: { href: '#/settings', where: 'Settings / Backup › Race points' },
  penalties: { href: '#/penalties', where: 'Penalties › Default template' },
  classes: { href: '#/classes', where: 'Classes & Vehicles' },
};
const WHAT: Record<SheetKind, string> = {
  rules: 'Race points, points for non-finishers and the format new events start with.',
  penalties: 'Seconds per occurrence for each penalty. New events copy the active sheet; an event can also pick its own.',
  classes: 'Classes and the vehicle mappings that apply to every event. One Class Sheet applies to the whole season.',
};

export function Presets() {
  const { ds, commit } = useStore();
  const [reasonNode, askReason] = useReason();
  return (
    <>
      {reasonNode}
      <div className="page-head"><div><h1>Presets</h1>
        <p className="muted">Three presets each of the Rule Sheet, Penalty Sheet and Class Sheet. The active preset is the one you edit on its page; choosing
          another stores what you have and loads that one. Finalized results never change: they keep the sheets they were scored with.</p></div></div>
      {(['rules', 'penalties', 'classes'] as SheetKind[]).map((kind) => <KindPanel key={kind} kind={kind} ds={ds} commit={commit} askReason={askReason} />)}
    </>
  );
}

function KindPanel({ kind, ds, commit, askReason }: { kind: SheetKind; ds: Dataset; commit: ReturnType<typeof useStore>['commit']; askReason: ReturnType<typeof useReason>[1] }) {
  const toast = useToast();
  const p = presetsOf(ds);
  const active = p.active[kind];
  const drafts = ds.events.filter((e) => e.status !== 'finalized');
  const usedBy = (slot: SheetSlot) => kind === 'classes' ? [] : drafts.filter((e) => (e.sheets ?? { rules: 1, penalties: 1 })[kind] === slot);
  return (
    <section className="panel">
      <div className="panel-head"><h2>{SHEET_LABEL[kind]}s</h2><span className="small muted">{WHAT[kind]}</span></div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {SHEET_SLOTS.map((slot) => {
          const sheet = sheetOf(ds, kind, slot);
          const isActive = slot === active;
          const n = usedBy(slot).length;
          return (
            <div key={slot} className={'preset-card' + (isActive ? ' active' : '')}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>Preset {slot}</b>{isActive ? <span className="chip orange">ACTIVE</span> : <span className="chip">STORED</span>}
              </div>
              <NameField value={sheet.name} label={`Name of ${SHEET_LABEL[kind]} preset ${slot}`} onSave={(v) => commit((d) => renamePresetAction(d, kind, slot, v))} />
              <Summary kind={kind} sheet={sheet} />
              {kind !== 'classes' && <p className="small muted" style={{ margin: '6px 0' }}>{n ? `Used by ${n} draft event${n === 1 ? '' : 's'}` : 'No draft event uses it'}</p>}
              <div className="row" style={{ marginTop: 6 }}>
                {isActive
                  ? <a className="btn small" href={EDIT[kind].href}>Edit in {EDIT[kind].where}</a>
                  : <>
                    <button className="small" onClick={() => askReason(`Use ${SHEET_LABEL[kind]} preset ${slot}`,
                      kind === 'classes'
                        ? `The classes and all-event vehicle mappings become ${refLabel({ slot, name: sheet.name })}. Draft results re-sort into its classes; classes that results already use are kept. What is this for?`
                        : `${refLabel({ slot, name: sheet.name })} becomes the active ${SHEET_LABEL[kind]}: it's what you edit and what new events use. Existing events keep the sheet they were given. What is this for?`,
                      (why) => commit((d) => choosePreset(d, kind, slot, why)).then((ok) => ok && toast(`${SHEET_LABEL[kind]}: preset ${slot} is active`)))}>Make active</button>
                    <button className="small" onClick={() => askReason(`Overwrite preset ${slot}`, `Replaces ${refLabel({ slot, name: sheet.name })} with a copy of the active preset ${active}. Its name stays. Why?`,
                      (why) => commit((d) => copyIntoPreset(d, kind, slot, why)).then((ok) => ok && toast(`Preset ${slot} now copies preset ${active}`)))}>Copy active here</button>
                  </>}
              </div>
            </div>);
        })}
      </div>
    </section>
  );
}

function NameField({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [t, setT] = useState(value);
  const [focus, setFocus] = useState(false);
  const shown = focus ? t : value;
  return <input aria-label={label} value={shown} style={{ width: '100%', margin: '6px 0' }} onFocus={() => { setT(value); setFocus(true); }}
    onChange={(e) => setT(e.target.value)} onBlur={() => { setFocus(false); if (t.trim() !== value) onSave(t); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function Summary({ kind, sheet }: { kind: SheetKind; sheet: RuleSheet | PenaltySheet | ClassSheet }) {
  if (kind === 'rules') {
    const r = sheet as RuleSheet;
    const top = r.points.schedule.slice(0, 5).join(', ') + (r.points.schedule.length > 5 ? ', …' : '');
    return <dl className="kv small"><dt>Points</dt><dd className="num">{top}</dd><dt>Positions</dt><dd>{r.points.schedule.length}, then {r.points.fallback} each</dd>
      <dt>Non-finish</dt><dd>{r.nonfinishPoints} pts</dd><dt>New events</dt><dd>{r.defaultFormat === 'best' ? 'Best adjusted attempt' : 'Selected attempt'}</dd></dl>;
  }
  if (kind === 'penalties') {
    const rules = (sheet as PenaltySheet).rules;
    const on = rules.filter((r) => r.enabled);
    const unset = on.filter((r) => r.seconds === null).length;
    return <ul className="small preset-list">{METRICS.map((m) => {
      const rs = on.filter((r) => r.metric === m.key);
      const txt = rs.length ? rs.map((r) => (r.seconds === null ? 'unset' : r.seconds + ' s')).join(' + ') : 'off';
      return <li key={m.key}><span>{m.label}</span><b className="num">{txt}</b></li>;
    })}{unset > 0 && <li style={{ color: 'var(--warn)' }}>{unset} rule(s) without seconds</li>}</ul>;
  }
  const c = sheet as ClassSheet;
  const names = sortClasses(c.classes).map((x) => x.label);
  return <dl className="kv small"><dt>Classes</dt><dd>{c.classes.length}: {names.slice(0, 6).join(', ')}{names.length > 6 ? ', …' : ''}</dd>
    <dt>Vehicles</dt><dd>{c.mappings.length} mapping{c.mappings.length === 1 ? '' : 's'}</dd></dl>;
}
