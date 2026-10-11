import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDriver, createEvent, finalizeEvent, findOrCreateCourse, seedDataset, selectRun, setEntryStatus, startAmendment } from '../actions';
import { makeBackup, mergeDatasets, previewMerge, validateBackup } from '../backup';
import { classForRun, SEED_CLASSES } from '../classes';
import { csvCell, parseCsv, parseManualCsv, manualTemplateCsv, toCsv } from '../csv';
import { championshipCsv, penaltiesCsv, resultsCsv } from '../exports';
import { planRows, runFromParsed } from '../importPlan';
import { parseRaceLog } from '../parseLog';
import { parseTimesJson } from '../parseTimesJson';
import { checkSeconds, computePenalties } from '../penalties';
import { championship, competitionRanks, currentRevision, entryKey, pointsFor, scoreEvent } from '../scoring';
import { formatMs, parseDuration, parseTimestamp } from '../time';
import type { Dataset, Metric, Run, VehicleMapping } from '../types';

const FIXTURE = readFileSync(new URL('../../../fixtures/race_log_screenshot.txt', import.meta.url), 'utf8');
const V315 = readFileSync(new URL('../../../fixtures/race_log_v315.txt', import.meta.url), 'utf8');

// ---------------------------------------------------------------- helpers: build a season the way the app does
function setup() {
  let ds = seedDataset('Test Season');
  const season = ds.seasons[0];
  const c = findOrCreateCourse(ds, 'route 20261007 082741', 'johnson_valley'); ds = c.ds;
  const e = createEvent(ds, { seasonId: season.id, courseId: c.course.id, name: 'Round 1', round: 1 }); ds = e.ds;
  return { ds, season, course: c.course, event: e.event };
}
function addRun(ds: Dataset, o: { driverId: string; eventId: string; ms: number; vehicle?: string; status?: 'FINISHED' | 'DNF'; counters?: Partial<Record<Metric, number | null>>; text?: string }): { ds: Dataset; run: Run } {
  const vehicle = o.vehicle ?? 'Hirochi Aurata Race (CVT) (utv)';
  const t = formatMs(o.ms);
  const text = o.text ?? `2026-10-07 08:00:00 UTC+08:00 | Map: johnson_valley | Course: route 20261007 082741 | Time: ${o.status === 'DNF' ? 'DNF after ' : ''}${t} | Vehicle: ${vehicle} | Off course: 0 | Wrong way: 0 | Speeding: 0 | Missed VCPs: 0 | Jump starts: 0 | Resets: 0 | Recoveries: 0 | Time off course: 0:00.0 | Damage: 0 | Run ID: ${Math.random()}`;
  const p = parseRaceLog(text).runs[0];
  const run = runFromParsed(p, { batchId: 'b', source: 'log', file: 'x.txt', driverId: o.driverId, eventId: o.eventId, held: false, heldReason: '', now: new Date().toISOString() });
  if (o.counters) for (const [k, v] of Object.entries(o.counters)) run.counters[k as Metric] = v as number | null;
  return { ds: { ...ds, runs: [...ds.runs, run] }, run };
}
function map(ds: Dataset, value: string, classId: string, matchType: 'model' | 'config' = 'model', scope = 'global'): Dataset {
  return { ...ds, mappings: [...ds.mappings, { id: Math.random().toString(36), matchType, matchValue: value, classId, scope }] };
}
function setRule(ds: Dataset, eventId: string, metric: Metric, seconds: number | null): Dataset {
  return { ...ds, rules: ds.rules.map((r) => (r.scope === eventId && r.metric === metric ? { ...r, seconds } : r)) };
}

