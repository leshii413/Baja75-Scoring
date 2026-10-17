// Presets: three Rule, Penalty and Class Sheets; events record the sheets they use.
import { describe, expect, it } from 'vitest';
import { chooseEventSheets, choosePreset, copyIntoPreset, createDriver, createEvent, finalizeEvent, findOrCreateCourse, renamePresetAction, seedDataset, selectRun } from '../actions';
import { parseManualCsv } from '../csv';
import { runFromParsed } from '../importPlan';
import { activeRefs, eventSheets, presetsOf, refLabel, sheetOf } from '../presets';
import { entryKey, scoreEvent } from '../scoring';
import type { Dataset, Metric } from '../types';

const setSec = (ds: Dataset, scope: string, metric: Metric, seconds: number): Dataset =>
  ({ ...ds, rules: ds.rules.map((r) => (r.scope === scope && r.metric === metric ? { ...r, seconds } : r)) });

function race(ds: Dataset, name: string) {
  const c = findOrCreateCourse(ds, name, 'johnson_valley'); ds = c.ds;
  const e = createEvent(ds, { seasonId: ds.seasons[0].id, courseId: c.course.id, name }); ds = e.ds;
  return { ds, ev: e.event };
}

/** two drivers, 3 off-course each for A, none for B; B is 60 s slower */
function addResults(ds: Dataset, eventId: string) {
  const csv = ['driver,number,course,map,vehicle,status,time,date,off_course,wrong_way,speeding,missed_vcps,jump_starts,resets,recoveries,damage',
    'A,1,C,johnson_valley,Hirochi Aurata Race (CVT) (utv),FINISHED,10:00.0,,3,0,0,0,0,0,0,0',
    'B,2,C,johnson_valley,Hirochi Aurata Race (CVT) (utv),FINISHED,11:00.0,,0,0,0,0,0,0,0,0'].join('\n');
  const cls = ds.classes[0].id;
  ds = { ...ds, mappings: [...ds.mappings, { id: 'm-utv', matchType: 'model', matchValue: 'utv', classId: cls, scope: 'global' }] };
  for (const p of parseManualCsv(csv, 'x.csv').runs) {
    const d = createDriver(ds, { name: p.sourceDriver }); ds = d.ds;
    const run = runFromParsed(p, { batchId: 'b', source: 'manual', file: 'x.csv', driverId: d.driver.id, eventId, held: false, heldReason: '', now: new Date().toISOString() });
    ds = { ...ds, runs: [...ds.runs, run] };
    ds = selectRun(ds, entryKey(eventId, d.driver.id, cls), run.id);
  }
  return ds;
}

