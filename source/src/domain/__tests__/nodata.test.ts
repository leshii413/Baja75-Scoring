// "No Data Provided": results typed in from Discord (or anywhere without the Navigation Unit log) still import and score,
// flagged for manual review. Uses the two real Discord results from the October 3rd race.
import { describe, expect, it } from 'vitest';
import { createDriver, createEvent, editRun, finalizeEvent, findOrCreateCourse, markReviewed, seedDataset, selectRun, updateEvent } from '../actions';
import { manualTemplateCsv, NO_DATA, parseManualCsv } from '../csv';
import { runFromParsed } from '../importPlan';
import { entryKey, needsReview, scoreEvent, timeMissing } from '../scoring';
import type { Dataset, Metric, Run } from '../types';

const HEAD = 'driver,number,course,map,vehicle,status,time,date,off_course,wrong_way,speeding,missed_vcps,jump_starts,resets,recoveries,damage,laps,best_lap,notes';
const ND8 = Array(8).fill(NO_DATA).join(',');
const DISCORD = [
  HEAD,
  `DH_FOX911,${NO_DATA},BAJA75 Series: October 3rd Race,${NO_DATA},Brenthel Gen3 Trophy Truck - Mike Marsal,FINISHED,37:54.771,2026-10-07 09:39:00 UTC+08:00,${ND8},3,7:59.556,"From Discord: Not counted for the leaderboard (anti-cheat options or the vehicle rule were changed)"`,
  `hilly,${NO_DATA},BAJA75 Series: October 3rd Race,${NO_DATA},SP Dunekicker (2008) (custom),FINISHED,38:32.360,2026-10-06 13:09:00 UTC+08:00,${ND8},4,6:27.173,"From Discord: New server record; Leaderboard #1 of 4"`,
].join('\n');

function build(csv: string, opts: { chargeAll?: boolean } = {}) {
  let ds: Dataset = seedDataset('Test');
  const c = findOrCreateCourse(ds, 'BAJA75 Series: October 3rd Race', ''); ds = c.ds;
  const e = createEvent(ds, { seasonId: ds.seasons[0].id, courseId: c.course.id, name: 'October 3rd Race', round: 1 }); ds = e.ds;
  // every penalty rule charges time, so an unknown count would normally block finalizing
  if (opts.chargeAll !== false) ds = { ...ds, rules: ds.rules.map((r) => (r.scope === e.event.id ? { ...r, seconds: 30 } : r)) };
  const parsed = parseManualCsv(csv, 'discord.csv');
  const runs: Run[] = [];
  for (const p of parsed.runs) {
    const d = createDriver(ds, { name: p.sourceDriver || 'Unknown' }); ds = d.ds;
    runs.push(runFromParsed(p, { batchId: 'b', source: 'manual', file: 'discord.csv', driverId: d.driver.id, eventId: e.event.id, held: false, heldReason: '', now: new Date().toISOString() }));
  }
  ds = { ...ds, runs: [...ds.runs, ...runs], classes: ds.classes, mappings: [...ds.mappings, ...runs.map((r, i) => ({ id: 'm' + i, matchType: 'config' as const, matchValue: r.configText, classId: ds.classes[0].id, scope: 'global' }))] };
  return { ds, event: e.event, runs, parsed };
}

function selectAll(ds: Dataset, eventId: string, runs: Run[]): Dataset {
  for (const r of runs) ds = selectRun(ds, entryKey(eventId, r.driverId!, ds.classes[0].id), r.id);
  return ds;
}

describe('No Data Provided imports', () => {
  it('imports both Discord results with nothing rejected', () => {
    const parsed = parseManualCsv(DISCORD, 'discord.csv');
    expect(parsed.rejected).toEqual([]);
    expect(parsed.runs).toHaveLength(2);
    const [fox, hilly] = parsed.runs;
    expect(fox.elapsedMs).toBe(37 * 60000 + 54771);
    expect(hilly.elapsedMs).toBe(38 * 60000 + 32360);
    expect(hilly.noData).toEqual(['number', 'map', 'off_course', 'wrong_way', 'speeding', 'missed_vcps', 'jump_starts', 'resets', 'recoveries', 'damage']);
    expect(Object.values(hilly.counters)).toEqual(Array(8).fill(0));
    expect(hilly.map).toBe('');
    expect(hilly.configText).toBe('SP Dunekicker (2008)');
    expect(hilly.unknownFields).toMatchObject({ laps: '4', 'best lap': '6:27.173' });
    expect(fox.issues.join(' ')).toContain('Manual review needed');
    expect(fox.issues.join(' ')).toContain('Not counted for the leaderboard');
  });

  it('accepts No Data Provided in any column, in any letter case', () => {
    const csv = [HEAD, `no data provided,${NO_DATA},${NO_DATA},${NO_DATA},${NO_DATA},No Data Provided,NO DATA PROVIDED,${NO_DATA},${ND8},${NO_DATA},${NO_DATA},${NO_DATA}`].join('\n');
    const p = parseManualCsv(csv, 'x.csv');
    expect(p.rejected).toEqual([]);
    const r = p.runs[0];
    expect(r.status).toBe('FINISHED');
    expect(r.courseName).toBe(NO_DATA);
    expect(r.sourceDriver).toBe('');
    expect(r.vehicle).toBe('');
    expect(r.modelId).toBeNull();
    expect(r.noData).toContain('time');
    expect(r.noData).toContain('driver');
  });

  it('still rejects real mistakes (a typo is not "No Data Provided")', () => {
    const p = parseManualCsv([HEAD, `A,1,C,,V,FINISHED,38:3x.360,,,,,,,,,,,,`].join('\n'), 'x.csv');
    expect(p.runs).toHaveLength(0);
    expect(p.rejected[0].reason).toContain(NO_DATA);
  });

  it('the CSV template (with its Discord example row) imports cleanly', () => {
    const p = parseManualCsv(manualTemplateCsv(), 'template.csv');
    expect(p.rejected).toEqual([]);
    expect(p.runs).toHaveLength(3);
    expect(p.runs[2].noData?.length).toBeGreaterThan(0);
  });
});