describe('time', () => {
  it('11. durations parse with the right units', () => {
    expect(parseDuration('4:16.8')).toEqual({ ms: 256800, precisionMs: 100 });
    expect(parseDuration('1:04:16.8')!.ms).toBe(3856800);
    expect(parseDuration('0:09.9')!.ms).toBe(9900);
    expect(parseDuration('4:16.812')!.ms).toBe(256812);
    expect(parseDuration('4:16.8')!.ms).not.toBe(4.168 * 60000);
    expect(parseDuration('4:61.0')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1e3')).toBeNull();
    expect(formatMs(256800)).toBe('4:16.8');
    expect(formatMs(3856800)).toBe('1:04:16.8');
    expect(formatMs(256812)).toBe('4:16.812');
  });
  it('JSON seconds are seconds', () => {
    const r = parseTimesJson(readFileSync(new URL('../../../fixtures/times_example.json', import.meta.url), 'utf8'), 'route_20261007_082741.json', 'johnson_valley');
    expect(r.runs).toHaveLength(1); // "best" is a summary, not another run
    expect(r.runs[0].elapsedMs).toBe(256812);
    expect(r.runs[0].courseName).toBe('route 20261007 082741');
    expect(r.runs[0].counters.offCourse).toBeNull();
    expect(r.runs[0].counters.missedVcps).toBe(0);
    expect(r.runs[0].utcIso).toBeNull(); // no time zone in that file: never guessed
  });
  it('timestamps convert to UTC with the offset', () => {
    expect(parseTimestamp('2026-10-07 08:38:06 UTC+08:00 (Malay Peninsula Standard Time)')).toMatchObject({ utcIso: '2026-10-07T00:38:06Z', offsetMinutes: 480, zoneName: 'Malay Peninsula Standard Time' });
    expect(parseTimestamp('2026-10-07 20:00:00 UTC-05:30')!.utcIso).toBe('2026-10-08T01:30:00Z');
  });
});

describe('run log parser', () => {
  it('1. the screenshot fixture: 256800 ms, exact course name, model id, counters, offset, details', () => {
    const { runs, rejected } = parseRaceLog(FIXTURE);
    expect(rejected).toHaveLength(0);
    expect(runs).toHaveLength(2);
    const r = runs[0];
    expect(r.courseName).toBe('route 20261007 082741');
    expect(r.map).toBe('johnson_valley');
    expect(r.vehicle).toBe('Hirochi Aurata Race (CVT) (utv)');
    expect(r.modelId).toBe('utv');
    expect(r.status).toBe('FINISHED');
    expect(r.elapsedMs).toBe(256800);
    expect(r.counters).toEqual({ offCourse: 4, wrongWay: 4, speeding: 5, missedVcps: 0, jumpStarts: 0, resets: 0, recoveries: 2, damageHits: 1 });
    expect(r.timeOffCourseMs).toBe(11300);
    expect(r.utcIso).toBe('2026-10-07T00:38:06Z');
    expect(r.offsetMinutes).toBe(480);
    expect(r.segments.map((s) => s.offForMs)).toEqual([2100, 5000, 2500, 1400]);
    expect(r.segments[1].atMs).toBe(108500);
    expect(r.damage).toHaveLength(1);
    expect(r.damage[0].parts).toContain('Right Door 100%');
    expect(r.issues.join(' ')).toMatch(/11\.0 s.*11\.3 s/); // details 11.0 vs reported 11.3: both kept, noted
  });
  it('2. the DNF fixture: 9900 ms before stopping', () => {
    const r = parseRaceLog(FIXTURE).runs[1];
    expect(r.status).toBe('DNF');
    expect(r.elapsedMs).toBe(9900);
  });
  it('9. BOM, CRLF, reordered and unknown fields, orphan and malformed lines', () => {
    const text = '﻿  Off course 1 | At: 0:01.0\r\n' +
      'garbage line without fields\r\n' +
      '2026-10-07 08:38:06 UTC+08:00 | Vehicle: Gavril D-Series (pickup) | Time: 1:00.0 | Course: Loop | Map: utah | Future field: 42 | Resets: 1\r\n' +
      '  Weird detail | x: 1\r\n\r\n' +
      '2026-10-07 08:39:06 UTC+08:00 | Map: utah | Time: 1:00.0\r\n' +
      '  Off course 1 | At: 0:05.0 | RM: 0.10 mi | Off for: 0:01.0 | Resets: 0 | Recoveries: 0\r\n';
    const { runs, rejected } = parseRaceLog(text);
    expect(runs).toHaveLength(1);
    expect(runs[0].courseName).toBe('Loop');
    expect(runs[0].unknownFields['Future field']).toBe('42');
    expect(runs[0].counters.resets).toBe(1);
    expect(runs[0].counters.offCourse).toBeNull(); // missing = unknown, not 0
    expect(runs[0].unknownDetails).toEqual(['Weird detail | x: 1']);
    expect(rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/no run line above/), expect.stringMatching(/Not a run line/), expect.stringMatching(/No course/)]);
    // the off-course line under the rejected run stays with it, not attached to the run before
    expect(rejected[2].text).toContain('Off course 1');
    expect(runs[0].segments).toHaveLength(0);
  });
  it('10. truncated detail lists keep the summary count and the note', () => {
    const t = '2026-10-07 08:38:06 UTC+08:00 | Map: m | Course: c | Time: 9:00.0 | Vehicle: v (x) | Off course: 60 | Time off course: 1:00.0\n' +
      Array.from({ length: 50 }, (_, i) => `  Off course ${i + 1} | At: 0:01.0 | RM: 0.10 mi | Off for: 0:01.0 | Resets: 0 | Recoveries: 0`).join('\n') +
      '\n  ... 10 more off-course moments\n';
    const r = parseRaceLog(t).runs[0];
    expect(r.counters.offCourse).toBe(60);
    expect(r.segments).toHaveLength(50);
    expect(r.truncation).toEqual(['... 10 more off-course moments']);
    expect(r.issues.join(' ')).not.toMatch(/add up/);
  });
  it('v3.1.5 fields: exact ms, driver, number, run id', () => {
    const r = parseRaceLog(V315).runs[0];
    expect(r.elapsedMs).toBe(256812);
    expect(r.precisionMs).toBe(1);
    expect(r.sourceDriver).toBe('Leshii413');
    expect(r.sourceNumber).toBe('413');
    expect(r.sourceRunId).toBe('6a1f3c2b9e04d1');
    expect(r.vcpsCleared).toBe(8); expect(r.vcpsTotal).toBe(8);
    expect(Object.keys(r.unknownFields)).toEqual([]);
    const bad = parseRaceLog(V315.replace('Time ms: 256812', 'Time ms: 999999')).runs[0];
    expect(bad.elapsedMs).toBe(256800); // a Time ms that disagrees with the shown time is not used
  });
});