describe('presets', () => {
  it('a new dataset has three presets of each sheet, preset 1 active, all copies of the starting setup', () => {
    const ds = seedDataset('S');
    const p = presetsOf(ds);
    expect(ds.settings[0].presets).toBeDefined();
    expect(p.active).toEqual({ rules: 1, penalties: 1, classes: 1 });
    expect(p.rules.map((x) => x.name)).toEqual(['Preset 1', 'Preset 2', 'Preset 3']);
    expect(p.penalties[2].rules).toHaveLength(8);
    expect(p.classes[1].classes).toHaveLength(ds.classes.length);
  });

  it('switching stores the live setup in the old slot and loads the new one; switching back restores it', () => {
    let ds = seedDataset('S');
    ds = setSec(ds, 'template', 'offCourse', 30);           // edit preset 1 (live)
    ds = choosePreset(ds, 'penalties', 2, 'SCORE rules');
    expect(presetsOf(ds).active.penalties).toBe(2);
    expect(ds.rules.find((r) => r.scope === 'template' && r.metric === 'offCourse')!.seconds).toBe(0); // preset 2 untouched
    ds = setSec(ds, 'template', 'offCourse', 120);          // edit preset 2
    ds = choosePreset(ds, 'penalties', 1, '');
    expect(ds.rules.find((r) => r.scope === 'template' && r.metric === 'offCourse')!.seconds).toBe(30);
    expect(sheetOf(ds, 'penalties', 2).rules.find((r) => r.metric === 'offCourse')!.seconds).toBe(120);
    expect(ds.rules.filter((r) => r.scope === 'template')).toHaveLength(8);
    expect(ds.history.at(-1)?.type).toBe('preset-active');
  });

  it('rule sheets carry the points table, non-finish points and default format', () => {
    let ds = seedDataset('S');
    ds = choosePreset(ds, 'rules', 3, '');
    ds = { ...ds, settings: [{ ...ds.settings[0], points: { schedule: [10, 5], fallback: 0 }, defaultFormat: 'best' }] };
    const r = race(ds, 'Round 1'); ds = r.ds;
    expect(r.ev.format).toBe('best');
    expect(r.ev.sheets).toEqual({ rules: 3, penalties: 1 });
    ds = choosePreset(ds, 'rules', 1, '');
    expect(ds.settings[0].points.schedule[0]).toBe(30);
    expect(sheetOf(ds, 'rules', 3).points.schedule).toEqual([10, 5]);
  });

  it('a draft event is scored with its own Rule Sheet, even when another one is active', () => {
    let ds = seedDataset('S');
    ds = choosePreset(ds, 'rules', 2, '');
    ds = { ...ds, settings: [{ ...ds.settings[0], points: { schedule: [100, 50], fallback: 1 } }] };
    ds = choosePreset(ds, 'rules', 1, '');                 // preset 1 (30, 27, …) active again
    const r = race(ds, 'Round 1'); ds = r.ds;
    ds = addResults(ds, r.ev.id);
    expect(scoreEvent(ds, r.ev.id).all.map((l) => l.points).sort((a, b) => b - a)).toEqual([30, 27]);
    ds = chooseEventSheets(ds, r.ev.id, { rules: 2 }, 'This round uses the double-points sheet');
    expect(scoreEvent(ds, r.ev.id).all.map((l) => l.points).sort((a, b) => b - a)).toEqual([100, 50]);
  });

  it('picking a Penalty Sheet for an event copies its rules in, and the result changes', () => {
    let ds = seedDataset('S');
    ds = choosePreset(ds, 'penalties', 2, '');
    ds = setSec(ds, 'template', 'offCourse', 30);           // preset 2: 30 s per off course
    ds = choosePreset(ds, 'penalties', 1, '');               // preset 1 (0 s) active
    const r = race(ds, 'Round 1'); ds = r.ds;
    ds = addResults(ds, r.ev.id);
    let sc = scoreEvent(ds, r.ev.id);
    expect(sc.groups[0].results[0].selectedRun?.sourceDriver).toBe('A');
    ds = chooseEventSheets(ds, r.ev.id, { penalties: 2 }, 'SCORE penalties');
    sc = scoreEvent(ds, r.ev.id);
    // A: 10:00 + 90 s = 11:30, B: 11:00 → B wins
    expect(sc.groups[0].results.map((l) => [l.selectedRun?.sourceDriver, l.adjustedMs])).toEqual([['B', 660000], ['A', 690000]]);
    const info = eventSheets(ds, ds.events.find((e) => e.id === r.ev.id)!);
    expect(info.penalties?.slot).toBe(2);
    expect(info.penaltiesChanged).toBe(false);
    // a change to just this event's rules is shown as such
    ds = setSec(ds, r.ev.id, 'speeding', 5);
    expect(eventSheets(ds, ds.events.find((e) => e.id === r.ev.id)!).penaltiesChanged).toBe(true);
  });

  it('finalized results keep the sheets they were scored with', () => {
    let ds = seedDataset('S');
    ds = renamePresetAction(ds, 'rules', 1, 'Baja75 2026');
    const r = race(ds, 'Round 1'); ds = r.ds;
    ds = addResults(ds, r.ev.id);
    const f = finalizeEvent(ds, r.ev.id); expect(f.ok).toBe(true); if (!f.ok) return;
    ds = f.ds;
    ds = renamePresetAction(ds, 'rules', 1, 'Renamed later');
    ds = choosePreset(ds, 'classes', 2, '');
    const info = eventSheets(ds, ds.events.find((e) => e.id === r.ev.id)!);
    expect(info.frozen).toBe(true);
    expect(refLabel(info.rules)).toBe('Preset 1: Baja75 2026');
    expect(refLabel(info.classes)).toBe('Preset 1');
    expect(activeRefs(ds).classes.slot).toBe(2);
  });

  it('loading another Class Sheet never drops a class that results still use', () => {
    let ds = seedDataset('S');
    const r = race(ds, 'Round 1'); ds = r.ds;
    ds = addResults(ds, r.ev.id);
    const used = ds.classes[0];
    ds = choosePreset(ds, 'classes', 2, '');
    // make preset 2 a completely different class list
    ds = { ...ds, classes: [{ id: 'tt', label: 'Trophy Truck', order: 1 }], mappings: ds.mappings.filter((m) => m.scope !== 'global') };
    ds = choosePreset(ds, 'classes', 1, '');
    ds = choosePreset(ds, 'classes', 2, '');
    expect(ds.classes.map((c) => c.id)).toEqual(['tt', used.id]);
    expect(ds.mappings.filter((m) => m.scope === 'global')).toEqual([]);
    ds = choosePreset(ds, 'classes', 1, '');
    expect(ds.mappings.some((m) => m.id === 'm-utv')).toBe(true);
    expect(ds.classes.length).toBe(seedDataset('x').classes.length);
  });

  it('copy the active preset into another slot', () => {
    let ds = seedDataset('S');
    ds = setSec(ds, 'template', 'damageHits', 15);
    ds = copyIntoPreset(ds, 'penalties', 3, 'start SCORE sheet from Baja75');
    expect(sheetOf(ds, 'penalties', 3).rules.find((r) => r.metric === 'damageHits')!.seconds).toBe(15);
    expect(sheetOf(ds, 'penalties', 3).name).toBe('Preset 3');
    expect(sheetOf(ds, 'penalties', 2).rules.find((r) => r.metric === 'damageHits')!.seconds).toBe(0);
  });

  it('data from before presets gets them set up on first use (events count as preset 1)', () => {
    let ds = seedDataset('S');
    ds = { ...ds, settings: [{ ...ds.settings[0], presets: undefined }] };
    const c = findOrCreateCourse(ds, 'X', ''); ds = c.ds;
    const e = createEvent(ds, { seasonId: ds.seasons[0].id, courseId: c.course.id, name: 'Old' }); ds = e.ds;
    ds = { ...ds, events: ds.events.map((x) => ({ ...x, sheets: undefined })) };
    const info = eventSheets(ds, ds.events[0]);
    expect(info.rules?.slot).toBe(1);
    expect(info.penaltiesChanged).toBe(false);
  });
});