describe('No Data Provided scoring', () => {
  it('scores as a valid result: penalties count 0, ranked by time, flagged for review, finalize allowed', () => {
    const b = build(DISCORD);
    const ds = selectAll(b.ds, b.event.id, b.runs);
    const sc = scoreEvent(ds, b.event.id);
    expect(sc.blockers).toEqual([]);
    const lines = sc.groups[0].results;
    expect(lines.map((l) => l.selectedRun?.sourceDriver)).toEqual(['DH_FOX911', 'hilly']);
    expect(lines.map((l) => l.classRank)).toEqual([1, 2]);
    expect(lines.every((l) => l.penaltyMs === 0)).toBe(true);
    expect(lines[0].warnings.join(' ')).toContain('manual review needed');
    expect(sc.warnings.join(' ')).toContain('2 result(s) have No Data Provided');
    expect(finalizeEvent(ds, b.event.id).ok).toBe(true);
  });

  it('a blank penalty cell is still "unknown" and blocks while its rule charges time', () => {
    const csv = [HEAD, `hilly,,BAJA75 Series: October 3rd Race,,SP Dunekicker (2008) (custom),FINISHED,38:32.360,,,,,,,,,,,,`].join('\n');
    const b = build(csv);
    const sc = scoreEvent(selectAll(b.ds, b.event.id, b.runs), b.event.id);
    expect(sc.blockers.join(' ')).toContain('unknown');
  });

  it('a missing time keeps the result but blocks finalizing until it is entered', () => {
    const csv = [HEAD, `hilly,,BAJA75 Series: October 3rd Race,,SP Dunekicker (2008) (custom),FINISHED,${NO_DATA},,0,0,0,0,0,0,0,0,,,`].join('\n');
    const b = build(csv);
    let ds = selectAll(b.ds, b.event.id, b.runs);
    let sc = scoreEvent(ds, b.event.id);
    expect(sc.all[0].adjustedMs).toBeNull();
    expect(sc.all[0].classRank).toBeNull();
    expect(sc.blockers.join(' ')).toContain('Time: No Data Provided');
    expect(finalizeEvent(ds, b.event.id).ok).toBe(false);
    // an official types the time in
    ds = editRun(ds, b.runs[0].id, { elapsedMs: 2312360, precisionMs: 1 }, 'Time from the Discord screenshot');
    const run = ds.runs.find((r) => r.id === b.runs[0].id)!;
    expect(timeMissing(run)).toBe(false);
    sc = scoreEvent(ds, b.event.id);
    expect(sc.blockers).toEqual([]);
    expect(sc.all[0].classRank).toBe(1);
  });

  it('best-attempt events never pick a run whose time is missing', () => {
    const csv = [HEAD,
      `hilly,,BAJA75 Series: October 3rd Race,,SP Dunekicker (2008) (custom),FINISHED,${NO_DATA},,0,0,0,0,0,0,0,0,,,`,
      `hilly,,BAJA75 Series: October 3rd Race,,SP Dunekicker (2008) (custom),FINISHED,38:32.360,2026-10-06 13:09:00 UTC+08:00,0,0,0,0,0,0,0,0,,,`].join('\n');
    let { ds, event, runs } = build(csv);
    // both rows belong to the same driver
    ds = { ...ds, runs: ds.runs.map((r) => (r.id === runs[1].id ? { ...r, driverId: runs[0].driverId } : r)) };
    ds = updateEvent(ds, event.id, { format: 'best' }, 'best attempt');
    const sc = scoreEvent(ds, event.id);
    expect(sc.all).toHaveLength(1);
    expect(sc.all[0].selectedRun?.id).toBe(runs[1].id);
    expect(sc.all[0].rawMs).toBe(2312360);
  });

  it('typing a penalty count clears that marker; Mark as reviewed clears the review flag', () => {
    const b = build(DISCORD);
    let ds = selectAll(b.ds, b.event.id, b.runs);
    const id = b.runs[1].id;
    const counters = { ...b.runs[1].counters, offCourse: 2 } as Record<Metric, number | null>;
    ds = editRun(ds, id, { counters }, 'Steward counted 2 off-course moments in the replay');
    let run = ds.runs.find((r) => r.id === id)!;
    expect(run.noData).not.toContain('off_course');
    expect(run.noData).toContain('damage');
    expect(needsReview(run)).toBe(true);
    ds = markReviewed(ds, id, 'Checked against the Discord post');
    run = ds.runs.find((r) => r.id === id)!;
    expect(needsReview(run)).toBe(false);
    expect(ds.history.at(-1)?.type).toBe('no-data-reviewed');
    const line = scoreEvent(ds, b.event.id).all.find((l) => l.runId === id)!;
    expect(line.penaltyMs).toBe(60000);
    expect(line.warnings.join(' ')).not.toContain('manual review');
  });
});