describe('penalties', () => {
  it('5. seconds per occurrence: 0..9999 whole numbers only', () => {
    for (const ok of [0, 9999, '0', '9999', ' 15 ']) expect(checkSeconds(ok)).toMatchObject({ ok: true });
    expect(checkSeconds('')).toEqual({ ok: true, value: null }); // blank = unset, not zero
    for (const bad of [-1, '-1', 10000, '10000', 1.5, '1.5', '1e3', 'NaN', NaN, Infinity, '+5', '0x10', 'abc', '١٢']) expect(checkSeconds(bad).ok).toBe(false);
  });
  it('3 + 4. the illustrative example: 195 s -> 7:31.8; off course to 0 -> 135 s -> 6:31.8', () => {
    let { ds, event } = setup();
    const d = createDriver(ds, { name: 'A', number: '1' }); ds = d.ds;
    const p = parseRaceLog(FIXTURE).runs[0];
    const run = runFromParsed(p, { batchId: 'b', source: 'log', file: 'f', driverId: d.driver.id, eventId: event.id, held: false, heldReason: '', now: 'x' });
    ds = { ...ds, runs: [run] };
    ds = map(ds, 'utv', 'c-1');
    ds = setRule(ds, event.id, 'offCourse', 15); ds = setRule(ds, event.id, 'wrongWay', 10); ds = setRule(ds, event.id, 'speeding', 5);
    ds = setRule(ds, event.id, 'recoveries', 30); ds = setRule(ds, event.id, 'damageHits', 10);
    ds = selectRun(ds, entryKey(event.id, d.driver.id, 'c-1'), run.id);
    let r = scoreEvent(ds, event.id).all[0];
    expect(r.penaltyMs).toBe(195000);
    expect(formatMs(r.penaltyMs)).toBe('3:15.0');
    expect(r.adjustedMs).toBe(451800);
    expect(formatMs(r.adjustedMs)).toBe('7:31.8');
    // 6. idempotent: scoring twice gives the same, details never charged on top of the count
    expect(scoreEvent(ds, event.id).all[0].penaltyMs).toBe(195000);
    ds = setRule(ds, event.id, 'offCourse', 0);
    r = scoreEvent(ds, event.id).all[0];
    expect(r.penaltyMs).toBe(135000);
    expect(formatMs(r.adjustedMs)).toBe('6:31.8');
  });
  it('7. one damage hit with five parts is one incident', () => {
    const run = runFromParsed(parseRaceLog(FIXTURE).runs[0], { batchId: 'b', source: 'log', file: 'f', driverId: 'd', eventId: 'e', held: false, heldReason: '', now: 'x' });
    const res = computePenalties(run, [{ id: 'r', metric: 'damageHits', name: 'Damage incident', reason: 'x', seconds: 10, enabled: true, scope: 'e', stackingConfirmed: false }], [], []);
    expect(res.totalMs).toBe(10000);
  });
  it('8. a missing counter blocks only rules that charge it', () => {
    const run = runFromParsed(parseRaceLog(FIXTURE).runs[0], { batchId: 'b', source: 'log', file: 'f', driverId: 'd', eventId: 'e', held: false, heldReason: '', now: 'x' });
    run.counters.damageHits = null;
    const rule = (seconds: number | null, enabled = true) => [{ id: 'r', metric: 'damageHits' as Metric, name: 'Damage incident', reason: 'x', seconds, enabled, scope: 'e', stackingConfirmed: false }];
    expect(computePenalties(run, rule(0), [], []).blockers).toEqual([]);
    expect(computePenalties(run, rule(10, false), [], []).blockers).toEqual([]);
    expect(computePenalties(run, rule(10), [], []).blockers[0]).toMatch(/unknown/);
    run.counters.damageHits = 0; // an explicit zero is a real zero
    expect(computePenalties(run, rule(10), [], []).blockers).toEqual([]);
    expect(computePenalties(run, rule(null), [], []).blockers[0]).toMatch(/no seconds set/);
    // a corrected count or a waiver clears the unknown
    run.counters.damageHits = null;
    expect(computePenalties(run, rule(10), [{ id: 'o', runId: run.id, ruleId: 'r', count: 2, waived: false, justification: 'video' }], []).totalMs).toBe(20000);
  });
  it('stacked rules on one counter need confirming; manual penalties add on; huge counts stay exact', () => {
    const run = runFromParsed(parseRaceLog(FIXTURE).runs[0], { batchId: 'b', source: 'log', file: 'f', driverId: 'd', eventId: 'e', held: false, heldReason: '', now: 'x' });
    const r = (id: string, ok = false) => ({ id, metric: 'offCourse' as Metric, name: id, reason: 'x', seconds: 1, enabled: true, scope: 'e', stackingConfirmed: ok });
    expect(computePenalties(run, [r('a'), r('b')], [], []).blockers[0]).toMatch(/confirm the stacking/);
    expect(computePenalties(run, [r('a', true), r('b', true)], [], []).totalMs).toBe(8000);
    const m = computePenalties(run, [], [], [{ id: 'm', entryId: 'x', name: 'Unsafe re-entry', reason: 'Steward call', count: 1, seconds: 9999 }]);
    expect(m.totalMs).toBe(9999000);
    run.counters.offCourse = 900_000_000;
    expect(computePenalties(run, [{ ...r('a'), seconds: 9999 }], [], []).totalMs).toBe(900_000_000 * 9999 * 1000);
  });
});

describe('ranking and points', () => {
  it('17. the points table', () => {
    expect(Array.from({ length: 15 }, (_, i) => pointsFor(i + 1))).toEqual([30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1]);
    expect([16, 30, 100].map((p) => pointsFor(p))).toEqual([1, 1, 1]);
    for (let k = 3; k <= 40; k++) expect(pointsFor(k)).toBe(Math.max(1, 25 - 2 * (k - 3)));
  });
  it('19. ties: competition ranking 1, 1, 3', () => {
    const r = competitionRanks([{ v: 10 }, { v: 10 }, { v: 12 }], (x) => x.v);
    expect([...r.values()].map((x) => x.rank)).toEqual([1, 1, 3]);
    expect([...r.values()].map((x) => x.tied)).toEqual([true, true, false]);
  });
  it('16 + 18 + 13 + 14 + 2: class ranks by adjusted time, winners per class, one entry per driver, 5 vs 5U, DNF', () => {
    let { ds, event } = setup();
    const drivers = ['A', 'B', 'C', 'D', 'E'].map((n) => { const d = createDriver(ds, { name: n, number: n }); ds = d.ds; return d.driver; });
    ds = map(ds, 'utv', 'c-5'); ds = map(ds, 'pickup', 'c-5u'); ds = map(ds, 'bx', 'c-5'); // two vehicles share Class 5
    let a1, a2, b1, c1, d1, e1;
    ({ ds, run: a1 } = addRun(ds, { driverId: drivers[0].id, eventId: event.id, ms: 100000, counters: { offCourse: 3 } }));
    ({ ds, run: a2 } = addRun(ds, { driverId: drivers[0].id, eventId: event.id, ms: 99000 }));
    ({ ds, run: b1 } = addRun(ds, { driverId: drivers[1].id, eventId: event.id, ms: 110000, vehicle: 'Gavril Bluebuck (bx)' }));
    ({ ds, run: c1 } = addRun(ds, { driverId: drivers[2].id, eventId: event.id, ms: 500000, vehicle: 'Gavril D-Series (pickup)' }));
    ({ ds, run: d1 } = addRun(ds, { driverId: drivers[3].id, eventId: event.id, ms: 9900, status: 'DNF' }));
    ({ ds, run: e1 } = addRun(ds, { driverId: drivers[4].id, eventId: event.id, ms: 120000, vehicle: 'Unknown Buggy (buggy)' }));
    ds = setRule(ds, event.id, 'offCourse', 1);
    for (const [d, r, c] of [[0, a1, 'c-5'], [1, b1, 'c-5'], [2, c1, 'c-5u'], [3, d1, 'c-5']] as const) ds = selectRun(ds, entryKey(event.id, drivers[d].id, c), r.id);
    let sc = scoreEvent(ds, event.id);
    const g5 = sc.groups.find((g) => g.classId === 'c-5')!, g5u = sc.groups.find((g) => g.classId === 'c-5u')!;
    expect(g5.results).toHaveLength(3); // A has two runs but one entry
    expect(g5.results.map((r) => [r.driverId, r.classRank, r.points])).toEqual([[drivers[0].id, 1, 30], [drivers[1].id, 2, 27], [drivers[3].id, null, 0]]);
    expect(g5u.results[0].points).toBe(30); // 18. Class 5U winner gets 30 though much slower
    expect(g5.results[2].status).toBe('DNF');
    expect(g5.results[2].rawMs).toBe(9900);
    expect(sc.noClass.map((x) => x.run.id)).toEqual([e1.id]); // 15. unmapped vehicle stays visible
    expect(finalizeEvent(ds, event.id).ok).toBe(false);
    // 16. a penalty changes the rank: A's selected run 100.0 + 3x10 = 130.0 > B 110.0 (it was 103.0 at 1 s each)
    ds = setRule(ds, event.id, 'offCourse', 10);
    sc = scoreEvent(ds, event.id);
    expect(sc.groups.find((g) => g.classId === 'c-5')!.results.map((r) => r.driverId).slice(0, 2)).toEqual([drivers[1].id, drivers[0].id]);
    // best adjusted mode picks A's clean 99.0
    ds = { ...ds, events: ds.events.map((e) => ({ ...e, format: 'best' as const })) };
    sc = scoreEvent(ds, event.id);
    const a = sc.all.find((r) => r.driverId === drivers[0].id)!;
    expect(a.runId).toBe(a2.id); expect(a.classRank).toBe(1);
    // overall placement across classes is shown, but class points don't depend on it
    expect(sc.all.find((r) => r.driverId === drivers[2].id)!.overallRank).toBe(3);
  });
  it('15. unassigned drivers and classes cannot be finalized', () => {
    let { ds, event } = setup();
    let r; ({ ds, run: r } = addRun(ds, { driverId: '', eventId: event.id, ms: 1000 }));
    ds = { ...ds, runs: ds.runs.map((x) => (x.id === r.id ? { ...x, driverId: null } : x)) };
    const f = finalizeEvent(ds, event.id);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.blockers.join(' ')).toMatch(/no driver/);
  });
  it('mapping precedence: manual > event config > event model > template config > template model; conflicts', () => {
    const run = { configText: 'Hirochi Aurata Race (CVT)', vehicle: 'Hirochi Aurata Race (CVT) (utv)', modelId: 'utv', classOverride: null, eventId: 'e1' };
    let ms: VehicleMapping[] = [{ id: '1', matchType: 'model', matchValue: 'utv', classId: 'c-1', scope: 'global' }];
    expect(classForRun(run, ms).classId).toBe('c-1');
    ms = [...ms, { id: '2', matchType: 'config', matchValue: 'Hirochi Aurata Race (CVT)', classId: 'c-2', scope: 'global' }];
    expect(classForRun(run, ms).classId).toBe('c-2');
    ms = [...ms, { id: '3', matchType: 'model', matchValue: 'utv', classId: 'c-3', scope: 'e1' }];
    expect(classForRun(run, ms).classId).toBe('c-3');
    expect(classForRun({ ...run, classOverride: 'c-7' }, ms).classId).toBe('c-7');
    ms = [...ms, { id: '4', matchType: 'model', matchValue: 'utv', classId: 'c-4', scope: 'e1' }];
    expect(classForRun(run, ms)).toMatchObject({ classId: null, how: 'conflict' });
    expect(classForRun({ ...run, modelId: 'other', vehicle: 'x', configText: 'x' }, ms).classId).toBeNull(); // never guessed
  });
  it('14. the 14 classes, in order, 5 and 5U separate, 10 after 9', () => {
    expect(SEED_CLASSES.map((c) => c.label)).toEqual(['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 5U', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 15', 'Class 18']);
    expect(new Set(SEED_CLASSES.map((c) => c.id)).size).toBe(14);
  });
});

describe('imports and duplicates', () => {
  it('12. a renamed copy for the same driver/event is a duplicate; another driver is not', () => {
    let { ds, event } = setup();
    const a = createDriver(ds, { name: 'A' }); ds = a.ds;
    const b = createDriver(ds, { name: 'B' }); ds = b.ds;
    const parsed = parseRaceLog(FIXTURE).runs;
    const rows = (driverId: string, file: string) => parsed.map((p, i) => ({ key: file + i, parsed: p, file, source: 'log' as const, driverId, eventId: event.id }));
    let plan = planRows(ds, rows(a.driver.id, 'race_log.txt'));
    expect(plan.map((r) => r.action)).toEqual(['add', 'add']);
    ds = { ...ds, runs: plan.map((r) => runFromParsed(r.parsed, { batchId: 'b', source: 'log', file: r.file, driverId: r.driverId, eventId: r.eventId, held: false, heldReason: '', now: 'x' })) };
    // CRLF + a different file name: same content
    const again = parseRaceLog(FIXTURE.replace(/\n/g, '\r\n')).runs.map((p, i) => ({ key: 'k' + i, parsed: p, file: 'copy of log (2).txt', source: 'log' as const, driverId: a.driver.id, eventId: event.id }));
    expect(planRows(ds, again).map((r) => r.action)).toEqual(['duplicate', 'duplicate']);
    expect(planRows(ds, rows(b.driver.id, 'race_log.txt')).map((r) => r.action)).toEqual(['add', 'add']);
    // the same run with a changed field: held for review, never overwriting
    const changed = parseRaceLog(FIXTURE.replace('Speeding: 5', 'Speeding: 1')).runs.map((p, i) => ({ key: 'c' + i, parsed: p, file: 'x', source: 'log' as const, driverId: a.driver.id, eventId: event.id }));
    expect(planRows(ds, changed).map((r) => r.action)).toEqual(['revision', 'duplicate']);
    plan = planRows(ds, rows('', 'f').map((r) => ({ ...r, driverId: null })));
    expect(plan[0].action).toBe('needs-driver');
  });
  it('manual CSV template round-trips', () => {
    const r = parseManualCsv(manualTemplateCsv(), 'manual.csv');
    expect(r.rejected).toEqual([]);
    expect(r.runs.map((x) => [x.status, x.elapsedMs, x.counters.recoveries])).toEqual([['FINISHED', 256800, 2], ['DNF', 9900, 0]]);
    const bad = parseManualCsv('course,time,status,resets\nLoop,abc,FINISHED,1\nLoop,1:00.0,DSQ,\nLoop,1:00.0,FINISHED,\n', 'm.csv');
    expect(bad.rejected).toHaveLength(2);
    expect(bad.runs[0].counters.resets).toBeNull();
  });
});

describe('finalize, amend, championship', () => {
  function season3() {
    const s = setup(); let ds = s.ds;
    const [A, B, C] = ['Driver A', 'Driver B', 'Driver C'].map((n) => { const d = createDriver(ds, { name: n }); ds = d.ds; return d.driver; });
    ds = map(ds, 'utv', 'c-1'); ds = map(ds, 'bx', 'c-7');
    const e2 = createEvent(ds, { seasonId: s.season.id, courseId: s.course.id, name: 'Round 2', round: 2 }); ds = e2.ds;
    return { ds, season: s.season, e1: s.event, e2: e2.event, A, B, C };
  }
  function race(ds: Dataset, eventId: string, results: [string, number][], fillers = 0, classId = 'c-1', vehicle?: string): Dataset {
    for (const [driverId, ms] of results) { let r; ({ ds, run: r } = addRun(ds, { driverId, eventId, ms, vehicle })); ds = selectRun(ds, entryKey(eventId, driverId, classId), r.id); }
    for (let i = 0; i < fillers; i++) {
      const d = createDriver(ds, { name: `Filler ${eventId.slice(0, 4)} ${i}` }); ds = d.ds;
      let r; ({ ds, run: r } = addRun(ds, { driverId: d.driver.id, eventId, ms: 200000 + i * 1000, vehicle })); ds = selectRun(ds, entryKey(eventId, d.driver.id, classId), r.id);
    }
    return ds;
  }
  it('20 + 21 + 22: 60 / 54 / 26 in Class 1, Class 7 separate, drafts and old revisions never count, amendments count once', () => {
    let { ds, season, e1, e2, A, B, C } = season3();
    ds = race(ds, e1.id, [[A.id, 100000], [B.id, 101000], [C.id, 102000]]);
    // round 2: A 1st, B 2nd, 12 others, C 15th
    ds = race(ds, e2.id, [[A.id, 100000], [B.id, 101000]], 12);
    let r; ({ ds, run: r } = addRun(ds, { driverId: C.id, eventId: e2.id, ms: 300000 })); ds = selectRun(ds, entryKey(e2.id, C.id, 'c-1'), r.id);
    // draft events don't count
    expect(championship(ds, season.id).classes).toEqual([]);
    expect(championship(ds, season.id, { draftPreview: true }).classes[0].rows[0].total).toBe(60);
    for (const e of [e1, e2]) { const f = finalizeEvent(ds, e.id); expect(f.ok).toBe(true); if (f.ok) ds = f.ds; }
    let ch = championship(ds, season.id).classes.find((c) => c.classId === 'c-1')!;
    expect(ch.rows.slice(0, 3).map((x) => [x.driverId, x.total])).toEqual([[A.id, 60], [B.id, 54], [C.id, 26]]);
    // a Class 7 win for A: its own total, nothing added to Class 1
    const e3 = createEvent(ds, { seasonId: season.id, courseId: e1.courseId, name: 'Round 3', round: 3 }); ds = e3.ds;
    ds = race(ds, e3.event.id, [[A.id, 90000]], 0, 'c-7', 'Gavril Bluebuck (bx)');
    const f3 = finalizeEvent(ds, e3.event.id); expect(f3.ok).toBe(true); if (f3.ok) ds = f3.ds;
    const all = championship(ds, season.id);
    expect(all.classes.find((c) => c.classId === 'c-1')!.rows[0].total).toBe(60);
    expect(all.classes.find((c) => c.classId === 'c-7')!.rows[0].total).toBe(30);
    // practice / excluded events don't count
    ds = { ...ds, events: ds.events.map((e) => (e.id === e3.event.id ? { ...e, practice: true } : e)) };
    expect(championship(ds, season.id).classes.find((c) => c.classId === 'c-7')).toBeUndefined();
    // 22. template changes don't touch a finalized snapshot
    const before = JSON.stringify(currentRevision(ds, e1.id)!.snapshot.results);
    ds = { ...ds, rules: ds.rules.map((x) => (x.scope === 'template' ? { ...x, seconds: 999 } : x)), settings: [{ ...ds.settings[0], points: { schedule: [100], fallback: 0 } }] };
    expect(JSON.stringify(currentRevision(ds, e1.id)!.snapshot.results)).toBe(before);
    ch = championship(ds, season.id).classes.find((c) => c.classId === 'c-1')!;
    expect(ch.rows[0].total).toBe(60);
    ds = { ...ds, settings: [{ ...ds.settings[0], points: { schedule: [30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1], fallback: 1 } }] };
    // amendment: C disqualified in round 1 -> C loses 25, counted once
    ds = startAmendment(ds, e1.id, 'Protest upheld');
    expect(championship(ds, season.id).classes[0].rows.find((x) => x.driverId === C.id)!.total).toBe(26); // still the published revision
    ds = setEntryStatus(ds, entryKey(e1.id, C.id, 'c-1'), 'DSQ', 'Protest upheld');
    expect(finalizeEvent(ds, e1.id, '  ').ok).toBe(false); // an amendment needs a justification
    const am = finalizeEvent(ds, e1.id, 'Protest upheld: DSQ'); expect(am.ok).toBe(true); if (am.ok) ds = am.ds;
    expect(ds.revisions.filter((x) => x.eventId === e1.id).map((x) => [x.revision, x.superseded])).toEqual([[1, true], [2, false]]);
    ch = championship(ds, season.id).classes.find((c) => c.classId === 'c-1')!;
    expect(ch.rows.find((x) => x.driverId === C.id)!.total).toBe(1);
    // duplicate import of an event changes nothing: same runs can't be added twice (see imports) and entries are one per driver/class
    expect(ch.rows.find((x) => x.driverId === A.id)!.total).toBe(60);
  });
  it('23 + 26: backup round trip, merge without extra points, CSV is formula-safe', () => {
    let { ds, season, e1, A, B } = season3();
    ds = { ...ds, drivers: ds.drivers.map((d) => (d.id === A.id ? { ...d, name: '=HYPERLINK("http://x")' } : d.id === B.id ? { ...d, name: 'Ångström, "Jr"' } : d)) };
    ds = race(ds, e1.id, [[A.id, 100000], [B.id, 101000]]);
    const f = finalizeEvent(ds, e1.id); if (f.ok) ds = f.ds;
    const text = JSON.stringify(makeBackup(ds, '1.0.0'));
    const v = validateBackup(JSON.parse(text));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const restored = v.backup.data;
    expect(championship(restored, season.id)).toEqual(championship(ds, season.id));
    const p = previewMerge(ds, restored);
    expect(p.conflicts).toEqual([]);
    expect(championship(mergeDatasets(ds, restored, 'incoming'), season.id)).toEqual(championship(ds, season.id));
    const broken = JSON.parse(text); broken.data.runs[0].eventId = 'nope';
    expect(validateBackup(broken).ok).toBe(false);
    expect(validateBackup({ ...JSON.parse(text), schema: 99 }).ok).toBe(false);
    const csv = resultsCsv(ds, e1.id);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"Ångström, ""Jr"""');
    expect(parseCsv(csv)[1]).toContain(`'=HYPERLINK("http://x")`);
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(42)).toBe('42');
    expect(toCsv([['a\nb']])).toContain('"a\nb"');
    expect(championshipCsv(ds, season.id)).toContain('Class 1');
    expect(penaltiesCsv(ds, e1.id).split('\r\n')[0]).toContain('Seconds each');
  });
});

describe('overrides', () => {
  it('delete / edit runs, revert to draft, delete events and seasons, delete and edit drivers', async () => {
    const a = await import('../actions');
    let ds = a.seedDataset('S1');
    const s1 = ds.seasons[0];
    const c = a.findOrCreateCourse(ds, 'Loop', 'utah'); ds = c.ds;
    const e = a.createEvent(ds, { seasonId: s1.id, courseId: c.course.id, name: 'R1' }); ds = e.ds;
    const d = a.createDriver(ds, { name: 'Dusty', number: '7' }); ds = d.ds;
    ds = { ...ds, mappings: [{ id: 'm', matchType: 'model', matchValue: 'utv', classId: 'c-1', scope: 'global' }] };
    const p = parseRaceLog(FIXTURE).runs;
    const runs = p.map((x) => runFromParsed(x, { batchId: 'b', source: 'log', file: 'f', driverId: d.driver.id, eventId: e.event.id, held: false, heldReason: '', now: 'x' }));
    ds = { ...ds, runs };
    const key = entryKey(e.event.id, d.driver.id, 'c-1');
    ds = selectRun(ds, key, runs[0].id);
    const f = finalizeEvent(ds, e.event.id); expect(f.ok).toBe(true); if (f.ok) ds = f.ds;
    expect(championship(ds, s1.id).classes[0].rows[0].total).toBe(30);
    // change a run: draft results follow, the finalized snapshot doesn't
    ds = a.editRun(ds, runs[0].id, { elapsedMs: 200000 }, 'timing error');
    expect(ds.runs[0].elapsedMs).toBe(200000);
    expect(currentRevision(ds, e.event.id)!.snapshot.results[0].rawMs).toBe(256800);
    expect(ds.history.at(-1)).toMatchObject({ type: 'override:edit', reason: 'timing error' });
    // revert to draft: stops counting; finalizing again makes revision 2
    ds = a.revertToDraft(ds, e.event.id, 'recount');
    expect(championship(ds, s1.id).classes).toEqual([]);
    const f2 = finalizeEvent(ds, e.event.id); expect(f2.ok).toBe(true); if (f2.ok) ds = f2.ds;
    expect(currentRevision(ds, e.event.id)!.revision).toBe(2);
    expect(currentRevision(ds, e.event.id)!.snapshot.results[0].rawMs).toBe(200000);
    // delete the selected run: the entry has no attempt again
    ds = a.deleteRun(ds, runs[0].id, 'bad file');
    expect(ds.runs).toHaveLength(1);
    expect(ds.entries.find((x) => x.id === key)!.selectedRunId).toBeNull();
    // edit + delete the driver: runs stay, unassigned
    ds = a.editDriver(ds, d.driver.id, { name: 'Dusty R' }, 'spelling');
    expect(ds.drivers[0].aliases).toContain('Dusty');
    ds = a.deleteDriver(ds, d.driver.id, 'left the series');
    expect(ds.drivers).toHaveLength(0);
    expect(ds.runs[0].driverId).toBeNull();
    expect(ds.entries).toHaveLength(0);
    expect(championship(ds, s1.id).classes[0].rows[0].driverId).toBe(d.driver.id); // official snapshot keeps the line
    // the last season can't go; with a second one it can, taking its events and runs
    expect(a.deleteSeason(ds, s1.id, 'x')).toBe(ds);
    ds = { ...ds, seasons: [...ds.seasons, { id: 's2', name: 'S2', createdAt: 'x' }] };
    ds = a.renameSeason(ds, s1.id, 'Season One', 'typo');
    expect(ds.seasons[0].name).toBe('Season One');
    ds = a.deleteSeason(ds, s1.id, 'test season');
    expect(ds.seasons.map((x) => x.id)).toEqual(['s2']);
    expect(ds.events).toHaveLength(0); expect(ds.runs).toHaveLength(0); expect(ds.revisions).toHaveLength(0);
    expect(ds.rules.every((r) => r.scope === 'template')).toBe(true);
    expect(ds.settings[0].selectedSeasonId).toBe('s2');
    expect(validateBackup(JSON.parse(JSON.stringify(makeBackup(ds, 't')))).ok).toBe(true);
  });
});
